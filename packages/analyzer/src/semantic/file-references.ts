import { tokenize, type Module, type Range, type Token } from "@llvm-analyzer/parser";

/** ファイル参照候補の出所。 */
export type FileReferenceSource = "source_filename" | "debug-metadata";

/** LLVM IR から抽出した、解決前のファイル参照候補。 */
export interface FileReferenceCandidate {
  /** LLVM IR 内に記録されているファイルパス。 */
  readonly path: string;
  /** エディタ上でリンク化する文字列部分の範囲。 */
  readonly range: Range;
  /** 候補を抽出した IR 構造。 */
  readonly source: FileReferenceSource;
}

/**
 * LLVM IR の AST とソースから、ファイル参照として扱える文字列を抽出する。
 *
 * `source_filename` と `!DIFile(filename:, directory:)` のみを対象にし、コメント内 URL や
 * 任意の文字列リテラルは拾わない。存在確認や URI 解決は呼び出し側で行う。
 *
 * @param ast `parseModule` が返した AST。
 * @param source AST の元になった LLVM IR ソース。
 * @returns ソース出現順のファイル参照候補。
 * @example
 * collectFileReferenceCandidates(parseModule('source_filename = "main.c"').ast, source)
 */
export const collectFileReferenceCandidates = (
  ast: Module,
  source: string,
): FileReferenceCandidate[] => {
  const tokens = tokenize(source).filter((token) => token.kind !== "Eof");
  const candidates: FileReferenceCandidate[] = [];
  let tokenIndex = 0;

  for (const entry of ast.entries) {
    while (
      tokenIndex < tokens.length &&
      (tokens[tokenIndex]?.range.start.offset ?? source.length) < entry.range.start.offset
    ) {
      tokenIndex += 1;
    }
    let entryEnd = tokenIndex;
    while (
      entryEnd < tokens.length &&
      (tokens[entryEnd]?.range.end.offset ?? source.length + 1) <= entry.range.end.offset
    ) {
      entryEnd += 1;
    }
    const entryTokens = tokens.slice(tokenIndex, entryEnd);
    tokenIndex = entryEnd;

    if (entry.kind === "SourceFilename") {
      const filename = entryTokens.find((token) => token.kind === "String");
      if (!filename) continue;
      const path = decodeLlvmString(filename.value);
      if (path.length === 0) continue;
      candidates.push({
        path,
        range: innerStringRange(filename),
        source: "source_filename",
      });
      continue;
    }

    if (entry.kind !== "MetadataDefinition" || !hasDiFileTag(entryTokens)) continue;
    const filename = namedString(entryTokens, "filename");
    if (!filename) continue;
    const directory = namedString(entryTokens, "directory");
    const filenamePath = decodeLlvmString(filename.value);
    if (filenamePath.length === 0) continue;
    const directoryPath = directory ? decodeLlvmString(directory.value) : undefined;
    candidates.push({
      path: combineDirectory(directoryPath, filenamePath),
      range: innerStringRange(filename),
      source: "debug-metadata",
    });
  }

  return candidates;
};

const hasDiFileTag = (tokens: readonly Token[]): boolean =>
  tokens.some((token) => token.value === "!DIFile");

const namedString = (tokens: readonly Token[], name: string): Token | undefined => {
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const key = tokens[index];
    const colon = tokens[index + 1];
    const value = tokens[index + 2];
    if (key?.value === name && colon?.value === ":" && value?.kind === "String") return value;
  }
  return undefined;
};

const decodeLlvmString = (value: string): string => {
  const inner = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  return inner.replace(/\\([0-9A-Fa-f]{2}|[\\"])/gu, (_match, escaped: string) => {
    if (/^[0-9A-Fa-f]{2}$/u.test(escaped)) {
      return String.fromCharCode(Number.parseInt(escaped, 16));
    }
    return escaped;
  });
};

const innerStringRange = (token: Token): Range => ({
  start: {
    offset: token.range.start.offset + 1,
    line: token.range.start.line,
    column: token.range.start.column + 1,
  },
  end: {
    offset: token.range.end.offset - (token.value.endsWith('"') ? 1 : 0),
    line: token.range.end.line,
    column: token.range.end.column - (token.value.endsWith('"') ? 1 : 0),
  },
});

const combineDirectory = (directory: string | undefined, filename: string): string => {
  if (!directory || isAbsoluteLike(filename)) return filename;
  if (directory.endsWith("/") || directory.endsWith("\\")) return `${directory}${filename}`;
  return `${directory}/${filename}`;
};

const isAbsoluteLike = (filePath: string): boolean =>
  filePath.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(filePath);
