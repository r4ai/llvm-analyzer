import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectFileReferenceCandidates } from "@llvm-analyzer/analyzer";
import type { DocumentLink, Range as LspRange } from "vscode-languageserver";
import type { DocumentSnapshot } from "./features.ts";

export interface DocumentLinkOptions {
  readonly workspaceFolderUris: readonly string[];
  readonly fileExists?: (filePath: string) => Promise<boolean>;
}

/** documentLink provider の capability 宣言。 */
export const documentLinkProviderCapability = { resolveProvider: false };

/**
 * `source_filename` と debug metadata のファイル参照を DocumentLink へ変換する。
 *
 * 存在するローカルファイルだけをリンク化する。相対パスは IR ファイルのディレクトリ、続いて
 * workspace folder から順に解決する。
 *
 * @param snapshot 解析済みドキュメント。
 * @param options workspace folder と存在確認関数。
 * @returns LSP DocumentLink の配列。
 */
export const getDocumentLinks = async (
  snapshot: DocumentSnapshot,
  options: DocumentLinkOptions,
): Promise<DocumentLink[]> => {
  const fileExists = options.fileExists ?? defaultFileExists;
  const bases = resolutionBases(snapshot.uri, options.workspaceFolderUris);
  const candidates = collectFileReferenceCandidates(snapshot.parse.ast, snapshot.text);
  const targetPaths = await Promise.all(
    candidates.map((candidate) => firstExistingPath(candidate.path, bases, fileExists)),
  );

  return candidates.flatMap((candidate, index) => {
    const targetPath = targetPaths[index];
    if (!targetPath) return [];
    return [
      {
        range: toLspRange(candidate.range),
        target: pathToFileURL(targetPath).toString(),
        tooltip: candidate.path,
      },
    ];
  });
};

const firstExistingPath = async (
  candidatePath: string,
  bases: readonly string[],
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<string | undefined> => {
  const paths = isAbsolute(candidatePath)
    ? [normalize(candidatePath)]
    : bases.map((base) => normalize(join(base, candidatePath)));
  const existsResults = await Promise.all(paths.map((filePath) => fileExists(filePath)));
  return paths.find((_filePath, index) => existsResults[index] === true);
};

const resolutionBases = (documentUri: string, workspaceFolderUris: readonly string[]): string[] => {
  const bases: string[] = [];
  try {
    bases.push(dirname(fileURLToPath(documentUri)));
  } catch {
    // file URI ではないドキュメントは workspace folder だけで解決する。
  }
  for (const folderUri of workspaceFolderUris) {
    try {
      bases.push(fileURLToPath(folderUri));
    } catch {
      // 不正な workspace folder URI は無視する。
    }
  }
  return [...new Set(bases)];
};

const defaultFileExists = async (filePath: string): Promise<boolean> => {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
};

const toLspRange = (range: {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}): LspRange => ({
  start: { line: range.start.line, character: range.start.column },
  end: { line: range.end.line, character: range.end.column },
});
