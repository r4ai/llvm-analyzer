import { classifyBareword } from "./keywords.ts";
import type { Position, Token, TokenKind } from "./token.ts";

/** 単一文字の記号トークン。 */
const PUNCTUATORS = new Set("=,{}()[]<>*:|");

/** 接頭辞付き識別子の名前に使える文字（`@name` の `name` 部分）。 */
const NAME_CHAR = /[-A-Za-z$._0-9]/;
/** 名前の先頭になれる文字（数字を除く）。 */
const NAME_START = /[-A-Za-z$._]/;
/** バーワード（記号なしの語）の先頭になれる文字。 */
const BAREWORD_START = /[A-Za-z._]/;

/** C 互換の 16 進浮動小数リテラル。 */
const C_HEX_FLOAT =
  /[-+]?0[xX](?:(?:[0-9A-Fa-f]+\.[0-9A-Fa-f]*)|(?:\.[0-9A-Fa-f]+)|(?:[0-9A-Fa-f]+))[pP][-+]?\d+/y;
/** `f0x...` 形式の正確な浮動小数ビット列リテラル。 */
const PRECISE_FLOAT_BITS = /[fF]0[xX][0-9A-Fa-f]+/y;
/** `s0x` / `u0x` 形式の整数リテラル。 */
const SIGNED_HEX_INTEGER = /[su]0[xX][0-9A-Fa-f]+/y;
/** `0x` 16進・特殊float リテラル。 */
const HEX_NUMBER = /0[xX][KLMHR]?[0-9A-Fa-f]+/y;
/** `+nan(0x1)` / `-snan(0x1)` などの NaN payload リテラル。 */
const NAN_WITH_PAYLOAD = /[-+]?(?:nan|qnan|snan)\(0[xX][0-9A-Fa-f]+\)(?![-A-Za-z$._0-9])/y;
/** `+inf` / `-qnan` などの特殊浮動小数リテラル。 */
const SPECIAL_FLOAT = /[-+]?(?:inf|nan|qnan|snan)(?![-A-Za-z$._0-9])/y;
/** 整数・浮動小数リテラル（符号・指数・先頭ドットを含む）。 */
const DEC_NUMBER = /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?/y;

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

/**
 * LLVM IR ソースを `range` 付きのトークン列へ分解する純粋関数。
 * 空白はスキップし、末尾に必ずゼロ幅の `Eof` トークンを1つ付与する。
 * 不正な文字は `Unknown` トークンとして残し、解析を止めない（エラー回復）。
 *
 * @param source LLVM IR のソース文字列
 * @returns 出現順のトークン列（末尾は `Eof`）
 * @example
 * tokenize("%x = add i32 1, 2")
 * //=> LocalIdentifier(%x), Punctuation(=), Opcode(add), Type(i32),
 * //   Number(1), Punctuation(,), Number(2), Eof
 */
