/**
 * Hover や補完で使う短いドキュメント項目。
 *
 * @remarks
 * `label` は補完候補や hover 見出しに出す短い名前。
 * `markdown` は LSP の MarkupContent へ渡す本文として使う。
 *
 * @public
 */
export interface DocEntry {
  /** 表示名。LLVM IR 上のキーワードやオペコードをそのまま保持する。 */
  readonly label: string;
  /** ユーザーへ表示する説明文。 */
  readonly markdown: string;
}

/**
 * よく使う LLVM IR オペコードのドキュメント辞書。
 *
 * @remarks
 * 初期実装では、hover と completion の品質に効く代表的な命令だけを持つ。
 * 完全な仕様説明ではなく、エディタ上で短時間に意味を確認するための説明に絞る。
 *
 * @example
 * const doc = opcodeDocs.get("call");
 * doc?.markdown; // 関数呼び出しの説明
 *
 * @public
 */
export const opcodeDocs = new Map<string, DocEntry>([
  ["add", { label: "add", markdown: "Adds integer or integer vector values." }],
  ["sub", { label: "sub", markdown: "Subtracts integer or integer vector values." }],
  ["mul", { label: "mul", markdown: "Multiplies integer or integer vector values." }],
  ["load", { label: "load", markdown: "Reads a value from memory through a pointer." }],
  ["store", { label: "store", markdown: "Writes a value to memory through a pointer." }],
  [
    "ptrtoaddr",
    { label: "ptrtoaddr", markdown: "Converts the address part of a pointer to an integer." },
  ],
  ["call", { label: "call", markdown: "Calls a function and uses its return value when present." }],
  ["ret", { label: "ret", markdown: "Returns from the current function." }],
  ["br", { label: "br", markdown: "Branches to basic blocks, conditionally or unconditionally." }],
  ["phi", { label: "phi", markdown: "Selects an SSA value at a control-flow merge point." }],
  [
    "alloca",
    { label: "alloca", markdown: "Allocates memory in the current function stack frame." },
  ],
]);

/**
 * よく使う LLVM IR 型のドキュメント辞書。
 *
 * @remarks
 * opaque pointer 前提の `ptr` と、整数型、浮動小数点型、特殊な IR 型を補完候補として提供する。
 *
 * @example
 * const pointerDoc = typeDocs.get("ptr");
 * pointerDoc?.label; // "ptr"
 *
 * @public
 */
export const typeDocs = new Map<string, DocEntry>([
  ["void", { label: "void", markdown: "Type with no runtime value." }],
  ["ptr", { label: "ptr", markdown: "LLVM opaque pointer type." }],
  ["label", { label: "label", markdown: "Type of a basic block label." }],
  ["metadata", { label: "metadata", markdown: "Type for debug info and other metadata." }],
  ["i1", { label: "i1", markdown: "1-bit integer type, commonly used for conditions." }],
  ["i8", { label: "i8", markdown: "8-bit integer type." }],
  ["i32", { label: "i32", markdown: "32-bit integer type." }],
  ["i64", { label: "i64", markdown: "64-bit integer type." }],
  ["b32", { label: "b32", markdown: "32-bit byte type." }],
  ["float", { label: "float", markdown: "32-bit floating-point type." }],
  ["double", { label: "double", markdown: "64-bit floating-point type." }],
]);
