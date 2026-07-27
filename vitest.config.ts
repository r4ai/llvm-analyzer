import { defineConfig } from "vitest/config";

/**
 * モノレポ全体の vitest 設定。
 * 各パッケージの `src/**` 直下に置かれた `*.test.ts` を既定のグロブで収集する。
 * カバレッジは `src` の実装を対象にする。
 * テスト・公開バレル（index.ts）と起動副作用を持つ entrypoint は計測から除外し、
 * entrypoint 配線は切り出した helper と E2E で検証する。
 */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "scripts/stable-benchmark.mts"],
      exclude: [
        "packages/*/src/**/*.test.ts",
        "packages/*/src/**/index.ts",
        "packages/language-server/src/server.ts",
        "packages/vscode-extension/src/extension.ts",
        "scripts/**/*.test.ts",
      ],
      reporter: ["text", "html"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
