import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CI workflow", () => {
  it("pnpm を使う前に Corepack を有効化する", () => {
    const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
      packageManager?: string;
    };
    const workflow = readFileSync(join(".github", "workflows", "ci.yml"), "utf8");

    expect(rootPackage.packageManager).toMatch(/^pnpm@/);

    const corepackEnableIndex = workflow.indexOf("corepack enable");
    const pnpmInstallIndex = workflow.indexOf("pnpm install --frozen-lockfile");

    expect(corepackEnableIndex).toBeGreaterThanOrEqual(0);
    expect(pnpmInstallIndex).toBeGreaterThan(corepackEnableIndex);
  });
});
