import { ColumnOpCodes, CreateColumnOperation } from "./columns";
import { reconcileTables, TableOpCodes } from "./reconcile";
import { TableI } from "./records";

describe("table migrations", () => {
  test("should return a create table operation", async () => {
    const desired: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: false,
        },
        {
          name: "last_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const operations = await reconcileTables(desired, undefined);

    expect(operations[0]).toHaveProperty("code");
    expect(operations[0].code).toEqual(TableOpCodes.CreateTable);
  });

  test("should return a rename table operation", async () => {
    const desired: TableI = {
      name: "people_2",
      previous_name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: false,
        },
        {
          name: "last_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const current: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: false,
        },
        {
          name: "last_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const operations = await reconcileTables(desired, current);

    expect(operations[0]).toHaveProperty("code");
    expect(operations[0].code).toEqual(TableOpCodes.RenameTable);
  });

  test("should return a create column operation", async () => {
    const desiredTables: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: false,
        },
        {
          name: "last_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const currentTables: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const operations = await reconcileTables(desiredTables, currentTables);

    const op = operations[0];

    expect(op.code).toBe(ColumnOpCodes.CreateColumn);
    expect(CreateColumnOperation.guard(op)).toBe(true);

    if (CreateColumnOperation.guard(op)) {
      expect(op.column.name).toBe("last_name");
    }
  });

  test("should return a rename column operation", async () => {
    const desired: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: false,
        },
        {
          name: "last_name",
          previous_name: "given_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const current: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: false,
        },
        {
          name: "given_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const operations = await reconcileTables(desired, current);

    const op = operations[0];
    expect(op.code).toBe(ColumnOpCodes.RenameColumn);
  });

  test("should return  change data type and nullable operations", async () => {
    const desired: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "integer",
          nullable: true,
          default: "George",
        },
      ],
    };

    const current: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const operations = await reconcileTables(desired, current);

    const op1 = operations[0];
    const op2 = operations[1];
    const op3 = operations[2];

    expect(op1.code).toBe(ColumnOpCodes.SetColumnDefault);
    expect(op2.code).toBe(ColumnOpCodes.SetColumnNullable);
    expect(op3.code).toBe(ColumnOpCodes.SetColumnDataType);
  });

  test("should return drop column operations", async () => {
    const desired: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: true,
        },
      ],
    };

    const current: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: true,
        },
        {
          name: "last_name",
          type: "text",
          nullable: false,
        },
      ],
    };

    const operations = await reconcileTables(desired, current);
    expect(operations[0].code).toBe(ColumnOpCodes.DropColumn);
  });
});
