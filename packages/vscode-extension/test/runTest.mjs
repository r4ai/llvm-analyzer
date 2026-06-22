import { runTests } from "@vscode/test-electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = path.resolve(dirname, "..");
const extensionTestsPath = path.resolve(
  extensionDevelopmentPath,
  "dist",
  "test",
  "suite",
  "index.js",
);

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_ESM_ENTRYPOINT;

await runTests({
  version: "1.96.0",
  extensionDevelopmentPath,
  extensionTestsPath,
});
