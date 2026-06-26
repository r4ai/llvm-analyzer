/**
 * hover や補完で使う LLVM IR のドキュメント辞書をまとめて再公開する。
 *
 * @remarks
 * 辞書はオペコード・属性・型の3カテゴリに分割して定義しており、
 * このモジュールは外部からの参照点を1つに保つための再公開専用バレル。
 * 共通の整形ヘルパーは {@link ./docs/doc-entry.ts} にある。
 */
export type { DocEntry } from "./docs/doc-entry.ts";
export { opcodeDocs } from "./docs/opcodes.ts";
export { attributeDocs } from "./docs/attributes.ts";
export { typeDocs } from "./docs/type-docs.ts";
