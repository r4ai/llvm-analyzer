import { tokenize, type Token } from "../lexer/index.ts";
import type { ParseDiagnostic } from "../ast/index.ts";
import type { LlvmType, LlvmTypeParseResult } from "./types.ts";

/**
 * LLVM IR 型構文を型 AST へパースする。
 *
 * @param source 型構文だけを含むソース断片。
 * @returns パースした型 AST と診断。
 * @example
 * const result = parseLlvmType("ptr addrspace(1)");
 * result.type?.kind //=> "PointerType"
 */
export const parseLlvmType = (source: string): LlvmTypeParseResult => {
  const parser = new TypeParser(source);
  return parser.parse();
};

/**
 * 型 AST を LLVM IR 型構文の標準的な文字列表現へ戻す。
 *
 * @param type 表示する型 AST。
 * @returns LLVM IR 型構文。
 */
export const formatLlvmType = (type: LlvmType | undefined): string | undefined => {
  if (!type) return undefined;
  switch (type.kind) {
    case "VoidType":
      return "void";
    case "LabelType":
      return "label";
    case "MetadataType":
      return "metadata";
    case "TokenType":
      return "token";
    case "IntegerType":
      return `i${type.bits}`;
    case "ByteType":
      return `b${type.bits}`;
    case "FloatingPointType":
      return type.name;
    case "NamedType":
      return type.name;
    case "PointerType": {
      const prefix = type.pointee ? `${formatLlvmType(type.pointee)}` : "ptr";
      const addrspace = type.addressSpace === undefined ? "" : ` addrspace(${type.addressSpace})`;
      return type.pointee ? `${prefix}${addrspace}*` : `${prefix}${addrspace}`;
    }
    case "VectorType":
      return `<${type.scalable ? "vscale x " : ""}${type.length} x ${formatLlvmType(
        type.element,
      )}>`;
    case "ArrayType":
      return `[${type.length} x ${formatLlvmType(type.element)}]`;
    case "StructType": {
      const fields = type.fields.map((field) => formatLlvmType(field)).join(", ");
      if (fields === "") return type.packed ? "<{}>" : "{}";
      return type.packed ? `<{ ${fields} }>` : `{ ${fields} }`;
    }
    case "OpaqueStructType":
      return "opaque";
    case "FunctionType":
      return `${formatLlvmType(type.returnType)} (${[
        ...type.parameters.map((parameter) => formatLlvmType(parameter)),
        ...(type.variadic ? ["..."] : []),
      ].join(", ")})`;
  }
};

class TypeParser {
  private readonly tokens: readonly Token[];
  private readonly diagnostics: ParseDiagnostic[] = [];
  private pos = 0;

  constructor(source: string) {
    this.tokens = tokenize(source).filter((token) => token.kind !== "Comment");
  }

  parse(): LlvmTypeParseResult {
    if (this.peek().kind === "Eof") {
      this.addDiagnostic(this.peek(), "型が空です");
      return { diagnostics: this.diagnostics };
    }
    const type = this.parseType();
    if (this.peek().kind !== "Eof") {
      this.addDiagnostic(this.peek(), "型の末尾に余分なトークンがあります");
    }
    return { ...(type ? { type } : {}), diagnostics: this.diagnostics };
  }

  private parseType(): LlvmType | undefined {
    const base = this.parsePrimaryType();
    if (!base) return undefined;
    return this.parsePostfixType(base);
  }

  private parsePrimaryType(): LlvmType | undefined {
    const token = this.peek();
    if (token.kind === "Type") return this.parseTypeToken();
    if (token.kind === "LocalIdentifier") {
      this.advance();
      return { kind: "NamedType", name: token.value };
    }
    if (token.value === "[") return this.parseArrayType();
    if (token.value === "{") return this.parseStructType(false);
    if (token.value === "<") return this.parseAngleType();
    this.addDiagnostic(token, "要素型が必要です");
    return undefined;
  }

  private parseTypeToken(): LlvmType | undefined {
    const token = this.advance();
    if (/^i\d+$/u.test(token.value)) {
      return { kind: "IntegerType", bits: Number(token.value.slice(1)) };
    }
    if (/^b\d+$/u.test(token.value)) {
      return { kind: "ByteType", bits: Number(token.value.slice(1)) };
    }
    if (token.value === "ptr") return this.parseOpaquePointerType();
    if (token.value === "void") return { kind: "VoidType" };
    if (token.value === "label") return { kind: "LabelType" };
    if (token.value === "metadata") return { kind: "MetadataType" };
    if (token.value === "token") return { kind: "TokenType" };
    if (token.value === "opaque") return { kind: "OpaqueStructType" };
    return { kind: "FloatingPointType", name: token.value };
  }

