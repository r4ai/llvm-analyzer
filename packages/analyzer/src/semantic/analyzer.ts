/**
 * LLVM IR AST から意味モデルを構築する純粋な analyzer。
 *
 * @remarks
 * parser は構文を止めずに拾うことを優先し、識別子出現を {@link IdentifierRef} として残す。
 * analyzer はその出現列をスコープ規則に従って結び、定義参照インデックスと意味診断を作る。
 *
 * 依存方向を保つため、このファイルは VSCode API や LSP 型へ依存しない。
 * LSP 固有の型変換は language-server パッケージで行う。
 */
import { tokenize } from "@llvm-analyzer/parser";
import type {
  BasicBlock,
  FunctionDefinition,
  IdentifierRef,
  Instruction,
  Module,
  Position,
  Range,
  Token,
  TopLevelEntry,
} from "@llvm-analyzer/parser";
import type {
  AnalyzeOptions,
  AnalyzerDiagnostic,
  DirectCall,
  ControlFlowGraph,
  ControlFlowEdge,
  DocumentSymbol,
  SemanticModel,
  SemanticSymbol,
  SymbolId,
  SymbolKind,
} from "./types.ts";
import { inferInstructionResultType, inferTypeBefore } from "./type-inference.ts";

const MODULE_SCOPE_ID = "module";
const MODULE_SCOPE_NAME = "module";

interface MutableSymbol {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly scopeId: string;
  readonly scopeName: string;
  readonly definition: IdentifierRef;
  readonly references: IdentifierRef[];
  readonly type?: string;
}

interface Scope {
  readonly id: string;
  readonly name: string;
  readonly symbols: Map<string, MutableSymbol>;
}

interface Occurrence {
  readonly ref: IdentifierRef;
  readonly symbol: MutableSymbol;
}

const MODULE_REF_KINDS = new Set<IdentifierRef["kind"]>([
  "GlobalRef",
  "MetadataRef",
  "AttributeGroupRef",
  "ComdatRef",
]);

const TERMINATOR_OPCODES = new Set([
  "ret",
  "br",
  "switch",
  "indirectbr",
  "invoke",
  "callbr",
  "resume",
  "catchswitch",
  "catchret",
  "cleanupret",
  "unreachable",
]);

/**
 * AST から意味モデルを構築する純粋関数。
 *
 * @remarks
 * 処理は三段階に分ける。
 * まずトップレベル定義をモジュールスコープへ登録する。
 * 次に関数ごとに引数、ラベル、命令結果を関数スコープへ登録する。
 * 最後に各参照を該当スコープのシンボルへ解決し、未解決なら診断を積む。
 *
 * @param ast parser が返した LLVM IR モジュール AST
 * @param options 型推定と診断出力を調整するオプション
 * @returns LSP アダプタから問い合わせるための意味モデル
 * @example
 * const source = "define i32 @main(i32 %x) {\n  ret i32 %x\n}";
 * const { ast } = parseModule(source);
 * const model = analyze(ast, { source });
 * model.definitionAt({ offset: 39, line: 1, column: 10 });
 */
