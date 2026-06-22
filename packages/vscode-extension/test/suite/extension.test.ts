import assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionUri =
  vscode.extensions.getExtension("r4ai.llvm-analyzer-vscode")?.extensionUri ??
  vscode.Uri.file(process.cwd());
const helloUri = vscode.Uri.joinPath(extensionUri, "examples", "hello.ll");

suite("LLVM IR 拡張機能 E2E", () => {
  test("hover と definition を LSP 経由で返す", async () => {
    const document = await vscode.workspace.openTextDocument(helloUri);
    await vscode.window.showTextDocument(document);

    const hovers = await retry(() =>
      vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        helloUri,
        new vscode.Position(17, 4),
      ),
    );
    assert.ok(hovers.length > 0);
    assert.match(markdownText(hovers[0]), /%call/);

    const definitions = await retry(() =>
      vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeDefinitionProvider",
        helloUri,
        new vscode.Position(17, 21),
      ),
    );
    assert.equal(definitions[0]?.uri.toString(), helloUri.toString());
    assert.equal(definitions[0]?.range.start.line, 11);
  });

  test("現在関数の CFG を Mermaid として表示する", async () => {
    const document = await vscode.workspace.openTextDocument(helloUri);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(new vscode.Position(14, 2), new vscode.Position(14, 2));

    const mermaid = await vscode.commands.executeCommand<string>(
      "llvm-analyzer.showControlFlowGraph",
    );

    assert.match(mermaid, /^flowchart TD/m);
    assert.match(mermaid, /entry/);
    assert.equal(vscode.window.activeTextEditor?.document.languageId, "markdown");
    assert.match(vscode.window.activeTextEditor?.document.getText() ?? "", /```mermaid/);
  });

  test("rename provider は同一 SSA 値の edit を返す", async () => {
    const document = await vscode.workspace.openTextDocument(helloUri);
    await vscode.window.showTextDocument(document);

    const edit = await retryValue(() =>
      vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        "vscode.executeDocumentRenameProvider",
        helloUri,
        new vscode.Position(17, 4),
        "%result",
      ),
    );
    const changes = edit.get(helloUri);

    assert.equal(changes.length, 2);
    assert.deepEqual(
      changes.map((change) => change.newText),
      ["%result", "%result"],
    );
  });

  test("inlay hint provider は SSA 値の型 hint を返す", async () => {
    const document = await vscode.workspace.openTextDocument(helloUri);
    await vscode.window.showTextDocument(document);

    const hints = await retry(() =>
      vscode.commands.executeCommand<vscode.InlayHint[]>(
        "vscode.executeInlayHintProvider",
        helloUri,
        new vscode.Range(new vscode.Position(13, 0), new vscode.Position(26, 1)),
      ),
    );

    assert.ok(hints.some((hint) => hint.label === ": ptr"));
    assert.ok(hints.some((hint) => hint.label === ": i32"));
  });

  test("関数外では CFG command が undefined を返す", async () => {
    const document = await vscode.workspace.openTextDocument(helloUri);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));

    const mermaid = await vscode.commands.executeCommand<string | undefined>(
      "llvm-analyzer.showControlFlowGraph",
    );

    assert.equal(mermaid, undefined);
  });
});

async function retry<T>(run: () => Thenable<T>, attempts = 20): Promise<T> {
  const result = await run();
  if (!Array.isArray(result) || result.length > 0 || attempts <= 1) return result;
  await new Promise((resolve) => setTimeout(resolve, 150));
  return retry(run, attempts - 1);
}

async function retryValue<T>(run: () => Thenable<T | undefined>, attempts = 20): Promise<T> {
  const result = await run();
  if (result !== undefined) return result;
  if (attempts <= 1) throw new Error("provider did not return a value");
  await new Promise((resolve) => setTimeout(resolve, 150));
  return retryValue(run, attempts - 1);
}

function markdownText(hover: vscode.Hover | undefined): string {
  return (
    hover?.contents
      .map((content) => (typeof content === "string" ? content : content.value))
      .join("\n") ?? ""
  );
}
