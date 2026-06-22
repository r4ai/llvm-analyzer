/**
 * lexer が生成するトークンの型定義。
 *
 * 字句解析の状態遷移は「先頭文字クラス → トークン種別」で決まる:
 *
 * | 先頭文字            | 遷移先（トークン種別）                                  |
 * | ------------------ | --------------------------------------------------- |
 * | 空白 ` \t\r\n`     | スキップ（トークンを生成しない）                          |
 * | `;`                | {@link TokenKind} `Comment`（行末まで）                 |
 * | `"`                | `String`（次の `"` または EOF まで）                    |
 * | `@`                | `GlobalIdentifier`（`@name` / `@1` / `@"..."`）        |
 * | `%`                | `LocalIdentifier`（`%name` / `%1` / `%"..."`）         |
 * | `!`                | `MetadataIdentifier`（`!name` / `!0`）。それ以外は `Punctuation` |
 * | `#`                | `AttributeGroup`（`#0`）または `DebugRecord`（`#dbg_*`）。それ以外は `Punctuation` |
 * | `$`                | `ComdatIdentifier`（`$name` / `$"..."`）。それ以外は `Punctuation` |
 * | 数字 / `+-` + 数字  | `Number`（整数・浮動小数・`0x` 16進/特殊float）            |
 * | 英字 `._`          | バーワード → 後続が `:` なら `Label`、                    |
 * |                    | さもなくば `Keyword`/`Opcode`/`Type`/`Constant`/`Identifier` に分類 |
 * | `= , { } ( ) [ ] < > * :` | `Punctuation`                                |
 * | 上記以外            | `Unknown`（1文字、エラー回復用）                          |
 * | EOF                | `Eof`（ゼロ幅、末尾に1つ）                                |
 */
export type TokenKind =
  | "GlobalIdentifier"
  | "LocalIdentifier"
  | "MetadataIdentifier"
  | "AttributeGroup"
  | "DebugRecord"
  | "ComdatIdentifier"
  | "Label"
  | "Keyword"
  | "Opcode"
  | "Type"
  | "Constant"
  | "Identifier"
  | "Number"
  | "String"
  | "Comment"
  | "Punctuation"
  | "Unknown"
  | "Eof";

/**
 * ソース上の位置。すべて 0 始まり（LSP の `Position` 互換）。
 */
export interface Position {
  /** ファイル先頭からの文字オフセット（0 始まり）。 */
  readonly offset: number;
  /** 行番号（0 始まり）。 */
  readonly line: number;
  /** 行頭からの桁（0 始まり）。 */
  readonly column: number;
}

/**
 * トークンが占めるソース範囲。`end` は半開区間の終端（その位置自体は含まない）。
 */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

/**
 * 字句トークン。
 *
 * 不変条件: `source.slice(range.start.offset, range.end.offset) === value`
 * （`Eof` は `value === ""` のゼロ幅トークン）。
 */
export interface Token {
  readonly kind: TokenKind;
  /** ソース上の生テキスト（識別子の接頭辞 `@`/`%` や文字列の引用符を含む）。 */
  readonly value: string;
  readonly range: Range;
}