export const analyze = (ast: Module, options: AnalyzeOptions = {}): SemanticModel => {
  const moduleScope: Scope = { id: MODULE_SCOPE_ID, name: MODULE_SCOPE_NAME, symbols: new Map() };
  const functionScopes = new Map<string, Scope>();
  const symbols: MutableSymbol[] = [];
  const occurrences: Occurrence[] = [];
  const diagnostics: AnalyzerDiagnostic[] = [];
  const directCalls: DirectCall[] = [];
  const controlFlowGraphs: ControlFlowGraph[] = [];
  const reportUndefinedReferences = options.reportUndefinedReferences ?? true;

  /**
   * スコープへ定義を登録する。
   *
   * @remarks
   * 重複定義でも後続の参照解決を続けるため、診断を積んだうえで新しい定義を登録する。
   * これにより、不正な入力でも後続行の解析結果をできるだけ返せる。
   *
   * @param scope 定義を登録するスコープ。
   * @param ref 定義名を表す識別子出現。
   * @param kind 登録する意味シンボルの種別。
   * @param type 推定済みの LLVM IR 型。未推定なら省略する。
   * @returns 登録した内部シンボル。
   */
  const addSymbol = (
    scope: Scope,
    ref: IdentifierRef,
    kind: SymbolKind,
    type?: string,
  ): MutableSymbol => {
    const existing = scope.symbols.get(ref.name);
    const symbol: MutableSymbol = {
      id: `${scope.id}:${ref.name}:${symbols.length}`,
      name: ref.name,
      kind,
      scopeId: scope.id,
      scopeName: scope.name,
      definition: ref,
      references: [ref],
      ...(type ? { type } : {}),
    };
    if (existing) {
      diagnostics.push({
        code: "duplicate-definition",
        range: ref.range,
        message: `\`${ref.name}\` は既に定義されています`,
        severity: "error",
      });
    }
    scope.symbols.set(ref.name, symbol);
    symbols.push(symbol);
    occurrences.push({ ref, symbol });
    return symbol;
  };

  /**
   * 解決済み参照をシンボルの参照列と位置インデックスへ追加する。
   *
   * @param symbol 参照先として解決されたシンボル。
   * @param ref 参照側の識別子出現。
   *
   * @remarks
   * 関数引数はシグネチャ上の出現を定義として登録したあと、同じシグネチャ参照列の解決対象にもなる。
   * 同一範囲は同じ出現なので、referencesOf と位置インデックスへ二重登録しない。
   */
  const addReference = (symbol: MutableSymbol, ref: IdentifierRef): void => {
    if (symbol.references.some((existing) => sameRange(existing.range, ref.range))) return;
    symbol.references.push(ref);
    occurrences.push({ ref, symbol });
  };

  /**
   * 未定義参照の診断を追加する。
   *
   * @param ref 未定義だった識別子出現。
   *
   * @remarks
   * `reportUndefinedReferences` が false なら何もしない。
   */
  const addUndefined = (ref: IdentifierRef): void => {
    if (!reportUndefinedReferences) return;
    diagnostics.push({
      code: "undefined-reference",
      range: ref.range,
      message: `\`${ref.name}\` が定義されていません`,
      severity: "error",
    });
  };

  for (const entry of ast.entries) {
    if (!entry.defines || entry.defines.name === "") continue;
    addSymbol(moduleScope, entry.defines, symbolKindOfEntry(entry));
  }

  for (const entry of ast.entries) {
    if (entry.kind !== "FunctionDefinition") continue;
    const functionScope = makeFunctionScope(entry);
    functionScopes.set(entry.defines.name, functionScope);
    for (const ref of entry.references.filter((r) => isFunctionParameterRef(options.source, r))) {
      addSymbol(functionScope, ref, "parameter", inferTypeBefore(options.source, ref));
    }
    for (const block of entry.blocks) {
      if (block.label) addSymbol(functionScope, block.label, "label", "label");
      for (const instruction of block.instructions) {
        if (instruction.result) {
          addSymbol(
            functionScope,
            instruction.result,
            "local",
            inferInstructionResultType(options.source, instruction),
          );
        }
      }
    }
    directCalls.push(...extractDirectCalls(entry, options.source));
    controlFlowGraphs.push(extractControlFlowGraph(entry, options.source));
    validateFunctionBody(entry, diagnostics);
  }

  const resolveContextual = (ref: IdentifierRef): MutableSymbol | undefined =>
    resolveContextualRef(options.source, ref, moduleScope, functionScopes);

  for (const entry of ast.entries) {
    if (entry.kind !== "FunctionDefinition") {
      resolveRefs(
        resolvableTopLevelRefs(entry, moduleScope, options.source),
        moduleScope,
        undefined,
        addReference,
        addUndefined,
        resolveContextual,
      );
      continue;
    }
    const functionScope = functionScopes.get(entry.defines.name);
    resolveRefs(
      entry.references,
      moduleScope,
      functionScope,
      addReference,
      addUndefined,
      resolveContextual,
    );
    for (const block of entry.blocks) {
      for (const instruction of block.instructions) {
        resolveRefs(
          instruction.operands,
          moduleScope,
          functionScope,
          addReference,
          addUndefined,
          resolveContextual,
        );
      }
      for (const debugRecord of block.debugRecords ?? []) {
        resolveRefs(
          debugRecord.operands,
          moduleScope,
          functionScope,
          addReference,
          addUndefined,
          resolveContextual,
        );
      }
      for (const directive of block.directives ?? []) {
        resolveRefs(
          directive.references,
          moduleScope,
          functionScope,
          addReference,
          addUndefined,
          resolveContextual,
        );
      }
    }
  }

  return makeModel(
    symbols,
    occurrences,
    diagnostics,
    ast.entries,
    functionScopes,
    directCalls,
    controlFlowGraphs,
  );
};

