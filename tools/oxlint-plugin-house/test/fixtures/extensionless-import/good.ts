import { readTenant } from "./tenant";
import highlight from "highlight.js";
import sha256 from "crypto-js/sha256.js";
import "./styles.css";
import fixture from "./fixture.json";
export { TENANT_CAP } from "./consts";
export * from "./utils";
export const loadPanel = () => import("./lazy");
export type PanelModule = typeof import("./module");

export const used = [readTenant, highlight, sha256, fixture, loadPanel];
