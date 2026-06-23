import { describe, expect, it } from "vitest";
import { tokenize } from "./lexer.ts";
import type { TokenKind } from "./token.ts";

/** トークン列を `[kind, value]` の配列へ変換する（末尾の `Eof` は除く）。 */
const kinds = (source: string): Array<[TokenKind, string]> =>
  tokenize(source)
    .filter((t) => t.kind !== "Eof")
    .map((t) => [t.kind, t.value]);

/** 先頭トークンの種別を返す（`Eof` 以外）。 */
const firstKind = (source: string): TokenKind => kinds(source)[0]?.[0] ?? "Eof";

describe("tokenize: 終端と空白", () => {
  it("空入力は Eof のみ", () => {
    const tokens = tokenize("");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("Eof");
    expect(tokens[0]?.value).toBe("");
  });

  it("空白のみはスキップされ Eof のみ", () => {
    expect(kinds("  \t\n\r\n  ")).toEqual([]);
  });

  it("Eof はゼロ幅で末尾オフセットを指す", () => {
    const tokens = tokenize("ret");
    const eof = tokens.at(-1);
    expect(eof?.kind).toBe("Eof");
    expect(eof?.range.start.offset).toBe(3);
    expect(eof?.range.end.offset).toBe(3);
  });
});

describe("tokenize: コメント", () => {
  it("`;` から行末までを Comment とする", () => {
    expect(kinds("; hello world")).toEqual([["Comment", "; hello world"]]);
  });

  it("/* ... */ を Comment とする", () => {
    expect(kinds("/* hello\nworld */ ret")).toEqual([
      ["Comment", "/* hello\nworld */"],
      ["Opcode", "ret"],
    ]);
  });

  it("未終端 block comment は末尾まで Comment とする", () => {
    expect(kinds("/* hello\nworld")).toEqual([["Comment", "/* hello\nworld"]]);
  });

  it("コメントは改行を含まない", () => {
    expect(kinds("; a\nret")).toEqual([
      ["Comment", "; a"],
      ["Opcode", "ret"],
    ]);
  });
});

describe("tokenize: 識別子（接頭辞付き）", () => {
  it('グローバル識別子 @name / @1 / @"..."', () => {
    expect(kinds("@main @.str @1")).toEqual([
      ["GlobalIdentifier", "@main"],
      ["GlobalIdentifier", "@.str"],
      ["GlobalIdentifier", "@1"],
    ]);
    expect(kinds('@"foo bar"')).toEqual([["GlobalIdentifier", '@"foo bar"']]);
  });

  it('ローカル識別子 %name / %1 / %"..."', () => {
    expect(kinds("%x %1")).toEqual([
      ["LocalIdentifier", "%x"],
      ["LocalIdentifier", "%1"],
    ]);
    expect(kinds('%"a b"')).toEqual([["LocalIdentifier", '%"a b"']]);
  });

  it("メタデータ識別子 !name / !0", () => {
    expect(kinds("!0 !foo !llvm.module.flags")).toEqual([
      ["MetadataIdentifier", "!0"],
      ["MetadataIdentifier", "!foo"],
      ["MetadataIdentifier", "!llvm.module.flags"],
    ]);
  });

  it('名前を伴わない ! は Punctuation（!{ や !"..." の先頭）', () => {
    expect(kinds("!{")).toEqual([
      ["Punctuation", "!"],
      ["Punctuation", "{"],
    ]);
    expect(kinds('!"x"')).toEqual([
      ["Punctuation", "!"],
      ["String", '"x"'],
    ]);
  });

  it("属性グループ #0", () => {
    expect(kinds("#0 #12")).toEqual([
      ["AttributeGroup", "#0"],
      ["AttributeGroup", "#12"],
    ]);
  });

  it("debug record #dbg_*", () => {
    expect(kinds("#dbg_value")).toEqual([["DebugRecord", "#dbg_value"]]);
  });

  it("数字や dbg_ を伴わない # は Punctuation", () => {
    expect(kinds("# x")).toEqual([
      ["Punctuation", "#"],
      ["Identifier", "x"],
    ]);
    expect(kinds("#custom")).toEqual([
      ["Punctuation", "#"],
      ["Identifier", "custom"],
    ]);
  });

  it('comdat 識別子 $name / $"..."', () => {
    expect(kinds('$foo $"a b"')).toEqual([
      ["ComdatIdentifier", "$foo"],
      ["ComdatIdentifier", '$"a b"'],
    ]);
  });

  it("接頭辞だけで名前が続かない場合は Unknown", () => {
    expect(firstKind("@ ")).toBe("Unknown");
    expect(firstKind("% ")).toBe("Unknown");
  });
});

