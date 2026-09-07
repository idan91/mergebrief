// Path shim: the manifest-freshness suite pins this exact file as its "route
// source" for mtime staleness; the pulls domain lives in `./pulls/`.
export { pullsRoute } from "./pulls/index";
