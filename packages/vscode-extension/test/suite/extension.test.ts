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
});

async function retry<T>(run: () => Thenable<T>, attempts = 20): Promise<T> {
  const result = await run();
  if (!Array.isArray(result) || result.length > 0 || attempts <= 1) return result;
  await new Promise((resolve) => setTimeout(resolve, 150));
  return retry(run, attempts - 1);
}

function markdownText(hover: vscode.Hover | undefined): string {
  return (
    hover?.contents
      .map((content) => (typeof content === "string" ? content : content.value))
      .join("\n") ?? ""
  );
}