describe("tokenize: ラベル", () => {
  it("name: をラベル定義名として Label にする（: は別トークン）", () => {
    expect(kinds("entry:")).toEqual([
      ["Label", "entry"],
      ["Punctuation", ":"],
    ]);
  });

  it("0: のような数値ラベルを Label にする", () => {
    expect(kinds("0:")).toEqual([
      ["Label", "0"],
      ["Punctuation", ":"],
    ]);
  });

  it("キーワードと同名でもラベルとして扱う", () => {
    expect(kinds("add:")).toEqual([
      ["Label", "add"],
      ["Punctuation", ":"],
    ]);
  });

  it(":: が続く場合はラベルにしない", () => {
    expect(firstKind("foo::")).not.toBe("Label");
  });
});

describe("tokenize: バーワードの分類", () => {
  it("構造キーワード・修飾子・呼出規約・フラグ・比較述語は Keyword", () => {
    for (const w of [
      "define",
      "declare",
      "target",
      "private",
      "nounwind",
      "fastcc",
      "nsw",
      "sgt",
    ]) {
      expect(firstKind(w)).toBe("Keyword");
    }
  });

  it("最新属性語と denormal FP 環境の構成語は Keyword", () => {
    for (const w of [
      "captures",
      "address",
      "address_is_null",
      "provenance",
      "read_provenance",
      "writable",
      "initializes",
      "dead_on_unwind",
      "dead_on_return",
      "range",
      "nofpclass",
      "argmem",
      "inaccessiblemem",
      "errnomem",
      "target_mem0",
      "target_mem1",
      "read",
      "write",
      "readwrite",
      "denormal_fpenv",
      "ieee",
      "preservesign",
      "positivezero",
      "dynamic",
      "sanitize_memtag",
      "sanitize_realtime",
      "vscale_range",
      "nooutline",
      "nocreateundeforpoison",
      "nocf_check",
    ]) {
      expect(firstKind(w)).toBe("Keyword");
    }
  });

  it("quoted string 属性だけで使う名前は bareword Keyword にしない", () => {
    expect(firstKind("frame_pointer")).toBe("Identifier");
  });

  it("命令オペコードは Opcode", () => {
    for (const w of ["add", "ret", "getelementptr", "icmp", "call", "ptrtoaddr"]) {
      expect(firstKind(w)).toBe("Opcode");
    }
  });

  it("型キーワードと i<N> は Type", () => {
    for (const w of ["void", "ptr", "float", "double", "i1", "i32", "i128", "b1", "b32"]) {
      expect(firstKind(w)).toBe("Type");
    }
  });

  it("リテラル定数は Constant", () => {
    for (const w of ["true", "false", "null", "undef", "poison", "zeroinitializer"]) {
      expect(firstKind(w)).toBe("Constant");
    }
  });

  it("未知のバーワードは Identifier（i で始まるが整数型でない語を含む）", () => {
    for (const w of ["x", "unknownword", "inbounds_like_but_not", "i32x"]) {
      expect(firstKind(w)).toBe("Identifier");
    }
  });
});

