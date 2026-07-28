import { classifyBareword } from "./keywords.ts";
import type { Token, TokenKind } from "./token.ts";

/**
 * parserがAST構築中だけ保持する軽量トークン。
 *
 * @remarks
 * 公開{@link Token}の入れ子になった位置オブジェクトを全字句へ割り当てず、
 * ASTへ保存するrangeだけをparser側で具体化する。
 */
export interface ParserToken {
  readonly kind: TokenKind;
  readonly value: string;
  readonly startOffset: number;
  readonly startLine: number;
  readonly startColumn: number;
  /** 複数行トークンだけが持つ終了行。単一行なら開始行と値の長さから導出する。 */
  readonly endLine?: number;
  /** 複数行トークンだけが持つ終了桁。 */
  readonly endColumn?: number;
}

type TokenFactory<T> = (
  kind: TokenKind,
  value: string,
  startOffset: number,
  startLine: number,
  startColumn: number,
  endOffset: number,
  endLine: number,
  endColumn: number,
) => T | undefined;

/** 単一文字の記号トークン。 */
const PUNCTUATORS = new Set("=,{}()[]<>*:|");

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
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";
const isAsciiLetter = (ch: string | undefined): boolean =>
  ch !== undefined && ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z"));
/** 名前の先頭になれる文字（数字を除く）。 */
const isNameStart = (ch: string | undefined): boolean =>
  isAsciiLetter(ch) || ch === "-" || ch === "$" || ch === "." || ch === "_";
/** 接頭辞付き識別子の名前に使える文字（`@name` の `name` 部分）。 */
const isNameChar = (ch: string | undefined): boolean => isNameStart(ch) || isDigit(ch);
/** バーワード（記号なしの語）の先頭になれる文字。 */
const isBarewordStart = (ch: string | undefined): boolean =>
  isAsciiLetter(ch) || ch === "." || ch === "_";
const isHexMarker = (ch: string | undefined): boolean => ch === "x" || ch === "X";

