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
  return formatFragment(source, false);
};

/**
 * LLVM IRの一部分を、開始位置の関数内外を指定して整形する。
 *
 * @param source 行境界で切り出したLLVM IR。
 * @param inFunctionBody 断片の先頭が関数本体内ならtrue。
 * @returns 整形後のLLVM IR断片。
 *
 * @remarks
 * Range Formattingで文書全体を走査せず、選択行だけを整形するためのAPIである。
 * `source`の途中に関数の開始行または閉じ括弧があれば、後続行の状態も更新する。
 */
export const formatLlvmIrFragment = (source: string, inFunctionBody: boolean): string =>
  formatFragment(source, inFunctionBody);

const formatFragment = (source: string, initialInFunctionBody: boolean): string => {
  const hasFinalNewline = source.endsWith("\n");
  const lines = source.split("\n");
  const contentLines = hasFinalNewline ? lines.slice(0, -1) : lines;
  let inFunctionBody = initialInFunctionBody;

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
