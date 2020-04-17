import {
  run as runWorker,
  Task,
  JobHelpers,
  RunnerOptions as WorkerRunnerOptions,
  TaskList,
  AddJobFunction,
} from "graphile-worker";

import {
  run as runScheduler,
  RunnerOptions as SchedulerRunnerOptions,
  ScheduleConfig,
} from "graphile-scheduler";

import { Pool, PoolClient } from "pg";
import { loadYaml } from "../loaders/yaml";
import Cryptr = require("cryptr");
import { installModule } from "..";
import { directRunner } from "../runners";
import { Record, String, Dictionary, Unknown, Union } from "runtypes";
import { fromPairs, toPairs } from "lodash";
import { ModuleI } from "../objects/module/core";

type PoolOrPoolClient = Pool | PoolClient;

type ComposeWorkerOptions = {
  encryptionSecret: string;
  pgPool: Pool;
} & Omit<
  WorkerRunnerOptions & SchedulerRunnerOptions,
  "connectionString" | "schema" | "schedules"
>;

interface PgComposeWorker {
  stop: () => Promise<void>;
  setSecret: (secretRef: string, unencryptedSecret: string) => Promise<void>;
  addJob: AddJobFunction;
}

export const run = async (
  m: ModuleI,
  opts: ComposeWorkerOptions,
): Promise<PgComposeWorker> => {
  const pool = opts.pgPool;

  const cryptr = new Cryptr(opts.encryptionSecret);

  const schedules: ScheduleConfig[] = (m.cronJobs || []).map(cj => ({
    name: cj.name,
    pattern: cj.pattern,
    timeZone: cj.time_zone,
    taskIdentifier: cj.task_name,
  }));

  const taskList: TaskList = fromPairs(
    toPairs(m.taskList)
      .map(([identifier, task]) => [identifier, wrapTask(pool, cryptr, task)])
      .concat([["encrypt-secret", makeEncryptSecretTask(cryptr)]]),
  );

  const scheduler = await runScheduler({
    pgPool: pool,
    schedules,
  });

  const worker = await runWorker({ ...opts, ...{ taskList } });

  return {
    stop: async () => {
      scheduler.stop();
      worker.stop();
    },
    setSecret: async (secretRef: string, unencryptedSecret: string) =>
      setSecret(pool, secretRef, unencryptedSecret),
    addJob: worker.addJob,
  };
};

export const migrate = async (pgPool: Pool) => {
  const worker = await runWorker({ pgPool, taskList: {} });
  const scheduler = await runScheduler({ pgPool });

  await worker.stop();
  await scheduler.stop();

  const client = await pgPool.connect();

  await client.query("create schema if not exists graphile_secrets");

  const m = await loadYaml({ include: "./src/worker/graphile-secrets.yaml" });

  await installModule(m, directRunner, {
    client,
    schema: "graphile_secrets",
  });

  await client.query(
    "alter table graphile_secrets.unencrypted_secrets set unlogged",
  );

  await client.release();
};

export interface GraphileSecrets {
  ref: string;
  encrypted_secret: string;
}

export interface GraphileUnencryptedSecrets {
  ref: string;
  unencrypted_secret: string;
}

export const encryptSecret = async (
  client: PoolClient,
  cryptr: Cryptr,
  secretRef: string,
): Promise<void> => {
  const { rows: unencryptedMatches } = await client.query<
    GraphileUnencryptedSecrets
  >("select * from graphile_secrets.unencrypted_secrets where ref = $1", [
    secretRef,
  ]);

  const { rows: encryptedMatches } = await client.query<GraphileSecrets>(
    "select * from graphile_secrets.secrets where ref = $1 and encrypted_secret is not null",
    [secretRef],
  );

  if (encryptedMatches.length > 0) {
    return;
  }

  if (unencryptedMatches.length > 0) {
    const encryptedSecret = cryptr.encrypt(
      unencryptedMatches[0].unencrypted_secret,
    );

    await client.query(
      "update graphile_secrets.secrets set encrypted_secret = $1 where ref = $2",
      [encryptedSecret, secretRef],
    );

    await client.query(
      "delete from graphile_secrets.unencrypted_secrets where ref = $1",
      [secretRef],
    );

    return;
  }

  throw new Error(`No secret found with ref ${secretRef}`);
};

const makeEncryptSecretTask = (cryptr: Cryptr): Task => async (
  payload: any,
  helpers: JobHelpers,
) => {
  await helpers.withPgClient(async pgClient => {
    await pgClient.query("begin");
    await encryptSecret(pgClient, cryptr, payload.ref);
    await pgClient.query("commit");
  });
};

export const getSecret = async (
  client: PoolOrPoolClient,
  cryptr: Cryptr,
  secretRef: string,
): Promise<string> => {
  const { rows } = await client.query<GraphileSecrets>(
    "select * from graphile_secrets.secrets where ref = $1",
    [secretRef],
  );

  if (rows[0].encrypted_secret === null) {
    const { rows } = await client.query<GraphileUnencryptedSecrets>(
      "select * from graphile_secrets.unencrypted_secrets where ref = $1",
      [secretRef],
    );
    return rows[0].unencrypted_secret;
  }

  return cryptr.decrypt(rows[0].encrypted_secret);
};

export const setSecret = async (
  client: PoolOrPoolClient,
  secretRef: string,
  unencryptedSecret: string,
): Promise<void> => {
  await client.query<{ ref: string }>(
    "select graphile_secrets.set_secret($1, $2)",
    [secretRef, unencryptedSecret],
  );
};

const EncodedSecret = Record({
  __secret: String,
});
const StandardJobPayload = Dictionary(Unknown, "string");
const Value = Unknown;
const JobPayloadToClone = Union(EncodedSecret, StandardJobPayload, Value);

export const deepCloneWithSecretReplacement = async (
  client: PoolOrPoolClient,
  cryptr: Cryptr,
  v: any,
): Promise<any> =>
  JobPayloadToClone.match(
    async encodedSecret =>
      await getSecret(client, cryptr, encodedSecret.__secret),

    async toRecurseOn =>
      fromPairs(
        await Promise.all(
          toPairs(toRecurseOn).map(async ([k, v]) => [
            k,
            await deepCloneWithSecretReplacement(client, cryptr, v),
          ]),
        ),
      ),

    async value => value,
  )(v);

export const wrapTask = (
  client: PoolOrPoolClient,
  cryptr: Cryptr,
  task: Task,
): Task => {
  return async (payload: unknown, helpers: JobHelpers) => {
    const decodedPayload = await deepCloneWithSecretReplacement(
      client,
      cryptr,
      payload,
    );

    return await task(decodedPayload, helpers);
  };
};