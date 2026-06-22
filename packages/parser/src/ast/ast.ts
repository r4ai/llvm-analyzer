/**
 * 再帰下降パーサが生成する AST（抽象構文木）の型定義。
 *
 * 粒度は「構造重視・命令は粗く」。トップレベル構造（型定義・グローバル・関数・属性グループ・
 * メタデータ）は型付きノードに分解するが、命令や型の内部は構造化せず、出現する識別子参照
 * （{@link IdentifierRef}）を収集するにとどめる。定義位置・参照位置が取れれば、LSP の
 * definition / references / documentSymbol / foldingRange が成立する。
 *
 * すべてのノードは lexer の {@link Range} を持ち、`source.slice(range...)` で元テキストへ戻せる。
 */
import type { Range } from "../lexer/index.ts";

/** 全 AST ノードが共有する基底。 */
export interface NodeBase {
  /** ソース上の範囲（offset/line/column はいずれも 0 始まり）。 */
  readonly range: Range;
}

/**
 * 識別子の出現（定義・参照を問わない単一の名前）。
 *
 * `kind` は接頭辞シジルに対応する。`name` は接頭辞を含む生テキストで、
 * 不変条件 `source.slice(range.start.offset, range.end.offset) === name` を満たす。
 */
export interface IdentifierRef extends NodeBase {
  readonly kind:
    | "GlobalRef" // @name / @1 / @"..."
    | "LocalRef" // %name / %1 / %"..."
    | "MetadataRef" // !name / !0
    | "AttributeGroupRef" // #0
    | "ComdatRef" // $name
    | "LabelRef"; // label %name の参照先（値位置の %name を指す）
  /** 接頭辞を含む生テキスト（例: `@main` / `%x` / `!0`）。 */
  readonly name: string;
}

/** モジュール全体。トップレベルエントリの列。 */
export interface Module extends NodeBase {
  readonly kind: "Module";
  readonly entries: readonly TopLevelEntry[];
}

/**
 * トップレベルエントリの共通フィールド。
 *
 * - `defines`: このエントリが導入する名前（documentSymbol / 定義ジャンプの対象）。無いものもある。
 * - `references`: 本体に出現する識別子参照の列（`defines` 自身は含めない）。
 */
export interface EntryBase extends NodeBase {
  readonly defines?: IdentifierRef;
  readonly references: readonly IdentifierRef[];
}

/** `source_filename = "..."`。 */
export interface SourceFilename extends EntryBase {
  readonly kind: "SourceFilename";
  /** 引用符を含むファイル名リテラル（例: `"hello.c"`）。無ければ undefined。 */
  readonly filename?: string;
}

/** `target datalayout = "..."` / `target triple = "..."`。 */
export interface TargetDefinition extends EntryBase {
  readonly kind: "TargetDefinition";
  /** `datalayout` か `triple`。未知なら undefined。 */
  readonly target?: "datalayout" | "triple";
  /** 引用符を含む値リテラル。無ければ undefined。 */
  readonly value?: string;
}

/** `%name = type ...`。`defines` は定義される名前付き型。 */
export interface TypeDefinition extends EntryBase {
  readonly kind: "TypeDefinition";
  readonly defines: IdentifierRef;
}

/** `@name = [linkage...] global|constant ...`（alias/ifunc も最小では同種別に寄せる）。 */
export interface GlobalVariable extends EntryBase {
  readonly kind: "GlobalVariable";
  readonly defines: IdentifierRef;
}

/** `declare ... @name(...)`。`defines` は宣言される関数名。 */
export interface FunctionDeclaration extends EntryBase {
  readonly kind: "FunctionDeclaration";
  readonly defines: IdentifierRef;
}

/** `define ... @name(...) { blocks }`。`defines` は定義される関数名。 */
export interface FunctionDefinition extends EntryBase {
  readonly kind: "FunctionDefinition";
  readonly defines: IdentifierRef;
  readonly blocks: readonly BasicBlock[];
}

/** `attributes #N = { ... }`。`defines` は属性グループ ID。 */
export interface AttributeGroupDefinition extends EntryBase {
  readonly kind: "AttributeGroupDefinition";
  readonly defines: IdentifierRef;
}

/** `!name = !{...}`（名前付き）と `!N = [distinct] !{...}`（番号付き）の両方。 */
export interface MetadataDefinition extends EntryBase {
  readonly kind: "MetadataDefinition";
  readonly defines: IdentifierRef;
  /** `distinct !{...}` なら true。 */
  readonly distinct: boolean;
}

/** 解釈できなかった行（エラー回復用）。診断と対で生成される。 */
export interface UnknownEntry extends EntryBase {
  readonly kind: "UnknownEntry";
}

/** トップレベルエントリの判別共用体。 */
export type TopLevelEntry =
  | SourceFilename
  | TargetDefinition
  | TypeDefinition
  | GlobalVariable
  | FunctionDeclaration
  | FunctionDefinition
  | AttributeGroupDefinition
  | MetadataDefinition
  | UnknownEntry;

/**
 * 基本ブロック。先頭のラベル定義（任意）と命令列を持つ。
 * 暗黙の最初のブロック（ラベルなし）では `label` が undefined。
 */
export interface BasicBlock extends NodeBase {
  readonly kind: "BasicBlock";
  /** ラベル定義（`name:` の `name`）。暗黙ブロックなら undefined。 */
  readonly label?: IdentifierRef;
  readonly instructions: readonly Instruction[];
}

/**
 * 命令（粗い表現）。代入先・オペコード・出現する識別子参照のみを持つ。
 * オペランドの型構造は保持しない（このフェーズ外）。
 */
export interface Instruction extends NodeBase {
  readonly kind: "Instruction";
  /** 代入先（`%x = ...` の `%x`）。終端命令など無いものは undefined。 */
  readonly result?: IdentifierRef;
  /** オペコード（`add` / `call` / `ret` …）。判別できなければ undefined。 */
  readonly opcode?: string;
  /** 命令内に出現する識別子参照（`result` は含めない）。 */
  readonly operands: readonly IdentifierRef[];
}

/** 構文診断の重大度。parser は現状 `error` のみ用いる。 */
export type DiagnosticSeverity = "error" | "warning";

/** 構文エラーの診断。analyzer の意味診断とは別物。 */
export interface ParseDiagnostic {
  readonly range: Range;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
}

/** `parseModule` の結果。AST と収集した構文診断のペア。 */
export interface ParseResult {
  readonly ast: Module;
  readonly diagnostics: readonly ParseDiagnostic[];
}
