/**
 * LLVM IR の空白・インデントを、意味を変えない範囲で安定化する純粋フォーマッタ。
 *
 * 現段階では pretty printer ではなく、行頭・行末空白と関数本体の基本インデントだけを扱う。
 * トップレベル、ラベル、閉じブレースは左詰め、関数内の命令・コメントは2スペース字下げにする。
 */

/**
 * LLVM IR ソース全体を整形する。
 *
 * @param source LLVM IR ソース。
 * @returns 整形後の LLVM IR ソース。
 * @example
 * formatLlvmIr("define void @f() {\nret void\n}")
 * //=> "define void @f() {\n  ret void\n}"
 */
export const formatLlvmIr = (source: string): string => {
  const hasFinalNewline = source.endsWith("\n");
  const lines = source.split("\n");
  const contentLines = hasFinalNewline ? lines.slice(0, -1) : lines;
  let inFunctionBody = false;

  const formatted = contentLines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return "";

    const formattedLine =
      inFunctionBody && !isLabelLine(trimmed) && !isClosingBraceLine(trimmed)
        ? `  ${trimmed}`
        : trimmed;

    if (opensFunctionBody(trimmed)) inFunctionBody = true;
    if (isClosingBraceLine(trimmed)) inFunctionBody = false;
    return formattedLine;
  });

  return `${formatted.join("\n")}${hasFinalNewline ? "\n" : ""}`;
};

const opensFunctionBody = (line: string): boolean =>
  line.startsWith("define ") && /\{\s*(?:;.*)?$/u.test(line);

const isClosingBraceLine = (line: string): boolean => line === "}" || line.startsWith("} ");

const isLabelLine = (line: string): boolean => /^([-A-Za-z$._0-9]+|"[^"]*"):/u.test(line);