/**
 * 関数定義に対応する空の関数スコープを作る。
 *
 * @param entry スコープを作る関数定義。
 * @returns 関数名を表示名に持つ空スコープ。
 *
 * @remarks
 * `id` はモジュールスコープと衝突しないように `function:` 接頭辞を付ける。
 */
const makeFunctionScope = (entry: FunctionDefinition): Scope => ({
  id: `function:${entry.defines.name}`,
  name: entry.defines.name,
  symbols: new Map(),
});

/**
 * 関数シグネチャ上の `%` 参照が実引数名かを判定する。
 *
 * @param source 元ソース。無ければ従来どおり `LocalRef` を引数候補にする。
 * @param ref 判定対象の参照。
 * @returns 関数スコープへ parameter として登録すべきなら true。
 *
 * @remarks
 * `define void @f(%T %x)` では `%T` が名前付き型、`%x` が値名である。
 * parser は型構文を構造化しないため、直後の非空白文字と直前の型トークンから保守的に判定する。
 */
const isFunctionParameterRef = (source: string | undefined, ref: IdentifierRef): boolean => {
  if (ref.kind !== "LocalRef") return false;
  if (!source) return true;
  const after = source.slice(ref.range.end.offset).trimStart();
  if (after.startsWith("%") || after.startsWith("@")) return false;
  if (after.startsWith("*")) {
    const afterPointer = after.slice(1).trimStart();
    if (afterPointer.startsWith("%") || afterPointer.startsWith("@")) return false;
  }
  return inferTypeBefore(source, ref) !== undefined;
};

/**
 * トップレベルエントリで診断対象にする参照を絞る。
 *
 * @param entry parser が返したトップレベルエントリ。
 * @param moduleScope モジュールスコープ。
 * @returns 未定義診断の対象にする参照列。
 *
 * @remarks
 * `uselistorder` は関数ローカル値やラベルをトップレベルで参照できる。
 * 現在の analyzer は指令から関数スコープを復元しないため、モジュールスコープで解けない `%` 参照だけ診断対象から外す。
 */
const resolvableTopLevelRefs = (
  entry: TopLevelEntry,
  moduleScope: Scope,
  source: string | undefined,
): readonly IdentifierRef[] => {
  if (entry.kind === "FunctionDeclaration") {
    return entry.references.filter((ref) => {
      if (ref.kind !== "LocalRef") return true;
      if (moduleScope.symbols.has(ref.name)) return true;
      return !isFunctionParameterRef(source, ref);
    });
  }
  if (entry.kind !== "UseListOrderDirective") return entry.references;
  return entry.references.filter((ref) => {
    if (ref.kind !== "LocalRef" && ref.kind !== "LabelRef") return true;
    return moduleScope.symbols.has(ref.name);
  });
};

/**
 * トップレベルエントリ種別を analyzer のシンボル種別へ写像する。
 *
 * @param entry parser が返したトップレベルエントリ。
 * @returns analyzer が扱うシンボル種別。
 */
