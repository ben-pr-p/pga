import { String, Runtype, Static, Record } from "runtypes";
import { PoolClient } from "pg";

export const PgIdentifier = String.withConstraint(
  s => s.match(/[^a-z0-9_]/) === null,
  { name: "PgIdentifier should be all alphanumeric lower case" },
).withConstraint(s => s[0].match(/[0-9]/) === null, {
  name: "PgIdentifier should not start with a number",
});

export type PgIdentifierI = Static<typeof PgIdentifier>;

export const RunContext = Record({
  schema: PgIdentifier,
});

export interface RunContextI extends Static<typeof RunContext> {}

export interface PgObject<ObjectType, OperationType> {
  record: Runtype<ObjectType>;
  introspect: (
    client: PoolClient,
    identifier: PgIdentifierI,
    context: RunContextI,
  ) => Promise<ObjectType>;
  reconcile: (
    desired: ObjectType,
    current: ObjectType | undefined,
  ) => OperationType[];
  toStatement: (context: RunContextI) => (operation: OperationType) => string;
}

interface NameableObject {
  name: string;
  previous_name?: string;
}

type IdentityFunction<T> = (desired: T, current: T) => boolean;

export const createOperationsForNameableObject = <ObjectType, OperationType>(
  desiredObjects: (NameableObject & ObjectType)[] | undefined,
  currentObjects: (NameableObject & ObjectType)[] | undefined,
  reconcileFn: (
    desired: ObjectType | undefined,
    current: ObjectType | undefined,
  ) => OperationType[],
): OperationType[] => {
  const identityByName: IdentityFunction<ObjectType> = <ObjectType>(
    desired: NameableObject & ObjectType,
    current: NameableObject & ObjectType,
  ) => desired.name === current.name || desired.previous_name === current.name;

  return createOperationsForObjectWithIdentityFunction(
    desiredObjects,
    currentObjects,
    reconcileFn,
    identityByName,
  );
};

export const createOperationsForObjectWithIdentityFunction = <
  ObjectType,
  OperationType
>(
  desiredObjects: ObjectType[] | undefined,
  currentObjects: ObjectType[] | undefined,
  reconcileFn: (
    desired: ObjectType | undefined,
    current: ObjectType | undefined,
  ) => OperationType[],
  identityFunction: IdentityFunction<ObjectType>,
): OperationType[] => {
  const dObjects = desiredObjects || [];
  const cObjects = currentObjects || [];

  // Accumulate create or alter operations
  const createOrAlterOperations: OperationType[] = dObjects.reduce(
    (acc: OperationType[], desired) => {
      const current = cObjects.find(current =>
        identityFunction(desired, current),
      );

      return acc.concat(reconcileFn(desired, current));
    },
    [],
  );

  const dropOperations: OperationType[] = cObjects.reduce(
    (acc: OperationType[], current) => {
      const desired = dObjects.find(desired =>
        identityFunction(desired, current),
      );

      return acc.concat(
        desired === undefined ? reconcileFn(undefined, current) : [],
      );
    },
    [],
  );

  return createOrAlterOperations.concat(dropOperations);
};
