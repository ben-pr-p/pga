import { Record, String, Array, Static, Boolean, Partial } from "runtypes";
import { ModuleI } from "../module/core";
import { installModule } from "../..";
import { RunContextI, Runner } from "../../runners";
import * as tape from "tape";
import { runTaskListOnce } from "graphile-worker";
import { makeWrapTaskList, TaskList } from "../../worker";
import Cryptr = require("cryptr");
import { render } from "mustache";

export const Assertion = Record({
  name: String,
  return: String,
  expect: String,
});

export const TestRecord = Record({
  name: String,
  setup: String,
  assertions: Array(Assertion),
}).And(
  Partial({
    run_task_list_after_setup: Boolean,
  }),
);

export interface TestI extends Static<typeof TestRecord> {}

interface TestContext {
  runContext: RunContextI;
  runner: Runner;
  taskList?: TaskList;
}

type TestResetFn = () => Promise<void>;

export const setupTests = async (
  m: ModuleI,
  context: TestContext,
): Promise<TestResetFn> => {
  const { runContext, runner } = context;
  const { client } = runContext;

  await client.query("begin");
  await installModule(m, runner, runContext);
  await client.query("savepoint after_migrate;");

  const reset: TestResetFn = async () => {
    await client.query("rollback to after_migrate");
  };

  return reset;
};

export const runTest = async (
  test: TestI,
  context: TestContext,
  reset: TestResetFn,
) => {
  const { runContext } = context;

  const { client } = runContext;

  const wrapTaskList = makeWrapTaskList(client, new Cryptr("test"));
  const taskList = wrapTaskList(context.taskList || {});

  await client.query("begin");

  tape(test.name, async t => {
    const setupString = render(test.setup, process.env);
    await client.query(setupString);

    await client.query("savepoint after_setup");

    if (test.run_task_list_after_setup === true) {
      await runTaskListOnce({}, taskList, client);
    }

    for (const assertion of test.assertions) {
      const {
        rows: [result],
      } = await client.query(assertion.return);

      const unpacked =
        result !== undefined ? result[Object.keys(result)[0]] : undefined;

      t.equal(
        unpacked !== undefined ? unpacked.toString() : unpacked,
        assertion.expect.toString(),
      );

      await client.query("rollback to after_setup");
    }

    await reset();
    t.end();
  });
};