const symbolKindOfEntry = (entry: TopLevelEntry): SymbolKind => {
  switch (entry.kind) {
    case "GlobalVariable":
      return "global";
    case "ComdatDefinition":
      return "comdat";
    case "FunctionDeclaration":
    case "FunctionDefinition":
      return "function";
    case "TypeDefinition":
      return "type";
    case "MetadataDefinition":
      return "metadata";
    case "AttributeGroupDefinition":
      return "attributeGroup";
    default:
      return "global";
  }
};

/**
 * 粗い命令 AST だけで確実に分かる well-formedness を診断する。
 *
 * @param entry 検証対象の関数定義。
 * @param diagnostics 診断の追加先。
 *
 * @remarks
 * dominance や型整合性の完全検証は LLVM verifier の責務であり、この analyzer では扱わない。
 * ここでは同一命令内の自己参照と、終端命令後の通常命令だけを検出する。
 */
const validateFunctionBody = (
  entry: FunctionDefinition,
  diagnostics: AnalyzerDiagnostic[],
): void => {
  for (const block of entry.blocks) {
    let terminator: Instruction | undefined;
    for (const instruction of block.instructions) {
      if (terminator) {
        diagnostics.push({
          code: "instruction-after-terminator",
          range: instruction.range,
          message: `終端命令 \`${terminator.opcode ?? ""}\` の後に命令があります`,
          severity: "error",
        });
      }
      if (instruction.result) {
        for (const operand of instruction.operands) {
          if (operand.kind === "LocalRef" && operand.name === instruction.result.name) {
            diagnostics.push({
              code: "self-reference-before-definition",
              range: operand.range,
              message: `\`${operand.name}\` は同じ命令内で定義前に参照されています`,
              severity: "error",
            });
          }
        }
      }
      if (!terminator && instruction.opcode && TERMINATOR_OPCODES.has(instruction.opcode)) {
        terminator = instruction;
      }
    }
  }
};

const CALL_OPCODES = new Set(["call", "invoke", "callbr"]);

/** 関数本体から直接呼び出し先 `@callee` を抽出する。 */
const extractDirectCalls = (
  entry: FunctionDefinition,
  source: string | undefined,
): DirectCall[] => {
  const calls: DirectCall[] = [];
  for (const block of entry.blocks) {
    for (const instruction of block.instructions) {
      if (!instruction.opcode || !CALL_OPCODES.has(instruction.opcode)) continue;
      const callee = directCalleeRef(source, instruction);
      if (!callee) continue;
      calls.push({ caller: entry.defines, callee, range: instruction.range });
    }
  }
  return calls;
};

const directCalleeRef = (
  source: string | undefined,
  instruction: Instruction,
): IdentifierRef | undefined => {
  if (!source) return undefined;
  const line = source.slice(instruction.range.start.offset, instruction.range.end.offset);
  const tokens = tokenize(line).filter((token) => token.kind !== "Eof" && token.kind !== "Comment");
  const directGlobal = tokens.find(
    (token, index) => token.kind === "GlobalIdentifier" && tokens[index + 1]?.value === "(",
  );
  if (!directGlobal) return undefined;
  const absoluteStart = instruction.range.start.offset + directGlobal.range.start.offset;
  return instruction.operands.find(
    (operand) => operand.kind === "GlobalRef" && operand.range.start.offset === absoluteStart,
  );
};

const CFG_TERMINATOR_OPCODES = new Set(["br", "switch", "indirectbr", "invoke", "callbr"]);

/** 関数定義から静的に分かる CFG を抽出する。 */
const extractControlFlowGraph = (
  entry: FunctionDefinition,
  source: string | undefined,
): ControlFlowGraph => {
  const blocks = entry.blocks.map((block, index) => ({
    name: block.label?.name ?? (index === 0 ? "entry" : `block${index}`),
    range: block.range,
  }));
  const knownLabels = new Set(blocks.map((block) => block.name));
  const edges: ControlFlowEdge[] = [];

  for (let index = 0; index < entry.blocks.length; index += 1) {
    const block = entry.blocks[index];
    if (!block) continue;
    const sourceName = blocks[index]?.name ?? `block${index}`;
    const terminator = block.instructions.find(
      (instruction) => instruction.opcode && CFG_TERMINATOR_OPCODES.has(instruction.opcode),
    );
    if (!terminator) continue;
    for (const targetName of successorLabels(terminator, knownLabels, source)) {
      edges.push({ from: sourceName, to: targetName, range: terminator.range });
    }
  }

  return { functionName: entry.defines.name, range: entry.range, blocks, edges };
};

