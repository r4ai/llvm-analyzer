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

  test("主要な LSP provider を fixture workspace 上で返す", async () => {
    const mainUri = fixtureUri("main.ll");
    const document = await vscode.workspace.openTextDocument(mainUri);
    await vscode.window.showTextDocument(document);

    const completions = await retryUntil(
      () =>
        vscode.commands.executeCommand<vscode.CompletionList>(
          "vscode.executeCompletionItemProvider",
          mainUri,
          new vscode.Position(13, 10),
        ),
      (result) => result.items.length > 0,
    );
    assert.ok(completions.items.some((item) => item.label === "%sum"));
    assert.ok(completions.items.some((item) => item.label === "@helper"));

    const symbols = await retry(() =>
      vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        mainUri,
      ),
    );
    assert.deepEqual(
      symbols.map((symbol) => symbol.name),
      ["@helper", "@main"],
    );

    const references = await retry(() =>
      vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        mainUri,
        new vscode.Position(10, 13),
      ),
    );
    assert.ok(references.some((location) => location.range.start.line === 2));
    assert.ok(references.some((location) => location.range.start.line === 10));

    const folds = await retry(() =>
      vscode.commands.executeCommand<vscode.FoldingRange[]>(
        "vscode.executeFoldingRangeProvider",
        mainUri,
      ),
    );
    assert.ok(folds.some((fold) => fold.start === 2 && fold.end === 5));
    assert.ok(folds.some((fold) => fold.start === 7 && fold.end === 14));

    const links = await retry(() =>
      vscode.commands.executeCommand<vscode.DocumentLink[]>("vscode.executeLinkProvider", mainUri),
    );
    assert.equal(links[0]?.target?.toString(), fixtureUri("src", "main.c").toString());
  });

  test("workspace symbol と call hierarchy は複数ファイルをまたいで返す", async () => {
    assert.ok(vscode.workspace.workspaceFolders?.length, "fixture workspace が開かれていません");
    const callerUri = fixtureUri("caller.ll");
    const calleeUri = fixtureUri("callee.ll");

    const workspaceSymbols = await retry(() =>
      vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        "@callee",
      ),
    );
    assert.ok(
      workspaceSymbols.some(
        (symbol) =>
          symbol.name === "@callee" && symbol.location.uri.toString() === calleeUri.toString(),
      ),
    );

    await vscode.workspace.openTextDocument(callerUri);
    await vscode.workspace.openTextDocument(calleeUri);

    const callers = await retry(() =>
      vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        "vscode.prepareCallHierarchy",
        callerUri,
        new vscode.Position(0, 14),
      ),
    );
    const callees = await retry(() =>
      vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        "vscode.prepareCallHierarchy",
        calleeUri,
        new vscode.Position(0, 14),
      ),
    );

    const outgoing = await retry(() =>
      vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
        "vscode.provideOutgoingCalls",
        callers[0],
      ),
    );
    assert.ok(outgoing.some((call) => call.to.name === "@callee"));

    const incoming = await retry(() =>
      vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
        "vscode.provideIncomingCalls",
        callees[0],
      ),
    );
    assert.ok(incoming.some((call) => call.from.name === "@caller"));
  });

  test("diagnostics と quick fix を VSCode 経由で返す", async () => {
    const brokenUri = fixtureUri("broken.ll");
    const document = await vscode.workspace.openTextDocument(brokenUri);
    await vscode.window.showTextDocument(document);

    const diagnostics = await retryUntil(
      () => vscode.languages.getDiagnostics(brokenUri),
      (result) => result.some((diagnostic) => diagnostic.message.includes("%enrty")),
    );
    const diagnostic = diagnostics.find((item) => item.message.includes("%enrty"));
    assert.ok(diagnostic);

    const actions = await retryUntil(
      () =>
        vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
          "vscode.executeCodeActionProvider",
          brokenUri,
          diagnostic.range,
          vscode.CodeActionKind.QuickFix.value,
        ),
      (result) => result.some((action) => "edit" in action && action.title.includes("%entry")),
    );
    assert.ok(actions.some((action) => action.title.includes("%entry")));
  });

  test("format provider はインデントを安定化する edit を返す", async () => {
    const formatUri = fixtureUri("format.ll");
    const document = await vscode.workspace.openTextDocument(formatUri);
    await vscode.window.showTextDocument(document);

    const edits = await retry(() =>
      vscode.commands.executeCommand<vscode.TextEdit[]>(
        "vscode.executeFormatDocumentProvider",
        formatUri,
        { tabSize: 2, insertSpaces: true },
      ),
    );

    assert.match(applyTextEdits(document, edits), /^  ret void$/m);
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

async function retryUntil<T>(
  run: () => T | Thenable<T>,
  isReady: (result: T) => boolean,
  attempts = 20,
): Promise<T> {
  const result = await run();
  if (isReady(result) || attempts <= 1) return result;
  await new Promise((resolve) => setTimeout(resolve, 150));
  return retryUntil(run, isReady, attempts - 1);
}

function markdownText(hover: vscode.Hover | undefined): string {
  return (
    hover?.contents
      .map((content) => (typeof content === "string" ? content : content.value))
      .join("\n") ?? ""
  );
}

function applyTextEdits(document: vscode.TextDocument, edits: readonly vscode.TextEdit[]): string {
  let text = document.getText();
  const sorted = [...edits].toSorted(
    (left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start),
  );
  for (const edit of sorted) {
    const start = document.offsetAt(edit.range.start);
    const end = document.offsetAt(edit.range.end);
    text = `${text.slice(0, start)}${edit.newText}${text.slice(end)}`;
  }
  return text;
}

function fixtureUri(...paths: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("fixture workspace が開かれていません");
  return vscode.Uri.joinPath(folder.uri, ...paths);
}
