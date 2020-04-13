import { checkIdempotencyOnSecondTable } from "../test-helpers";
import { TableProvider } from "./index";
import { TableI } from "./records";

describe("foreign key idempotency", () => {
  const basicEventTable: TableI = {
    name: "events",
    columns: [
      {
        name: "id",
        type: "uuid",
        default: { type: "function", fn: "uuid_generate_v1mc()" },
        nullable: false,
      },
      {
        name: "title",
        type: "text",
      },
      {
        name: "starts_at",
        type: "timestamptz",
      },
      {
        name: "ends_at",
        type: "timestamptz",
      },
    ],
    indexes: [
      {
        name: "event_pkey",
        on: [{ column: "id" }],
        primary_key: true,
        unique: true,
      },
    ],
  };

  test("basic", async () => {
    const newOperationList = await checkIdempotencyOnSecondTable(
      TableProvider,
      basicEventTable,
      {
        name: "people",
        columns: [
          { name: "first_name", type: "text" },
          { name: "last_name", type: "text" },
          { name: "attending_event", type: "uuid" },
        ],
        foreign_keys: [
          {
            on: ["attending_event"],
            references: {
              table: "events",
              columns: ["id"],
            },
          },
        ],
      },
      "people",
    );

    expect(newOperationList).toHaveLength(0);
  });

  // const tenantEventTable: TableI = {
  //   kind: "Table",
  //   name: "events",
  //   columns: [
  //     {
  //       name: "tenant_id",
  //       type: "uuid",
  //     },
  //     {
  //       name: "id",
  //       type: "uuid",
  //     },
  //     {
  //       name: "title",
  //       type: "text",
  //     },
  //     {
  //       name: "starts_at",
  //       type: "timestampz",
  //     },
  //     {
  //       name: "ends_at",
  //       type: "timestampz",
  //     },
  //   ],
  //   indexes: [
  //     {
  //       name: "event_pkey",
  //       on: [{ column: "tenant_id" }, { column: "id" }],
  //       primary_key: true,
  //       unique: true,
  //     },
  //   ],
  // };

  // test("compound foreign keys", async () => {
  //   const newOperationList = await checkIdempotencyOnSecondTable(
  //     TableProvider,
  //     tenantEventTable,
  //     {
  //       kind: "Table",
  //       name: "people",
  //       columns: [
  //         { name: "first_name", type: "text" },
  //         { name: "last_name", type: "text" },
  //         { name: "tenant_id", type: "uuid" },
  //         { name: "attending_event", type: "uuid" },
  //       ],
  //       foreign_keys: [
  //         {
  //           on: ["tenant_id", "attending_event"],
  //           references: {
  //             table: "events",
  //             columns: ["tenant_id", "attending_event"],
  //           },
  //         },
  //       ],
  //     },
  //     "people",
  //   );

  //   expect(newOperationList).toHaveLength(0);
  // });
});
