import { A, type T } from "./x";
import type { Foo } from "pkg";
import { schema } from "./schema";

export const own = 1;
export function getOwn(): number {
  return own;
}
export interface Own {
  value: number;
}
export interface Local {
  value: number;
}
export type Alias = Local;
export type Wrapped = Foo<T>;
export type Maybe = T | undefined;
export type AppSchema = typeof schema;
export const member = A.member;
export const list = [A];
export { own as other };
export interface Extended extends Own {
  extra: string;
}
export interface Both extends Own, Foo {}
export interface Instantiated extends Foo<T> {}
const localAlias = own;
export { localAlias };
const memberAlias = A.member;
export { memberAlias };
type LocalWrapped = Foo<T>;
export type FromLocalWrapped = LocalWrapped;
type LocalMaybe = T | undefined;
export type { LocalMaybe };
type LocalSchema = typeof schema;
export type { LocalSchema };
export const { size } = A;
const { size: renamedSize } = A;
export { renamedSize };
export const { length = 0 } = A;
const { size: sizeOrZero = 0 } = A;
export { sizeOrZero };
export type Loaded = import("./loader").Loaded<Own>;
export type ConfigModule = typeof import("./config");
type ForwardWrapped = LaterWrapped;
type LaterWrapped = Foo<T>;
export type FromForwardWrapped = ForwardWrapped;
