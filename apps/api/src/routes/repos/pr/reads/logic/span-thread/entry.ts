// A worker thread starts on plain Node, which strips this file's types but
// cannot resolve the workspace's extensionless TypeScript imports; tsx loads
// the thread body.
import { tsImport } from "tsx/esm/api";

await tsImport("./thread-body", import.meta.url);