describe("tokenize: 数値", () => {
  it("整数（符号付きを含む）", () => {
    expect(kinds("0 42 -1 +3")).toEqual([
      ["Number", "0"],
      ["Number", "42"],
      ["Number", "-1"],
      ["Number", "+3"],
    ]);
  });

  it("浮動小数（指数・先頭ドットを含む）", () => {
    expect(kinds("3.14 -0.5 1.0e10 .5")).toEqual([
      ["Number", "3.14"],
      ["Number", "-0.5"],
      ["Number", "1.0e10"],
      ["Number", ".5"],
    ]);
  });

  it("16進・特殊float 0x...", () => {
    expect(kinds("0x7f 0xK4000 s0x8000 u0x8000 0x1.8p+1")).toEqual([
      ["Number", "0x7f"],
      ["Number", "0xK4000"],
      ["Number", "s0x8000"],
      ["Number", "u0x8000"],
      ["Number", "0x1.8p+1"],
    ]);
  });

  it("特殊浮動小数リテラル", () => {
    expect(kinds("+inf -qnan")).toEqual([
      ["Number", "+inf"],
      ["Number", "-qnan"],
    ]);
  });

  it("NaN payload と f0x 形式の浮動小数リテラル", () => {
    expect(kinds("+nan(0x1) -snan(0x2) f0x3c00")).toEqual([
      ["Number", "+nan(0x1)"],
      ["Number", "-snan(0x2)"],
      ["Number", "f0x3c00"],
    ]);
  });

  it("数字を伴わない符号は Unknown", () => {
    expect(firstKind("-")).toBe("Unknown");
  });
});

describe("tokenize: 文字列", () => {
  it("二重引用符で囲まれた文字列", () => {
    expect(kinds('"hello"')).toEqual([["String", '"hello"']]);
  });

  it("エスケープ \\HH を含む文字列", () => {
    expect(kinds('"a\\0A\\00b"')).toEqual([["String", '"a\\0A\\00b"']]);
  });

  it("未終端の文字列は EOF まで String とする", () => {
    expect(kinds('"abc')).toEqual([["String", '"abc']]);
  });
});

describe("tokenize: 記号と未知文字", () => {
  it("各記号は Punctuation", () => {
    expect(kinds("= , { } ( ) [ ] < > * : |")).toEqual([
      ["Punctuation", "="],
      ["Punctuation", ","],
      ["Punctuation", "{"],
      ["Punctuation", "}"],
      ["Punctuation", "("],
      ["Punctuation", ")"],
      ["Punctuation", "["],
      ["Punctuation", "]"],
      ["Punctuation", "<"],
      ["Punctuation", ">"],
      ["Punctuation", "*"],
      ["Punctuation", ":"],
      ["Punctuation", "|"],
    ]);
  });

  it("認識できない文字は1文字ずつ Unknown", () => {
    expect(kinds("^`")).toEqual([
      ["Unknown", "^"],
      ["Unknown", "`"],
    ]);
  });
});

describe("tokenize: range", () => {
  it("単一行のオフセット/行/桁を持つ", () => {
    const [local, eq] = tokenize("%x = add i32 1, 2");
    expect(local?.range).toEqual({
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 2, line: 0, column: 2 },
    });
    expect(eq?.range.start).toEqual({ offset: 3, line: 0, column: 3 });
  });

  it("複数行で行/桁が更新される", () => {
    const tokens = tokenize("a:\n  ret");
    const ret = tokens.find((t) => t.kind === "Opcode");
    expect(ret?.value).toBe("ret");
    expect(ret?.range.start).toEqual({ offset: 5, line: 1, column: 2 });
  });

  it("不変条件: source.slice(start, end) === value（Eof を除く）", () => {
    const source = [
      "; comment",
      'source_filename = "hello.c"',
      '@.str = private constant [13 x i8] c"hi\\00"',
      "%struct.Point = type { i32, i32 }",
      "define dso_local i32 @main() #0 {",
      "entry:",
      "  %retval = alloca i32, align 4",
      "  %cmp = icmp sgt i32 %retval, 0",
      "  br i1 %cmp, label %then, label %exit",
      "}",
      '!0 = !{i32 1, !"wchar_size", i32 4}',
    ].join("\n");
    for (const token of tokenize(source)) {
      if (token.kind === "Eof") continue;
      expect(source.slice(token.range.start.offset, token.range.end.offset)).toBe(token.value);
    }
  });
});
