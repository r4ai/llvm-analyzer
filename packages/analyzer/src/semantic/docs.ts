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

interface DocMarkdownOptions {
  readonly summary: string;
  readonly usage: string;
  readonly pseudo: string;
  readonly example: string;
  readonly reference: string;
}

const langRef = (anchor: string): string => `https://llvm.org/docs/LangRef.html#${anchor}`;

const docMarkdown = ({ summary, usage, pseudo, example, reference }: DocMarkdownOptions): string =>
  [
    summary,
    "",
    usage,
    "",
    "Example:",
    "```llvm",
    `; ${pseudo}`,
    example,
    "```",
    "",
    `[LLVM LangRef](${reference})`,
  ].join("\n");

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
  [
    "add",
    {
      label: "add",
      markdown: docMarkdown({
        summary: "Adds integer or integer vector values of the same type.",
        usage:
          "Use it for plain integer addition. Add `nuw` or `nsw` only when overflow is impossible under that rule.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = add i32 %lhs, %rhs",
        reference: langRef("add-instruction"),
      }),
    },
  ],
  [
    "sub",
    {
      label: "sub",
      markdown: docMarkdown({
        summary: "Subtracts integer or integer vector values of the same type.",
        usage:
          "Use it for integer difference calculations. Overflow flags have the same care requirements as `add`.",
        pseudo: "diff = lhs - rhs",
        example: "%diff = sub i32 %lhs, %rhs",
        reference: langRef("sub-instruction"),
      }),
    },
  ],
  [
    "mul",
    {
      label: "mul",
      markdown: docMarkdown({
        summary: "Multiplies integer or integer vector values of the same type.",
        usage:
          "Use it for integer products. Prefer explicit overflow flags only when the IR producer can prove them.",
        pseudo: "product = lhs * rhs",
        example: "%product = mul i32 %lhs, %rhs",
        reference: langRef("mul-instruction"),
      }),
    },
  ],
  [
    "load",
    {
      label: "load",
      markdown: docMarkdown({
        summary: "Reads a typed value from memory through a pointer.",
        usage:
          "Use it when an SSA value must be materialized from an address. The result type is written before the pointer operand.",
        pseudo: "value = *addr",
        example: "%value = load i32, ptr %addr, align 4",
        reference: langRef("load-instruction"),
      }),
    },
  ],
  [
    "store",
    {
      label: "store",
      markdown: docMarkdown({
        summary: "Writes a value to memory through a pointer.",
        usage: "Use it for side effects. It does not produce an SSA result.",
        pseudo: "*addr = value",
        example: "store i32 %value, ptr %addr, align 4",
        reference: langRef("store-instruction"),
      }),
    },
  ],
  [
    "ptrtoaddr",
    {
      label: "ptrtoaddr",
      markdown: docMarkdown({
        summary: "Converts the address bits of a pointer to an integer.",
        usage:
          "Use it when only the address component is needed. It differs from pointer provenance and non-address bits.",
        pseudo: "addr = address_bits(p)",
        example: "%addr = ptrtoaddr ptr %p to i64",
        reference: langRef("ptrtoaddr-to-instruction"),
      }),
    },
  ],
  [
    "call",
    {
      label: "call",
      markdown: docMarkdown({
        summary: "Calls a function and uses its return value when present.",
        usage:
          "Use it for direct or indirect calls. The result is omitted when the callee returns `void`.",
        pseudo: "n = strlen(s)",
        example: "%n = call i32 @strlen(ptr %s)",
        reference: langRef("call-instruction"),
      }),
    },
  ],
  [
    "ret",
    {
      label: "ret",
      markdown: docMarkdown({
        summary: "Returns control from the current function.",
        usage:
          "Use `ret void` for void functions, or return one value whose type matches the function result.",
        pseudo: "return value",
        example: "ret i32 %value",
        reference: langRef("ret-instruction"),
      }),
    },
  ],
  [
    "br",
    {
      label: "br",
      markdown: docMarkdown({
        summary: "Transfers control to another basic block.",
        usage:
          "Use the one-label form for unconditional branches, or `i1` plus two labels for conditional branches.",
        pseudo: "jump = cond ? then : else",
        example: "br i1 %cond, label %then, label %else",
        reference: langRef("br-instruction"),
      }),
    },
  ],
  [
    "phi",
    {
      label: "phi",
      markdown: docMarkdown({
        summary: "Selects an SSA value based on the predecessor block.",
        usage:
          "Use it at the start of a basic block to merge values from incoming control-flow edges.",
        pseudo: "x = then ? a : b",
        example: "%x = phi i32 [ %a, %then ], [ %b, %else ]",
        reference: langRef("phi-instruction"),
      }),
    },
  ],
  [
    "alloca",
    {
      label: "alloca",
      markdown: docMarkdown({
        summary: "Allocates stack memory in the current function frame.",
        usage:
          "Use it to create an addressable local object. The result is a pointer to the allocated storage.",
        pseudo: "slot = stack_alloc(sizeof(i32))",
        example: "%slot = alloca i32, align 4",
        reference: langRef("alloca-instruction"),
      }),
    },
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
  [
    "void",
    {
      label: "void",
      markdown: docMarkdown({
        summary: "Type with no runtime value.",
        usage:
          "Use it as a function result type when the function returns only by side effect or control flow.",
        pseudo: "sink(value) returns nothing",
        example: "define void @sink(i32 %value) { ... }",
        reference: langRef("void-type"),
      }),
    },
  ],
  [
    "ptr",
    {
      label: "ptr",
      markdown: docMarkdown({
        summary: "LLVM opaque pointer type.",
        usage: "Use it for addresses without encoding the pointee type in the pointer itself.",
        pseudo: "addr points to memory",
        example: "%value = load i32, ptr %addr",
        reference: langRef("pointer-type"),
      }),
    },
  ],
  [
    "label",
    {
      label: "label",
      markdown: docMarkdown({
        summary: "Type of a basic block label.",
        usage: "Use it in terminators and constructs that refer to basic blocks.",
        pseudo: "jump to exit",
        example: "br label %exit",
        reference: langRef("label-type"),
      }),
    },
  ],
  [
    "metadata",
    {
      label: "metadata",
      markdown: docMarkdown({
        summary: "Type for debug info and other metadata nodes.",
        usage: "Use it for compiler annotations that are not ordinary runtime values.",
        pseudo: "attach debug metadata",
        example: "!dbg !12",
        reference: langRef("metadata-type"),
      }),
    },
  ],
  [
    "i1",
    {
      label: "i1",
      markdown: docMarkdown({
        summary: "1-bit integer type, commonly used for conditions.",
        usage:
          "Use it for boolean-like SSA values such as `icmp` results and conditional branches.",
        pseudo: "cond is true or false",
        example: "br i1 %cond, label %then, label %else",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "i8",
    {
      label: "i8",
      markdown: docMarkdown({
        summary: "8-bit integer type.",
        usage: "Use it for byte-sized integer values and raw data elements.",
        pseudo: "byte = *addr",
        example: "%byte = load i8, ptr %addr",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "i32",
    {
      label: "i32",
      markdown: docMarkdown({
        summary: "32-bit integer type.",
        usage: "Use it for common scalar integer arithmetic and C-like `int` values.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = add i32 %lhs, %rhs",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "i64",
    {
      label: "i64",
      markdown: docMarkdown({
        summary: "64-bit integer type.",
        usage:
          "Use it for wide integer arithmetic, sizes, and target-sized values when appropriate.",
        pseudo: "next = index + 1",
        example: "%next = add i64 %index, 1",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "b32",
    {
      label: "b32",
      markdown: docMarkdown({
        summary: "32-bit byte type.",
        usage:
          "Use byte types where the IR needs byte-oriented values instead of ordinary integers.",
        pseudo: "x = *addr",
        example: "%x = load b32, ptr %addr",
        reference: langRef("integer-type"),
      }),
    },
  ],
  [
    "float",
    {
      label: "float",
      markdown: docMarkdown({
        summary: "32-bit floating-point type.",
        usage: "Use it for single-precision floating-point arithmetic.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = fadd float %lhs, %rhs",
        reference: langRef("floating-point-types"),
      }),
    },
  ],
  [
    "double",
    {
      label: "double",
      markdown: docMarkdown({
        summary: "64-bit floating-point type.",
        usage: "Use it for double-precision floating-point arithmetic.",
        pseudo: "sum = lhs + rhs",
        example: "%sum = fadd double %lhs, %rhs",
        reference: langRef("floating-point-types"),
      }),
    },
  ],
]);
