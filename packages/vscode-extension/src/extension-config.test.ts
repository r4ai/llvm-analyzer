import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FileSystemWatcher } from "vscode";
import { buildClientOptions, buildServerOptions } from "./extension-config.ts";

describe("extension config", () => {
  it("server options は run/debug とも同じ server module を IPC で起動する", () => {
    expect(buildServerOptions("/extension/dist/server.js", 1)).toEqual({
      run: { module: "/extension/dist/server.js", transport: 1 },
      debug: {
        module: "/extension/dist/server.js",
        transport: 1,
        options: { execArgv: ["--nolazy", "--inspect=6009"] },
      },
    });
  });

  it("client options は LLVM file document と設定・ファイル監視を同期する", () => {
    const watcher = { dispose: () => undefined } as FileSystemWatcher;

    expect(buildClientOptions(watcher)).toEqual({
      documentSelector: [{ scheme: "file", language: "llvm" }],
      synchronize: {
        configurationSection: [
          "llvm-analyzer.verifier",
          "llvm-analyzer.diagnostics",
          "llvm-analyzer.inlayHints",
        ],
        fileEvents: watcher,
      },
    });
  });

  it("外部 verifier 実行を含むためWorkspace Trustを必須にする", () => {
    const manifest = JSON.parse(readFileSync("packages/vscode-extension/package.json", "utf8")) as {
      capabilities?: {
        untrustedWorkspaces?: {
          supported?: boolean;
        };
      };
    };

    expect(manifest.capabilities?.untrustedWorkspaces).toEqual({
      supported: false,
      description:
        "LLVM verifier command settings can execute external tools, so this extension requires a trusted workspace.",
    });
  });
});
