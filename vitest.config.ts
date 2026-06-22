import { defineConfig } from "vitest/config";

/**
 * モノレポ全体の vitest 設定。
 * 各パッケージの `src/**` 直下に置かれた `*.test.ts` を既定のグロブで収集する。
 * カバレッジは純粋ドメイン層（parser/analyzer）の `src` を対象にし、
 * テスト・公開バレル（index.ts）は計測から除外する。
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts", "packages/*/src/**/index.ts"],
      reporter: ["text", "html"],
    },
  },
});