const successorLabels = (
  instruction: Instruction,
  knownLabels: ReadonlySet<string>,
  source: string | undefined,
): readonly string[] => {
  const line = source?.slice(instruction.range.start.offset, instruction.range.end.offset);
  const labels = successorLabelNamesByOpcode(instruction.opcode, line);
  return labels.filter((name) => knownLabels.has(name));
};

const successorLabelNamesByOpcode = (
  opcode: string | undefined,
  instructionText: string | undefined,
): readonly string[] => {
  if (!opcode || !instructionText) return [];
  const tokens = tokenize(instructionText).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const labels = tokens
    .filter((token, index) => token.kind === "LocalIdentifier" && isSuccessorLabel(tokens, index))
    .map((token) => labelNameOf({ kind: "LabelRef", name: token.value, range: token.range }))
    .filter((_name, index, all) => all.indexOf(_name) === index);
  return labels;
};

const isSuccessorLabel = (tokens: readonly Token[], index: number): boolean => {
  return tokens[index - 1]?.value === "label";
};

/**
 * 識別子参照列を現在のスコープで解決する。
 *
 * @param refs 解決対象の識別子参照列。
 * @param moduleScope モジュール全体で共有するスコープ。
 * @param functionScope 関数内を解析している場合の関数スコープ。
 * @param addReference 解決済み参照を記録するコールバック。
 * @param addUndefined 未解決参照を診断へ変換するコールバック。
 *
 * @remarks
 * トップレベルエントリでは `functionScope` を渡さず、モジュールスコープだけを探索する。
 * 関数本体では関数スコープを優先し、名前付き型のような `%` 付きトップレベル名だけモジュールスコープへフォールバックする。
 */
const resolveRefs = (
  refs: readonly IdentifierRef[],
  moduleScope: Scope,
  functionScope: Scope | undefined,
  addReference: (symbol: MutableSymbol, ref: IdentifierRef) => void,
  addUndefined: (ref: IdentifierRef) => void,
  resolveSpecial?: (ref: IdentifierRef) => MutableSymbol | undefined,
): void => {
  for (const ref of refs) {
    const symbol = resolveSpecial?.(ref) ?? resolveRef(ref, moduleScope, functionScope);
    if (symbol) addReference(symbol, ref);
    else addUndefined(ref);
  }
};

/**
 * 単一の参照をシンボルへ解決する。
 *
 * @param ref 解決対象の識別子参照。
 * @param moduleScope モジュールスコープ。
 * @param functionScope 関数内にいる場合の関数スコープ。
 * @returns 解決できた内部シンボル。未解決なら undefined。
 *
 * @remarks
 * `LabelRef` は `br label %exit` のような参照を表すが、ラベル定義は parser で `exit` として保持される。
 * そのためラベル参照だけは `%` を外して関数スコープを引く。
 */
const resolveRef = (
  ref: IdentifierRef,
  moduleScope: Scope,
  functionScope: Scope | undefined,
): MutableSymbol | undefined => {
  if (ref.kind === "LabelRef") return functionScope?.symbols.get(labelNameOf(ref));
  if (ref.kind === "LocalRef") return functionScope?.symbols.get(ref.name);
  if (MODULE_REF_KINDS.has(ref.kind)) return moduleScope.symbols.get(ref.name);
  return undefined;
};

/**
 * ラベル参照名をラベル定義名へ正規化する。
 *
 * @param ref `LabelRef` として収集された識別子出現。
 * @returns 先頭の `%` を取り除いたラベル名。
 */
