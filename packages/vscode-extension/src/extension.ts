import * as path from "node:path";
import {
  CONTROL_FLOW_GRAPH_REQUEST,
  type ControlFlowGraphRequestParams,
} from "@llvm-analyzer/language-server";
import type { ExtensionContext } from "vscode";
import { commands, window, workspace } from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { buildClientOptions, buildServerOptions } from "./extension-config.ts";

let client: LanguageClient | undefined;

/**
 * LLVM IR Language Server を起動する。
 *
 * @param context VSCode 拡張機能の実行コンテキスト。
 */
export const activate = async (context: ExtensionContext): Promise<void> => {
  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions = buildServerOptions(serverModule, TransportKind.ipc);
  const clientOptions = buildClientOptions(workspace.createFileSystemWatcher("**/*.ll"));

  client = new LanguageClient(
    "llvm-analyzer",
    "LLVM IR Language Server",
    serverOptions,
    clientOptions,
  );
  context.subscriptions.push(client);
  context.subscriptions.push(
    commands.registerCommand("llvm-analyzer.showControlFlowGraph", showControlFlowGraph),
  );
  await client.start();
};

/** 拡張機能の停止時に Language Server を終了する。 */
export const deactivate = async (): Promise<void> => {
  await client?.stop();
  client = undefined;
};

/**
 * 現在の LLVM IR 関数の CFG を Mermaid として表示する。
 *
 * @returns 表示した Mermaid テキスト。関数外では undefined。
 */
export const showControlFlowGraph = async (): Promise<string | undefined> => {
  const editor = window.activeTextEditor;
  if (!editor || editor.document.languageId !== "llvm") return undefined;
  const mermaid = await client?.sendRequest<string | null>(CONTROL_FLOW_GRAPH_REQUEST, {
    textDocument: { uri: editor.document.uri.toString() },
    position: editor.selection.active,
  } satisfies ControlFlowGraphRequestParams);
  if (!mermaid) {
    void window.showInformationMessage("現在位置に LLVM IR 関数がありません。");
    return undefined;
  }
  const document = await workspace.openTextDocument({
    language: "markdown",
    content: ["```mermaid", mermaid, "```", ""].join("\n"),
  });
  await window.showTextDocument(document, { preview: false });
  return mermaid;
};
