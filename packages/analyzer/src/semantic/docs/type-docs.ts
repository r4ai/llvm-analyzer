import { type DocEntry, docMarkdown, langRef } from "./doc-entry.ts";

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
        reference: langRef("byte-type"),
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