const labelNameOf = (ref: IdentifierRef): string =>
  ref.name.startsWith("%") ? ref.name.slice(1) : ref.name;

/**
 * 通常のスコープ探索より優先すべき構文位置依存の参照を解決する。
 */
const resolveContextualRef = (
  source: string | undefined,
  ref: IdentifierRef,
  moduleScope: Scope,
  functionScopes: ReadonlyMap<string, Scope>,
): MutableSymbol | undefined =>
  resolveTypePositionRef(source, ref, moduleScope) ??
  resolveBlockAddressRef(source, ref, functionScopes);

/** 型位置の `%T` は、同名のローカル値よりモジュールスコープの名前付き型を優先する。 */
const resolveTypePositionRef = (
  source: string | undefined,
  ref: IdentifierRef,
  moduleScope: Scope,
): MutableSymbol | undefined => {
  if (!isTypePositionRef(source, ref)) return undefined;
  const symbol = moduleScope.symbols.get(ref.name);
  return symbol?.kind === "type" ? symbol : undefined;
};

/** 粗いトークン文脈から、ローカル識別子が型名として現れているかを判定する。 */
const isTypePositionRef = (source: string | undefined, ref: IdentifierRef): boolean => {
  if (!source || ref.kind !== "LocalRef") return false;
  const lineStart = source.lastIndexOf("\n", Math.max(0, ref.range.start.offset - 1)) + 1;
  const lineEndIndex = source.indexOf("\n", ref.range.end.offset);
  const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex;
  const beforeTokens = tokenize(source.slice(lineStart, ref.range.start.offset)).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const afterTokens = tokenize(source.slice(ref.range.end.offset, lineEnd)).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const previous = beforeTokens.at(-1);
  const next = afterTokens[0];
  if (next && isValueTokenAfterType(next)) return true;
  if (next?.value === "*" && afterTokens[1] && isValueTokenAfterType(afterTokens[1])) return true;
  return (
    previous?.kind === "Opcode" ||
    (previous?.kind === "Keyword" && TYPE_PRECEDING_KEYWORDS.has(previous.value)) ||
    beforeTokens.some((token) => token.kind === "Keyword" && token.value === "type") ||
    isWithinTopLevelTypeDefinition(source, ref)
  );
};

const TYPE_PRECEDING_KEYWORDS = new Set(["constant", "global", "to", "type"]);

const VALUE_TOKEN_AFTER_TYPE_KINDS = new Set<Token["kind"]>([
  "LocalIdentifier",
  "GlobalIdentifier",
  "Number",
  "String",
  "Constant",
]);

/** 型名の直後に値が続く構文かを判定する。 */
const isValueTokenAfterType = (token: Token): boolean =>
  VALUE_TOKEN_AFTER_TYPE_KINDS.has(token.kind);

/** 複数行の `%T = type { ... }` 内にある型参照かを保守的に判定する。 */
const isWithinTopLevelTypeDefinition = (source: string, ref: IdentifierRef): boolean => {
  const prefix = source.slice(0, ref.range.start.offset);
  const previousTopLevelLocal = prefix.lastIndexOf("\n%");
  const start =
    previousTopLevelLocal < 0 ? (source.startsWith("%") ? 0 : -1) : previousTopLevelLocal + 1;
  if (start < 0) return false;
  const statementPrefix = source.slice(start, ref.range.start.offset);
  if (!startsWithTypeDefinition(statementPrefix)) return false;
  return !/\ndefine\b/u.test(statementPrefix);
};

/** `%T = type` の導入部を token ベースで判定する。quoted 名や空白入り名も lexer に委ねる。 */
const startsWithTypeDefinition = (source: string): boolean => {
  const tokens = tokenize(source).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  return (
    tokens[0]?.kind === "LocalIdentifier" &&
    tokens[1]?.value === "=" &&
    tokens[2]?.kind === "Keyword" &&
    tokens[2].value === "type"
  );
};