export const tokenize = (source: string): Token[] => {
  const length = source.length;
  const lineStarts = computeLineStarts(source);
  const positionAt = (offset: number): Position => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { offset, line: lo, column: offset - (lineStarts[lo] ?? 0) };
  };

  const tokens: Token[] = [];
  const emit = (kind: TokenKind, start: number, end: number): void => {
    tokens.push({
      kind,
      value: source.slice(start, end),
      range: { start: positionAt(start), end: positionAt(end) },
    });
  };

  /** `pos` 以降の文字列リテラルの終端（閉じ引用符の次、または EOF）を返す。 */
  const scanString = (start: number): number => {
    let end = start + 1;
    while (end < length && source[end] !== '"') end += 1;
    return end < length ? end + 1 : end;
  };

  /** `pos` 以降の名前文字を読み進めた終端を返す。 */
  const scanName = (start: number): number => {
    let end = start;
    while (end < length && NAME_CHAR.test(source[end] ?? "")) end += 1;
    return end;
  };

  /** 接頭辞 `@`/`%`/`$` 付き識別子を処理する。 */
  const lexSigilIdentifier = (pos: number, kind: TokenKind): number => {
    const next = source[pos + 1];
    if (next === '"') {
      const end = scanString(pos + 1);
      emit(kind, pos, end);
      return end;
    }
    if (next !== undefined && (NAME_START.test(next) || isDigit(next))) {
      const end = scanName(pos + 1);
      emit(kind, pos, end);
      return end;
    }
    emit("Unknown", pos, pos + 1);
    return pos + 1;
  };

  /** `pos` から数値リテラルにマッチすればその終端、しなければ null。 */
  const matchNumber = (pos: number): number | null => {
    for (const re of [
      C_HEX_FLOAT,
      PRECISE_FLOAT_BITS,
      SIGNED_HEX_INTEGER,
      HEX_NUMBER,
      NAN_WITH_PAYLOAD,
      SPECIAL_FLOAT,
      DEC_NUMBER,
    ]) {
      re.lastIndex = pos;
      const matched = re.exec(source);
      if (matched && matched.index === pos && matched[0].length > 0) {
        return pos + matched[0].length;
      }
    }
    return null;
  };

  let pos = 0;
  while (pos < length) {
    const ch = source[pos] ?? "";

    // 空白はスキップ
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      pos += 1;
      continue;
    }

    // コメント `;` から行末まで
    if (ch === ";") {
      let end = pos + 1;
      while (end < length && source[end] !== "\n") end += 1;
      emit("Comment", pos, end);
      pos = end;
      continue;
    }
    if (ch === "/" && source[pos + 1] === "*") {
      const close = source.indexOf("*/", pos + 2);
      const end = close >= 0 ? close + 2 : length;
      emit("Comment", pos, end);
      pos = end;
      continue;
    }

    // 文字列
    if (ch === '"') {
      const end = scanString(pos);
      emit("String", pos, end);
      pos = end;
      continue;
    }

    // 接頭辞付き識別子
    if (ch === "@") {
      pos = lexSigilIdentifier(pos, "GlobalIdentifier");
      continue;
    }
    if (ch === "%") {
      pos = lexSigilIdentifier(pos, "LocalIdentifier");
      continue;
    }
    if (ch === "$") {
      pos = lexSigilIdentifier(pos, "ComdatIdentifier");
      continue;
    }
    if (ch === "!") {
      const next = source[pos + 1];
      if (next !== undefined && (NAME_START.test(next) || isDigit(next))) {
        const end = scanName(pos + 1);
        emit("MetadataIdentifier", pos, end);
        pos = end;
      } else {
        emit("Punctuation", pos, pos + 1);
        pos += 1;
      }
      continue;
    }
    if (ch === "#") {
      const next = source[pos + 1];
      if (isDigit(next)) {
        let end = pos + 1;
        while (end < length && isDigit(source[end])) end += 1;
        emit("AttributeGroup", pos, end);
        pos = end;
      } else if (next !== undefined && NAME_START.test(next)) {
        const end = scanName(pos + 1);
        if (source.slice(pos + 1, end).startsWith("dbg_")) {
          emit("DebugRecord", pos, end);
          pos = end;
        } else {
          emit("Punctuation", pos, pos + 1);
          pos += 1;
        }
      } else {
        emit("Punctuation", pos, pos + 1);
        pos += 1;
      }
      continue;
    }

    // 数値ラベル `0:`。`:` は次ループで記号として読む。
    if (isDigit(ch)) {
      let end = pos;
      while (end < length && isDigit(source[end])) end += 1;
      if (source[end] === ":" && source[end + 1] !== ":") {
        emit("Label", pos, end);
        pos = end;
        continue;
      }
    }

    // 数値
    if (
      isDigit(ch) ||
      ch === "+" ||
      ch === "-" ||
      ch === "." ||
      ((ch === "f" || ch === "F") &&
        source[pos + 1] === "0" &&
        /[xX]/.test(source[pos + 2] ?? "")) ||
      ((ch === "s" || ch === "u") && source[pos + 1] === "0" && /[xX]/.test(source[pos + 2] ?? ""))
    ) {
      const end = matchNumber(pos);
      if (end !== null) {
        emit("Number", pos, end);
        pos = end;
        continue;
      }
    }

    // バーワード（キーワード/オペコード/型/定数/ラベル/未分類）
    if (BAREWORD_START.test(ch)) {
      const end = scanName(pos);
      // 直後が単独の `:` ならラベル定義名
      if (source[end] === ":" && source[end + 1] !== ":") {
        emit("Label", pos, end);
      } else {
        emit(classifyBareword(source.slice(pos, end)), pos, end);
      }
      pos = end;
      continue;
    }

    // 記号
    if (PUNCTUATORS.has(ch)) {
      emit("Punctuation", pos, pos + 1);
      pos += 1;
      continue;
    }

    // 認識不能文字（エラー回復）
    emit("Unknown", pos, pos + 1);
    pos += 1;
  }

  emit("Eof", length, length);
  return tokens;
};

/** ソース中の各行の開始オフセット一覧（`positionAt` 用）。 */
const computeLineStarts = (source: string): number[] => {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
};
