import * as path from "node:path";
import type { ExtensionContext } from "vscode";
import { workspace } from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

/**
 * LLVM IR Language Server を起動する。
 *
 * @param context VSCode 拡張機能の実行コンテキスト。
 */
export const activate = async (context: ExtensionContext): Promise<void> => {
  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "llvm" }],
    synchronize: {
      configurationSection: ["llvm-analyzer.verifier", "llvm-analyzer.diagnostics"],
      fileEvents: workspace.createFileSystemWatcher("**/*.ll"),
    },
  };

  client = new LanguageClient(
    "llvm-analyzer",
    "LLVM IR Language Server",
    serverOptions,
    clientOptions,
  );
  context.subscriptions.push(client);
  await client.start();
};

/** 拡張機能の停止時に Language Server を終了する。 */
export const deactivate = async (): Promise<void> => {
  await client?.stop();
  client = undefined;
};