/** 共通の字句状態遷移から、呼び出し側が必要なトークン表現を生成する。 */
const scanTokens = <T>(source: string, makeToken: TokenFactory<T>): T[] => {
  const length = source.length;
  let positionOffset = 0;
  let positionLine = 0;
  let positionLineStart = 0;
  const advancePosition = (offset: number): void => {
    for (; positionOffset < offset; positionOffset += 1) {
      if (source.charCodeAt(positionOffset) !== 10) continue;
      positionLine += 1;
      positionLineStart = positionOffset + 1;
    }
  };

  const tokens: T[] = [];
  const emit = (kind: TokenKind, start: number, end: number): void => {
    advancePosition(start);
    const startLine = positionLine;
    const startColumn = start - positionLineStart;
    advancePosition(end);
    const token = makeToken(
      kind,
      source.slice(start, end),
      start,
      startLine,
      startColumn,
      end,
      positionLine,
      end - positionLineStart,
    );
    if (token !== undefined) tokens.push(token);
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
    while (end < length && isNameChar(source[end])) end += 1;
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
    if (isNameStart(next) || isDigit(next)) {
      const end = scanName(pos + 1);
      emit(kind, pos, end);
      return end;
    }
    emit("Unknown", pos, pos + 1);
    return pos + 1;
  };

  /** sticky正規表現が`pos`から一致した場合だけ終端を返す。 */
  const matchPattern = (pattern: RegExp, pos: number): number | null => {
    pattern.lastIndex = pos;
    const matched = pattern.exec(source);
    return matched?.index === pos && matched[0].length > 0 ? pos + matched[0].length : null;
  };

  /** LLVM IRで頻出する10進整数・浮動小数を正規表現なしで走査する。 */
  const scanDecimalNumber = (pos: number): number | null => {
    let end = pos;
    if (source[end] === "+" || source[end] === "-") end += 1;

    const integerStart = end;
    while (end < length && isDigit(source[end])) end += 1;
    let hasDigits = end > integerStart;

    if (source[end] === ".") {
      end += 1;
      const fractionStart = end;
      while (end < length && isDigit(source[end])) end += 1;
      hasDigits ||= end > fractionStart;
    }
    if (!hasDigits) return null;

    if (source[end] !== "e" && source[end] !== "E") return end;
    let exponentEnd = end + 1;
    if (source[exponentEnd] === "+" || source[exponentEnd] === "-") exponentEnd += 1;
    const exponentStart = exponentEnd;
    while (exponentEnd < length && isDigit(source[exponentEnd])) exponentEnd += 1;
    return exponentEnd > exponentStart ? exponentEnd : end;
  };

  /**
   * `pos`から数値リテラルにマッチすれば終端を返す。
   *
   * @remarks
   * 数値の大半を占める10進表現は一回の前方向走査で処理する。
   * 16進floatやNaN payloadなどの低頻度構文だけを接頭辞で分岐して正規表現へ渡す。
   */
  const matchNumber = (pos: number): number | null => {
    const ch = source[pos];
    if ((ch === "f" || ch === "F") && source[pos + 1] === "0" && isHexMarker(source[pos + 2])) {
      return matchPattern(PRECISE_FLOAT_BITS, pos);
    }
    if ((ch === "s" || ch === "u") && source[pos + 1] === "0" && isHexMarker(source[pos + 2])) {
      return matchPattern(SIGNED_HEX_INTEGER, pos);
    }

    const unsignedStart = ch === "+" || ch === "-" ? pos + 1 : pos;
    if (source[unsignedStart] === "0" && isHexMarker(source[unsignedStart + 1])) {
      const hexFloatEnd = matchPattern(C_HEX_FLOAT, pos);
      if (hexFloatEnd !== null) return hexFloatEnd;
      if (unsignedStart === pos) {
        const hexEnd = matchPattern(HEX_NUMBER, pos);
        if (hexEnd !== null) return hexEnd;
      }
    }

    if (ch === "+" || ch === "-") {
      const nanEnd = matchPattern(NAN_WITH_PAYLOAD, pos);
      if (nanEnd !== null) return nanEnd;
      const specialEnd = matchPattern(SPECIAL_FLOAT, pos);
      if (specialEnd !== null) return specialEnd;
    }
    return scanDecimalNumber(pos);
  };

  let pos = 0;
  while (pos < length) {
    const ch = source.charAt(pos);

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
      if (isNameStart(next) || isDigit(next)) {
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
      } else if (isNameStart(next)) {
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
      ((ch === "f" || ch === "F") && source[pos + 1] === "0" && isHexMarker(source[pos + 2])) ||
      ((ch === "s" || ch === "u") && source[pos + 1] === "0" && isHexMarker(source[pos + 2]))
    ) {
      const end = matchNumber(pos);
      if (end !== null) {
        emit("Number", pos, end);
        pos = end;
        continue;
      }
    }

    // バーワード（キーワード/オペコード/型/定数/ラベル/未分類）
    if (isBarewordStart(ch)) {
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
export const tokenize = (source: string): Token[] =>
  scanTokens(
    source,
    (kind, value, startOffset, startLine, startColumn, endOffset, endLine, endColumn) => ({
      kind,
      value,
      range: {
        start: { offset: startOffset, line: startLine, column: startColumn },
        end: { offset: endOffset, line: endLine, column: endColumn },
      },
    }),
  );

/**
 * parser専用の軽量トークン列を返す。
 *
 * @remarks
 * コメントはparserがASTへ保持しないため、生成時に除外して中間配列を作らない。
 */
export const tokenizeForParser = (source: string): ParserToken[] =>
  scanTokens(
    source,
    (kind, value, startOffset, startLine, startColumn, _endOffset, endLine, endColumn) => {
      if (kind === "Comment") return undefined;
      const token: ParserToken = { kind, value, startOffset, startLine, startColumn };
      return endLine === startLine ? token : { ...token, endLine, endColumn };
    },
  );
