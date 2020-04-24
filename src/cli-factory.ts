import * as yargs from "yargs";
import {
  fileRunner,
  directRunner,
  Runner,
  RunContextI,
  ToFileRunContextI,
} from "./runners";
import { Pool } from "pg";
import { installModule } from ".";
import { loadYaml } from "./loaders/yaml";
import { runTest, setupTests } from "./objects/test";
import * as tape from "tape";
import { watch } from "chokidar";
import * as glob from "glob";
import { migrate as migrateWorker, run as runWorker, TaskList } from "./worker";

interface CliOpts {
  database: string;
  files: string;
  schema: string;
  out?: string;
  testFiles: string;
  watch: boolean;
}

const install = (taskList?: TaskList) => async (argv: CliOpts) => {
  const pool = new Pool({ connectionString: argv.database });

  const client = await pool.connect();

  const loadAndInstallModule = async () => {
    const m = await loadYaml({
      include: argv.files,
    });

    if (taskList !== undefined) {
      m.taskList = taskList;
    }

    const runner: Runner =
      argv.out === undefined
        ? true
          ? directRunner
          : directRunner
        : fileRunner;

    const context: RunContextI | ToFileRunContextI = {
      schema: argv.schema,
      client,
      outFile: argv.out,
    };

    await installModule(m, runner, context);
  };

  await loadAndInstallModule();

  if (argv.watch) {
    const files: string[] = await new Promise((resolve, _reject) =>
      glob(argv.files, (_err: any, f: string[]) => resolve(f)),
    );

    watch(files).on("all", loadAndInstallModule);
  }
};

const test = (taskList?: TaskList) => async (argv: CliOpts) => {
  const pool = new Pool({ connectionString: argv.database });

  const installModuleAndRunTests = async () => {
    const client = await pool.connect();

    const m = await loadYaml({
      include: argv.files,
    });

    if (taskList !== undefined) {
      m.taskList = taskList;
    }

    const runner = directRunner;

    const runContext: RunContextI | ToFileRunContextI = {
      schema: argv.schema,
      client,
    };

    const testContext = {
      runContext,
      runner,
      taskList,
    };

    const reset = await setupTests(m, testContext);

    for (const test of m.tests || []) {
      await runTest(test, testContext, reset);
    }

    if (!argv.watch) {
      tape.onFinish(() => {
        setTimeout(process.exit, 30);
      });
    }
  };

  await installModuleAndRunTests();

  if (argv.watch) {
    const files: string[] = await new Promise((resolve, _reject) =>
      glob(argv.files, (_err: any, f: string[]) => resolve(f)),
    );

    watch(files).on("all", installModuleAndRunTests);
  }
};

const run = (taskList?: TaskList) => async (argv: CliOpts) => {
  const pool = new Pool({ connectionString: argv.database });

  await migrateWorker(pool);

  const m = await loadYaml({
    include: argv.files,
  });

  if (taskList !== undefined) {
    m.taskList = taskList;
  }

  const runner = directRunner;

  const client = await pool.connect();

  const runContext: RunContextI | ToFileRunContextI = {
    schema: argv.schema,
    client,
  };

  await installModule(m, runner, runContext);

  await runWorker(m, { pgPool: pool, encryptionSecret: process.env.SECRET! });
};

export const makeCli = (taskList?: TaskList) =>
  yargs
    .options({
      database: {
        alias: "d",
        demandOption: true,
        describe: "postgresql connection string url",
        type: "string",
      },
      files: {
        alias: "f",
        demandOption: true,
        describe: "the yaml files to include",
        type: "string",
      },
      schema: {
        alias: "s",
        demandOption: true,
        default: "public",
        type: "string",
      },
      out: {
        alias: "o",
        demandOption: false,
        describe: "optional output file to write a migration too",
        type: "string",
      },
      watch: {
        alias: "w",
        describe: "watch for changes to files and rerun command",
        type: "boolean",
        default: false,
      },
    })
    .command({
      command: "install",
      handler: install(taskList),
    })
    .command({
      command: "test",
      handler: test(taskList),
    })
    .command({
      command: "run",
      handler: run(taskList),
    })
    .demandCommand()
    .help().argv;
