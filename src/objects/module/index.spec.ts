import { TableI, TraitI, TableExtensionI } from "../table/records";
import { checkIdempotency } from "../test-helpers";
import { ModuleProvider, rollupDependencies } from "./index";
import { ModuleI } from "./core";

const eventsTable: TableI = {
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

const peopleTable: TableI = {
  name: "people",
  columns: [
    { name: "first_name", type: "text" },
    { name: "last_name", type: "text" },
    { name: "attending_event", type: "uuid" },
    { name: "updated_at", type: "timestamptz" },
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
};

const hasFirstNameTrait: TraitI = {
  name: "nameable",
  requires: {
    columns: [{ name: "first_name", type: "text" }],
  },
  provides: {
    columns: [{ name: "other_thing", type: "text" }],
  },
};

const updatedTrait: TraitI = {
  name: "auto_update",
  requires: {
    columns: [{ name: "updated_at", type: "timestamptz" }],
  },
  provides: {
    triggers: [
      {
        name: "auto_update_updated_at",
        timing: "before_update",
        language: "plpgsql",
        body: "begin NEW.{{ updated_at }} = now(); return NEW; end;",
        for_each: "row",
        order: 1,
      },
    ],
  },
};

describe("idempotency", () => {
  test("can install two tables", async () => {
    const newOperationList = await checkIdempotency(
      ModuleProvider,
      {
        tables: [eventsTable, peopleTable],
      },
      "",
    );

    expect(newOperationList).toHaveLength(0);
  });

  test("can install a trait", async () => {
    const tableWithTraitWithoutforeign_key = Object.assign({}, peopleTable, {
      implements: [{ trait: "nameable" }],
      foreign_keys: [],
    });
    const newOperationList = await checkIdempotency(
      ModuleProvider,
      {
        tables: [tableWithTraitWithoutforeign_key],
        traits: [hasFirstNameTrait],
      },
      "",
    );
    expect(newOperationList).toHaveLength(0);
  });

  test("can install a trait with a trigger", async () => {
    const tableWithTraitWithoutforeign_key = Object.assign({}, peopleTable, {
      implements: [{ trait: "auto_update" }],
      foreign_keys: [],
    });

    const newOperationList = await checkIdempotency(
      ModuleProvider,
      {
        tables: [tableWithTraitWithoutforeign_key],
        traits: [updatedTrait],
      },
      "",
    );
    expect(newOperationList).toHaveLength(0);
  });
});

describe("extension", () => {
  test("extension is applied in a module", async () => {
    const baseTable: TableI = {
      name: "people",
      columns: [
        {
          name: "first_name",
          type: "text",
        },
      ],
    };

    const extension: TableExtensionI = {
      table: "people",
      columns: [
        {
          name: "last_name",
          type: "text",
        },
      ],
    };

    const moduleWithExtension: ModuleI = {
      tables: [baseTable],
      extensions: [extension],
    };

    const moduleWithoutExtension: ModuleI = {
      tables: [
        {
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
              nullable: true,
            },
          ],
        },
      ],
    };

    const moduleOperationList = await ModuleProvider.reconcile(
      moduleWithExtension,
      moduleWithoutExtension,
    );
    expect(moduleOperationList).toHaveLength(0);
  });
});

describe("fallback tables", () => {
  test("a fallback vanishes if there's another table satisfying the trait", async () => {
    const fallbackTable: TableI = {
      name: "people",
      fallback_for: "nameable",
      implements: [{ trait: "nameable" }],
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: true,
        },
      ],
    };

    const trait: TraitI = {
      name: "nameable",
      requires: {
        columns: [
          {
            name: "first_name",
            type: "text",
            nullable: true,
          },
        ],
      },
    };

    const implementation: TableI = {
      name: "voters",
      implements: [{ trait: "nameable" }],
      columns: [{ name: "first_name", type: "text" }],
    };

    const moduleWithFallback: ModuleI = {
      tables: [fallbackTable, implementation],
      traits: [trait],
    };

    const moduleWithoutFallback: ModuleI = {
      tables: [fallbackTable, implementation],
      traits: [trait],
    };

    const moduleOperationList = await ModuleProvider.reconcile(
      moduleWithFallback,
      moduleWithoutFallback,
    );
    expect(moduleOperationList).toHaveLength(0);
  });

  test("a fallback persists if there's no other table satisfying the trait", async () => {
    const fallbackTable: TableI = {
      name: "people",
      fallback_for: "nameable",
      implements: [{ trait: "nameable" }],
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: true,
        },
      ],
    };

    const nonFallbackClone: TableI = {
      name: "people",
      implements: [{ trait: "nameable" }],
      columns: [
        {
          name: "first_name",
          type: "text",
          nullable: true,
        },
      ],
    };

    const trait: TraitI = {
      name: "nameable",
      requires: {
        columns: [
          {
            name: "first_name",
            type: "text",
          },
        ],
      },
    };

    const moduleWithFallback: ModuleI = {
      tables: [fallbackTable],
      traits: [trait],
    };

    const moduleWithoutFallback: ModuleI = {
      tables: [nonFallbackClone],
      traits: [trait],
    };

    const moduleOperationList = await ModuleProvider.reconcile(
      moduleWithFallback,
      moduleWithoutFallback,
    );
    expect(moduleOperationList).toHaveLength(0);
  });
});

describe("module rollups", () => {
  test("rolling up two modules merges them", async () => {
    const coreModule: ModuleI = {
      tables: [
        {
          name: "people",
          columns: [{ name: "first_name", type: "text" }],
        },
      ],
    };

    const externalModule: ModuleI = {
      tables: [{ name: "events", columns: [{ name: "title", type: "text" }] }],
    };

    const loader = () => Promise.resolve(externalModule);

    const aggregateModule = await rollupDependencies(coreModule, [loader]);

    const opList = await ModuleProvider.reconcile(
      {
        tables: [
          { name: "events", columns: [{ name: "title", type: "text" }] },
          {
            name: "people",
            columns: [{ name: "first_name", type: "text" }],
          },
        ],
      },
      aggregateModule,
    );

    expect(opList).toHaveLength(0);
  });
});

describe("function body trait replacements", () => {
  test("can insert a nameable", async () => {
    const toExpand: ModuleI = {
      tables: [
        {
          name: "people",
          columns: [{ name: "given_name", type: "text" }],
          implements: [
            {
              trait: "nameable",
              via: { columns: { first_name: "given_name" } },
            },
          ],
        },
      ],
      traits: [
        {
          name: "nameable",
          requires: { columns: [{ name: "first_name", type: "text" }] },
        },
      ],
      functions: [
        {
          name: "insert_into_nameable",
          arguments: [{ name: "first_name", type: "text" }],
          language: "sql",
          security: "definer",
          volatility: "volatile",
          requires: [{ trait: "nameable" }],
          returns: "void",
          body:
            "insert into {{ nameable }} ({{ first_name }}) values (insert_into_nameable.first_name)",
        },
      ],
    };

    const toExpandTo: ModuleI = {
      tables: [
        { name: "people", columns: [{ name: "given_name", type: "text" }] },
      ],
      functions: [
        {
          name: "insert_into_nameable",
          arguments: [{ name: "first_name", type: "text" }],
          language: "sql",
          security: "definer",
          volatility: "volatile",
          returns: "void",
          body:
            "insert into people (given_name) values (insert_into_nameable.first_name)",
        },
      ],
    };

    const opList = await ModuleProvider.reconcile(toExpand, toExpandTo);
    expect(opList).toHaveLength(0);
  });
});
