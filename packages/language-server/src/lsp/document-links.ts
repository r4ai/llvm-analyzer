import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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

const MAX_DOCUMENT_LINK_CANDIDATES = 512;

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
  const candidates = collectFileReferenceCandidates(snapshot.parse.ast, snapshot.text).slice(
    0,
    MAX_DOCUMENT_LINK_CANDIDATES,
  );
  const existsCache = new Map<string, Promise<boolean>>();
  const targetPaths = await Promise.all(
    candidates.map((candidate) =>
      firstExistingPath(candidate.path, bases, fileExists, existsCache),
    ),
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
  existsCache: Map<string, Promise<boolean>>,
): Promise<string | undefined> => {
  const paths = candidatePathsWithinBases(candidatePath, bases, bases);
  const results = await Promise.all(
    paths.map(async (filePath) => ({
      filePath,
      exists: await cachedFileExists(filePath, fileExists, existsCache),
    })),
  );
  return results.find((result) => result.exists)?.filePath;
};

const cachedFileExists = (
  filePath: string,
  fileExists: (filePath: string) => Promise<boolean>,
  existsCache: Map<string, Promise<boolean>>,
): Promise<boolean> => {
  const existing = existsCache.get(filePath);
  if (existing) return existing;
  const exists = fileExists(filePath);
  existsCache.set(filePath, exists);
  return exists;
};

const candidatePathsWithinBases = (
  candidatePath: string,
  bases: readonly string[],
  allowedRoots: readonly string[],
): string[] => {
  if (bases.length === 0) return [];
  if (isAbsolute(candidatePath)) {
    const absolutePath = resolve(candidatePath);
    return allowedRoots.some((root) => isWithinBase(absolutePath, root)) ? [absolutePath] : [];
  }
  return bases
    .map((base) => resolve(join(base, candidatePath)))
    .filter(
      (filePath, _index, all) =>
        allowedRoots.some((root) => isWithinBase(filePath, root)) &&
        all.indexOf(filePath) === _index,
    );
};

const isWithinBase = (filePath: string, base: string): boolean => {
  const normalizedBase = resolve(base);
  const relation = relative(normalizedBase, filePath);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
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
