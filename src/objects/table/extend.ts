import {
  TableI,
  TableExtensionI,
  TraitImplementationI,
  TraitRequirementI,
  TriggerI,
} from "./records";
import { render } from "mustache";

const identity = (
  _traitImplementation: TraitImplementationI | undefined,
  _traitRequirement: TraitRequirementI | undefined,
) => (x: any) => x;

const makeTransformTrigger = (
  traitImplementation: TraitImplementationI | undefined,
  traitRequirement: TraitRequirementI | undefined,
) => (trigger: TriggerI) => {
  if (traitImplementation === undefined || traitRequirement === undefined) {
    return trigger;
  }

  const traitVars = (traitRequirement.columns || []).reduce(
    (acc, col) =>
      Object.assign(acc, {
        [col.name]:
          traitImplementation.via && traitImplementation.via.columns
            ? traitImplementation.via.columns[col.name]
            : col.name,
      }),
    {},
  );

  return Object.assign({}, trigger, {
    body: render(trigger.body, traitVars),
  });
};

type Transformer<T> = (
  TraitImplementation: TraitImplementationI | undefined,
  traitRequirement: TraitRequirementI | undefined,
) => (el: T) => T;

const propsWithTransformers: [string, Transformer<any>][] = [
  ["columns", identity],
  ["indexes", identity],
  ["triggers", makeTransformTrigger],
  ["checks", identity],
  ["uniques", identity],
  ["foreignKeys", identity],
];

export const extendTable = (
  table: TableI,
  extension: TableExtensionI,
  traitImplementation: TraitImplementationI,
  traitRequirement: TraitRequirementI,
): TableI => {
  const result = Object.assign({}, table);
  console.log("extension", extension);

  for (const [prop, transformer] of propsWithTransformers) {
    result[prop] = (table[prop] || []).concat(
      (extension[prop] || []).map((el: any) =>
        transformer(traitImplementation, traitRequirement)(el),
      ),
    );

    console.log(prop);
    console.log("result[prop]", result[prop]);
  }

  return result;
};
