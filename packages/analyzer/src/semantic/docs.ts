/** Hover や補完で使う短いドキュメント項目。 */
export interface DocEntry {
  readonly label: string;
  readonly markdown: string;
}

/** よく使う LLVM IR オペコードのドキュメント辞書。 */
export const opcodeDocs = new Map<string, DocEntry>([
  ["add", { label: "add", markdown: "整数またはベクトル整数の加算を行います。" }],
  ["sub", { label: "sub", markdown: "整数またはベクトル整数の減算を行います。" }],
  ["mul", { label: "mul", markdown: "整数またはベクトル整数の乗算を行います。" }],
  ["load", { label: "load", markdown: "ポインタが指すメモリから値を読み込みます。" }],
  ["store", { label: "store", markdown: "値をポインタが指すメモリへ書き込みます。" }],
  ["call", { label: "call", markdown: "関数を呼び出し、戻り値があれば結果として使います。" }],
  ["ret", { label: "ret", markdown: "現在の関数から戻ります。" }],
  ["br", { label: "br", markdown: "条件付きまたは無条件で基本ブロックへ分岐します。" }],
  ["phi", { label: "phi", markdown: "制御フローの合流点で SSA 値を選択します。" }],
  ["alloca", { label: "alloca", markdown: "現在の関数のスタックフレームにメモリを確保します。" }],
]);

/** よく使う LLVM IR 型のドキュメント辞書。 */
export const typeDocs = new Map<string, DocEntry>([
  ["void", { label: "void", markdown: "値を返さない型です。" }],
  ["ptr", { label: "ptr", markdown: "LLVM の opaque pointer 型です。" }],
  ["label", { label: "label", markdown: "基本ブロックを指すラベル型です。" }],
  ["metadata", { label: "metadata", markdown: "デバッグ情報などのメタデータ型です。" }],
  ["i1", { label: "i1", markdown: "1 bit の整数型です。条件値としてよく使われます。" }],
  ["i8", { label: "i8", markdown: "8 bit の整数型です。" }],
  ["i32", { label: "i32", markdown: "32 bit の整数型です。" }],
  ["i64", { label: "i64", markdown: "64 bit の整数型です。" }],
  ["float", { label: "float", markdown: "32 bit 浮動小数点型です。" }],
  ["double", { label: "double", markdown: "64 bit 浮動小数点型です。" }],
]);
