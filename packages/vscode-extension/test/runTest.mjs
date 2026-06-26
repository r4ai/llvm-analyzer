import { runTests } from "@vscode/test-electron";
import { mkdtemp, rm } from "node:fs/promises";
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
const testWorkspacePath = path.resolve(extensionDevelopmentPath, "test", "fixtures", "workspace");
const userDataDir = await mkdtemp(path.join("/tmp", "llvm-analyzer-vscode-user-"));
const extensionsDir = await mkdtemp(path.join("/tmp", "llvm-analyzer-vscode-ext-"));

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_ESM_ENTRYPOINT;

try {
  await runTests({
    version: "1.96.0",
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      testWorkspacePath,
      "--disable-workspace-trust",
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
    ],
  });
} finally {
  await Promise.all([
    rm(userDataDir, { recursive: true, force: true }),
    rm(extensionsDir, { recursive: true, force: true }),
  ]);
}
