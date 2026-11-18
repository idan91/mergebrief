// Resolver aliases for dependency-cruiser only; mirrors apps/web's tsconfig
// `paths`. Never read by a bundler.
const path = require("node:path");

module.exports = {
  resolve: { alias: { "@web": path.resolve(__dirname, "apps/web/src") } },
};
