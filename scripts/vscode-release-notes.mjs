import { readFileSync } from "node:fs";

const changelogPath = new URL("../packages/vscode-extension/CHANGELOG.md", import.meta.url);
const packageJsonPath = new URL("../packages/vscode-extension/package.json", import.meta.url);
const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8"));

let changelog = "";

try {
  changelog = readFileSync(changelogPath, "utf8");
} catch {
  console.log(`llvm-analyzer-vscode ${version}`);
  process.exit(0);
}

const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^##\\s+${escapedVersion}\\s*$`, "m");
const match = heading.exec(changelog);

if (match === null) {
  console.log(`llvm-analyzer-vscode ${version}`);
  process.exit(0);
}

const bodyStart = match.index + match[0].length;
const nextHeading = /^##\s+/m.exec(changelog.slice(bodyStart));
const bodyEnd = nextHeading === null ? changelog.length : bodyStart + nextHeading.index;
const body = changelog.slice(bodyStart, bodyEnd).trim();

console.log(body.length > 0 ? body : `llvm-analyzer-vscode ${version}`);
