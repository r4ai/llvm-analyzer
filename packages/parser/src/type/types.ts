import type { ParseDiagnostic } from "../ast/index.ts";

/** LLVM IR 型構文を構造化した AST。 */
export type LlvmType =
  | VoidType
  | LabelType
  | MetadataType
  | TokenType
  | IntegerType
  | ByteType
  | FloatingPointType
  | NamedType
  | PointerType
  | VectorType
  | ArrayType
  | StructType
  | OpaqueStructType
  | FunctionType;

/** `void`。 */
export interface VoidType {
  readonly kind: "VoidType";
}

/** `label`。 */
export interface LabelType {
  readonly kind: "LabelType";
}

/** `metadata`。 */
export interface MetadataType {
  readonly kind: "MetadataType";
}

/** `token`。 */
export interface TokenType {
  readonly kind: "TokenType";
}

/** `i32` などの整数型。 */
export interface IntegerType {
  readonly kind: "IntegerType";
  readonly bits: number;
}

/** `b128` などの byte type。 */
export interface ByteType {
  readonly kind: "ByteType";
  readonly bits: number;
}

/** `double` などの浮動小数点型。 */
export interface FloatingPointType {
  readonly kind: "FloatingPointType";
  readonly name: string;
}

/** `%T` / `%"quoted"` などの名前付き型。 */
export interface NamedType {
  readonly kind: "NamedType";
  readonly name: string;
}

/** `ptr` または typed pointer。 */
export interface PointerType {
  readonly kind: "PointerType";
  readonly pointee?: LlvmType;
  readonly addressSpace?: number;
}

/** `<4 x i32>` / `<vscale x 4 x i32>`。 */
export interface VectorType {
  readonly kind: "VectorType";
  readonly scalable: boolean;
  readonly length: number;
  readonly element: LlvmType;
}

/** `[4 x i32]`。 */
export interface ArrayType {
  readonly kind: "ArrayType";
  readonly length: number;
  readonly element: LlvmType;
}

/** `{ i32, ptr }` または `<{ i8, ptr }>`。 */
export interface StructType {
  readonly kind: "StructType";
  readonly packed: boolean;
  readonly fields: readonly LlvmType[];
}

/** opaque 構造体の本体。 */
export interface OpaqueStructType {
  readonly kind: "OpaqueStructType";
}

/** `i32 (ptr, ...)`。 */
export interface FunctionType {
  readonly kind: "FunctionType";
  readonly returnType: LlvmType;
  readonly parameters: readonly LlvmType[];
  readonly variadic: boolean;
}

/** 型構文パースの結果。 */
export interface LlvmTypeParseResult {
  readonly type?: LlvmType;
  readonly diagnostics: readonly ParseDiagnostic[];
}