  private parseOpaquePointerType(): LlvmType {
    return {
      kind: "PointerType",
      ...this.parseOptionalAddressSpace(),
    };
  }

  private parsePostfixType(base: LlvmType): LlvmType {
    let current = base;
    while (true) {
      if (this.peek().value === "(") {
        current = this.parseFunctionType(current);
        continue;
      }
      if (this.peek().value === "*") {
        this.advance();
        current = {
          kind: "PointerType",
          pointee: current,
          ...this.parseOptionalAddressSpace(),
        };
        continue;
      }
      if (this.peek().value === "addrspace" && this.tokens[this.pos + 4]?.value === "*") {
        const addressSpace = this.parseOptionalAddressSpace();
        this.advance();
        current = {
          kind: "PointerType",
          pointee: current,
          ...addressSpace,
        };
        continue;
      }
      return current;
    }
  }

  private parseFunctionType(returnType: LlvmType): LlvmType {
    this.expectValue("(", "`)` が必要です");
    const parameters: LlvmType[] = [];
    let variadic = false;
    if (this.peek().value === ")") {
      this.advance();
      return { kind: "FunctionType", returnType, parameters, variadic };
    }
    while (this.peek().kind !== "Eof") {
      if (this.peek().value === "...") {
        variadic = true;
        this.advance();
      } else {
        const parameter = this.parseType();
        if (parameter) parameters.push(parameter);
      }
      if (this.peek().value === ",") {
        this.advance();
        continue;
      }
      break;
    }
    this.expectValue(")", "`)` が必要です");
    return { kind: "FunctionType", returnType, parameters, variadic };
  }

  private parseArrayType(): LlvmType | undefined {
    this.advance();
    const length = this.expectNumber("配列要素数が必要です");
    this.expectValue("x", "`x` が必要です");
    const element = this.parseType();
    this.expectValue("]", "`]` が必要です");
    return element && length !== undefined ? { kind: "ArrayType", length, element } : undefined;
  }

  private parseStructType(packed: boolean): LlvmType | undefined {
    this.expectValue("{", "`{` が必要です");
    const fields: LlvmType[] = [];
    if (this.peek().value === "}") {
      this.advance();
      return { kind: "StructType", packed, fields };
    }
    while (this.peek().kind !== "Eof") {
      const field = this.parseType();
      if (field) fields.push(field);
      if (this.peek().value === ",") {
        this.advance();
        if (this.peek().value === "}") this.addDiagnostic(this.peek(), "要素型が必要です");
        continue;
      }
      break;
    }
    this.expectValue("}", "`}` が必要です");
    return { kind: "StructType", packed, fields };
  }

  private parseAngleType(): LlvmType | undefined {
    this.advance();
    if (this.peek().value === "{") {
      const struct = this.parseStructType(true);
      this.expectValue(">", "`>` が必要です");
      return struct;
    }
    const scalable = this.peek().value === "vscale";
    if (scalable) {
      this.advance();
      this.expectValue("x", "`x` が必要です");
    }
    const length = this.expectNumber("ベクトル要素数が必要です");
    this.expectValue("x", "`x` が必要です");
    const element = this.parseType();
    this.expectValue(">", "`>` が必要です");
    return element && length !== undefined
      ? { kind: "VectorType", scalable, length, element }
      : undefined;
  }

  private parseOptionalAddressSpace(): { readonly addressSpace?: number } {
    if (this.peek().value !== "addrspace") return {};
    this.advance();
    this.expectValue("(", "`(` が必要です");
    const addressSpace = this.expectNumber("addrspace の番号が必要です");
    this.expectValue(")", "`)` が必要です");
    return addressSpace === undefined ? {} : { addressSpace };
  }

  private expectNumber(message: string): number | undefined {
    const token = this.peek();
    if (token.kind === "Number" && /^\d+$/u.test(token.value)) {
      this.advance();
      return Number(token.value);
    }
    this.addDiagnostic(token, message);
    return undefined;
  }

  private expectValue(value: string, message: string): boolean {
    if (this.peek().value === value) {
      this.advance();
      return true;
    }
    this.addDiagnostic(this.peek(), message);
    return false;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private advance(): Token {
    const token = this.peek();
    this.pos += 1;
    return token;
  }

  private addDiagnostic(token: Token, message: string): void {
    this.diagnostics.push({ range: token.range, message, severity: "error" });
  }
}
