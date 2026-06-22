import { build } from "esbuild";

const production = process.argv.includes("--production");

/** @type {import("esbuild").BuildOptions[]} */
const builds = [
  {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    outfile: "dist/extension.js",
    sourcemap: !production,
    sourcesContent: false,
  },
  {
    entryPoints: ["../language-server/src/server.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: "dist/server.js",
    sourcemap: !production,
    sourcesContent: false,
  },
];

await Promise.all(builds.map((options) => build({ ...options, minify: production })));
