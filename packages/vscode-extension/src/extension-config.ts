import type { FileSystemWatcher } from "vscode";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";

const CONFIGURATION_SECTIONS = [
  "llvm-analyzer.verifier",
  "llvm-analyzer.diagnostics",
  "llvm-analyzer.inlayHints",
];

/**
 * Language Server 起動オプションを作る。
 *
 * @param serverModule bundle 済み server.js の絶対パス。
 * @param transport IPC transport 種別。
 * @returns LanguageClient へ渡す server options。
 */
export const buildServerOptions = (serverModule: string, transport: number): ServerOptions => ({
  run: { module: serverModule, transport },
  debug: {
    module: serverModule,
    transport,
    options: { execArgv: ["--nolazy", "--inspect=6009"] },
  },
});

/**
 * LanguageClient の監視・対象ドキュメント設定を作る。
 *
 * @param fileEvents `.ll` ファイル監視 watcher。
 * @returns LanguageClient へ渡す client options。
 */
export const buildClientOptions = (fileEvents: FileSystemWatcher): LanguageClientOptions => ({
  documentSelector: [{ scheme: "file", language: "llvm" }],
  synchronize: {
    configurationSection: CONFIGURATION_SECTIONS,
    fileEvents,
  },
});