/**
 * `blockaddress(@f, %bb)` の `%bb` を、明示された関数のラベルスコープで解決する。
 */
const resolveBlockAddressRef = (
  source: string | undefined,
  ref: IdentifierRef,
  functionScopes: ReadonlyMap<string, Scope>,
): MutableSymbol | undefined => {
  if (!source || ref.kind !== "LabelRef") return undefined;
  const blockAddressStart = source.lastIndexOf("blockaddress", ref.range.start.offset);
  if (blockAddressStart < 0) return undefined;
  const tokens = tokenize(source.slice(blockAddressStart, ref.range.start.offset)).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  if (tokens[0]?.value !== "blockaddress") return undefined;
  const functionName = tokens.findLast((token) => token.kind === "GlobalIdentifier")?.value;
  if (!functionName) return undefined;
  return functionScopes.get(functionName)?.symbols.get(labelNameOf(ref));
};

/**
 * 収集済みの可変データから問い合わせ用の {@link SemanticModel} を作る。
 *
 * @param mutableSymbols 解析中に登録した可変シンボル列。
 * @param occurrences 位置問い合わせに使う識別子出現列。
 * @param diagnostics 解析中に収集した意味診断。
 * @param entries documentSymbol 構築に使うトップレベルエントリ列。
 * @param functionScopes 関数名から関数スコープへの対応。
 * @param directCalls 関数本体から抽出した直接呼び出し。
 * @param controlFlowGraphs 関数本体から抽出した CFG。
 * @returns 公開用の意味モデル。
 *
 * @remarks
 * 構築中は参照列へ追記するため可変配列を使う。
 * 公開時にはソース順に並べた読み取り専用の値へ写し、呼び出し側が内部状態を変更できないようにする。
 */
const makeModel = (
  mutableSymbols: readonly MutableSymbol[],
  occurrences: readonly Occurrence[],
  diagnostics: readonly AnalyzerDiagnostic[],
  entries: readonly TopLevelEntry[],
  functionScopes: ReadonlyMap<string, Scope>,
  directCalls: readonly DirectCall[],
  controlFlowGraphs: readonly ControlFlowGraph[],
): SemanticModel => {
  const symbols = mutableSymbols.map((symbol) => freezeSymbol(symbol));
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const mutableById = new Map(mutableSymbols.map((symbol) => [symbol.id, symbol]));

  const symbolAt = (position: Position): SemanticSymbol | undefined =>
    occurrences.find((occurrence) => contains(occurrence.ref.range, position))?.symbol;

  return {
    symbols,
    symbolAt: (position) => {
      const symbol = symbolAt(position);
      return symbol ? byId.get(symbol.id) : undefined;
    },
    definitionAt: (position) => {
      const symbol = symbolAt(position);
      return symbol ? byId.get(symbol.id) : undefined;
    },
    referencesOf: (symbolId) => mutableById.get(symbolId)?.references.toSorted(compareRefs) ?? [],
    documentSymbols: () => makeDocumentSymbols(entries, functionScopes),
    directCalls: () => directCalls,
    controlFlowGraphs: () => controlFlowGraphs,
    controlFlowGraphAt: (position) =>
      controlFlowGraphs.find((graph) => contains(graph.range, position)),
    diagnostics: () => diagnostics,
  };
};

/**
 * 内部の可変シンボルを公開用の読み取り専用シンボルへ写す。
 *
 * @param symbol 解析中に使っていた可変シンボル。
 * @returns 参照列をソース順へ並べた公開シンボル。
 */
const freezeSymbol = (symbol: MutableSymbol): SemanticSymbol => ({
  id: symbol.id,
  name: symbol.name,
  kind: symbol.kind,
  scopeId: symbol.scopeId,
  scopeName: symbol.scopeName,
  definition: symbol.definition,
  references: symbol.references.toSorted(compareRefs),
  ...(symbol.type ? { type: symbol.type } : {}),
});

