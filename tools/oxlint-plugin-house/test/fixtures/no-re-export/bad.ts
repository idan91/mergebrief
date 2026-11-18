export * from "./x"; // reports
export * as ns from "./x"; // reports
export { a } from "./x"; // reports
export { b as renamed } from "./x"; // reports
export type { T } from "./x"; // reports
export * from "pkg"; // reports
export { c } from "pkg/sub"; // reports
export type { P } from "pkg"; // reports
import { d } from "./y";
import type { V } from "./y";
import { e } from "pkg";
import type { W } from "pkg/sub";
export { d }; // reports
export type { V }; // reports
export const f = d; // reports
export type X = V; // reports
export { e }; // reports
export type { W }; // reports
export const g = e; // reports
export type Y = W; // reports
import * as ns from "pkg";
export type X1 = import("pkg").Y; // reports
export type X2 = import("./x").Y; // reports
export type X3 = import("pkg").A.B; // reports
export type X5 = ns.T; // reports
export const h = e as V; // reports
export const i = e satisfies V; // reports
export const j = e!; // reports
export const k = ns.x; // reports
const l = e;
export { l }; // reports
export const m = l; // reports
export import N = require("pkg"); // reports
export import O = ns.Y; // reports
export default e; // reports
export interface P extends V {} // reports
export interface Q extends ns.I {} // reports
import R = require("pkg");
import S = ns.Y;
export { R }; // reports
export const u = R; // reports
export type Z = R; // reports
export { S }; // reports
export const v = S; // reports
export const w = R.member; // reports
const x1 = ns.x;
export { x1 }; // reports
const x2 = R.member;
export { x2 }; // reports
const x3 = ns.x as V;
export { x3 }; // reports
const x4 = x1;
export { x4 }; // reports
export const h2 = <V>e; // reports
const x5 = <V>R.member;
export { x5 }; // reports
type LocalAlias = V;
export type FromLocal = LocalAlias; // reports
type ChainA = W;
type ChainB = ChainA;
type ChainC = ChainB;
export type ChainD = ChainC; // reports
export { LocalAlias }; // reports
export type { ChainB }; // reports
type NsAlias = ns.T;
export type { NsAlias }; // reports
type ImportTypeAlias = import("pkg").Y;
export type { ImportTypeAlias }; // reports
export interface FromLocalInterface extends LocalAlias {} // reports
const { x6 } = ns;
export { x6 }; // reports
const { x: x7 } = ns;
export { x7 }; // reports
export const { x8 } = ns; // reports
export const { member: x9 } = R; // reports
const { member: x10 } = R;
export { x10 }; // reports
const { x11 = 1 } = ns;
export { x11 }; // reports
const { x: x13 = 1 } = ns;
export { x13 }; // reports
export const { x14 = 1 } = ns; // reports
const { member: x15 = 1 } = R;
export { x15 }; // reports
export const { member: x16 = 1 } = R; // reports
const { ...x12 } = ns;
export { x12 };
let l2 = e;
export { l2 }; // reports
var l3 = e;
export { l3 }; // reports
type ForwardEarlier = ForwardMiddle;
type ForwardMiddle = ForwardLater;
type ForwardLater = V;
export type ForwardPublic = ForwardEarlier; // reports
export type { ForwardEarlier }; // reports
export interface FromForward extends ForwardEarlier {} // reports
type CycleA = CycleB;
type CycleB = CycleA;
export type { CycleA };
