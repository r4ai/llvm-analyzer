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
});