/**
 * AST のトップレベル定義から documentSymbol 用の階層を作る。
 *
 * @param entries parser が返したトップレベルエントリ列。
 * @param functionScopes 関数名から関数スコープへの対応。
 * @returns documentSymbol へ変換しやすい階層シンボル列。
 *
 * @remarks
 * 関数定義だけは、関数スコープに登録された引数、ラベル、SSA ローカル値を子要素として持つ。
 */
const makeDocumentSymbols = (
  entries: readonly TopLevelEntry[],
  functionScopes: ReadonlyMap<string, Scope>,
): DocumentSymbol[] => {
  const docs: DocumentSymbol[] = [];
  for (const entry of entries) {
    if (!entry.defines || entry.defines.name === "") continue;
    const doc: DocumentSymbol = {
      name: entry.defines.name,
      kind: symbolKindOfEntry(entry),
      range: entry.range,
      selectionRange: entry.defines.range,
      ...(entry.kind === "FunctionDefinition"
        ? { children: functionChildren(entry, functionScopes.get(entry.defines.name)) }
        : {}),
    };
    docs.push(doc);
  }
  return docs;
};

/**
 * 関数スコープのシンボルを、ソースに現れた順で documentSymbol の子要素へ変換する。
 *
 * @param entry 子要素を作る関数定義。
 * @param scope 関数定義に対応するスコープ。
 * @returns 関数の子として表示する documentSymbol 列。
 */
const functionChildren = (
  entry: FunctionDefinition,
  scope: Scope | undefined,
): readonly DocumentSymbol[] => {
  if (!scope) return [];
  const seen = new Set<SymbolId>();
  const refs = [
    ...entry.references.filter((r) => r.kind === "LocalRef"),
    ...entry.blocks.flatMap((block) => refsInBlock(block)),
  ];
  return refs
    .map((ref) => scope.symbols.get(ref.kind === "LabelRef" ? labelNameOf(ref) : ref.name))
    .filter((symbol): symbol is MutableSymbol => symbol !== undefined)
    .filter((symbol) => uniqueSymbol(symbol, seen))
    .map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      range: symbol.definition.range,
      selectionRange: symbol.definition.range,
    }));
};

/**
 * 基本ブロック内で定義を導入する参照だけを取り出す。
 *
 * @param block 対象の基本ブロック。
 * @returns ラベル定義と命令結果の出現列。
 */
const refsInBlock = (block: BasicBlock): IdentifierRef[] => [
  ...(block.label ? [block.label] : []),
  ...block.instructions.flatMap((instruction) => (instruction.result ? [instruction.result] : [])),
];

/**
 * 同じシンボルを documentSymbol の子に複数回出さないための述語。
 *
 * @param symbol 重複判定するシンボル。
 * @param seen すでに採用したシンボル ID の集合。
 * @returns 初出なら true、既出なら false。
 */
const uniqueSymbol = (symbol: MutableSymbol, seen: Set<SymbolId>): boolean => {
  if (seen.has(symbol.id)) return false;
  seen.add(symbol.id);
  return true;
};

/**
 * 位置が半開区間の範囲内にあるかを判定する。
 *
 * @param range 判定対象の半開区間。
 * @param position 照会する位置。
 * @returns `position` が `range` 内なら true。
 */
const contains = (range: Range, position: Position): boolean =>
  (position.offset > range.start.offset ||
    (position.offset === range.start.offset && position.line >= range.start.line)) &&
  position.offset < range.end.offset;

/**
 * 識別子参照をソース位置で比較する。
 *
 * @param a 比較する参照。
 * @param b 比較する参照。
 * @returns `a` が前なら負数、同じなら 0、後なら正数。
 */
const compareRefs = (a: IdentifierRef, b: IdentifierRef): number =>
  a.range.start.offset - b.range.start.offset;

/**
 * 2つの範囲が同じ出現を指すかを判定する。
 *
 * @param a 比較する範囲。
 * @param b 比較する範囲。
 * @returns 開始・終了 offset が同じなら true。
 */
const sameRange = (a: Range, b: Range): boolean =>
  a.start.offset === b.start.offset && a.end.offset === b.end.offset;
