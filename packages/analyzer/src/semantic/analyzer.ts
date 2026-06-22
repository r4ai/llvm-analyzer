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
import { formatLlvmType, parseLlvmType, tokenize } from "@llvm-analyzer/parser";
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

const CONVERSION_OPCODES = new Set([
  "trunc",
  "zext",
  "sext",
  "fptrunc",
  "fpext",
  "fptoui",
  "fptosi",
  "uitofp",
  "sitofp",
  "ptrtoint",
  "inttoptr",
  "ptrtoaddr",
  "bitcast",
  "addrspacecast",
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
  if (ref.kind === "LocalRef")
    return functionScope?.symbols.get(ref.name) ?? moduleScope.symbols.get(ref.name);
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
  const after = source.slice(ref.range.end.offset).trimStart();
  if (after.startsWith("%") || after.startsWith("@")) return true;
  if (after.startsWith("*")) {
    const afterPointer = after.slice(1).trimStart();
    if (afterPointer.startsWith("%") || afterPointer.startsWith("@")) return true;
  }
  const lineStart = source.lastIndexOf("\n", Math.max(0, ref.range.start.offset - 1)) + 1;
  const beforeTokens = tokenize(source.slice(lineStart, ref.range.start.offset)).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const previous = beforeTokens.at(-1);
  return (
    previous?.kind === "Opcode" ||
    (previous?.kind === "Keyword" && (previous.value === "to" || previous.value === "type"))
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
 * 命令結果の型を推定する。
 *
 * @param source `parseModule` に渡したものと同じ元ソース。
 * @param instruction 型を推定する命令。
 * @returns 推定できた LLVM IR 型。推定できない場合は undefined。
 *
 * @remarks
 * parser は命令内部を構造化しないため、ここでは元ソースの命令行からオペコード直後の型構文を切り出す。
 * 切り出した断片は parser の型パーサで検証し、読めた範囲だけを表示用の型として返す。
 */
const inferInstructionResultType = (
  source: string | undefined,
  instruction: Instruction,
): string | undefined => {
  if (!source || !instruction.opcode) return undefined;
  if (instruction.opcode === "alloca" || instruction.opcode === "getelementptr") return "ptr";
  if (instruction.opcode === "icmp" || instruction.opcode === "fcmp") return "i1";
  const line = source.slice(instruction.range.start.offset, instruction.range.end.offset);
  const opcodeMatch = new RegExp(`(?:^|[\\s=])${escapeRegExp(instruction.opcode)}\\b`, "u").exec(
    line,
  );
  if (!opcodeMatch) return undefined;
  const afterOpcode = line.slice(opcodeMatch.index + opcodeMatch[0].length);
  if (CONVERSION_OPCODES.has(instruction.opcode)) {
    const toIndex = indexOfWord(afterOpcode, "to");
    if (toIndex < 0) return undefined;
    return leadingTypeText(afterOpcode.slice(toIndex + "to".length));
  }
  const specificType = inferInstructionResultTypeByOpcode(instruction.opcode, afterOpcode);
  if (specificType !== undefined) return specificType;
  return leadingTypeText(afterOpcode);
};

/**
 * opcode 固有の結果型規則を適用する。
 *
 * @param opcode 命令 opcode。
 * @param afterOpcode opcode 直後から命令末尾までのソース断片。
 * @returns opcode 固有規則で分かる結果型。未対応なら undefined。
 */
const inferInstructionResultTypeByOpcode = (
  opcode: string,
  afterOpcode: string,
): string | undefined => {
  const tokens = tokenize(afterOpcode).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const segments = splitTopLevelSegments(tokens);
  switch (opcode) {
    case "select":
      return leadingTypeOf(segments[1] ?? []);
    case "extractelement":
      return elementTypeOfVector(leadingTypeOf(segments[0] ?? []));
    case "extractvalue":
      return indexedAggregateElementType(leadingTypeOf(segments[0] ?? []), segments[1] ?? []);
    case "cmpxchg": {
      const valueType = leadingTypeOf(segments[1] ?? []);
      return valueType ? `{ ${valueType}, i1 }` : undefined;
    }
    case "atomicrmw":
      return inferAtomicRmwResultType(tokens);
    default:
      return undefined;
  }
};

/** top-level の `,` でトークン列を分割する。 */
const splitTopLevelSegments = (tokens: readonly Token[]): readonly Token[][] => {
  const segments: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === "," && depth === 0) {
      segments.push(current);
      current = [];
      continue;
    }
    current.push(token);
    depth = updateTypeDepth(depth, token.value);
    if (token.value === "(") depth += 1;
    else if (token.value === ")") depth = Math.max(0, depth - 1);
  }
  segments.push(current);
  return segments;
};

/** ベクトル型の要素型を取り出す。 */
const elementTypeOfVector = (type: string | undefined): string | undefined => {
  if (!type) return undefined;
  const match = /^<\s*(?:vscale x\s*)?\d+ x (?<element>.+)>$/u.exec(type);
  return match?.groups?.element;
};

/** 単純な struct / array から extractvalue の単一 index 結果型を取り出す。 */
const indexedAggregateElementType = (
  aggregateType: string | undefined,
  indexSegment: readonly Token[],
): string | undefined => {
  if (!aggregateType) return undefined;
  const indexToken = indexSegment.find((token) => /^\d+$/u.test(token.value));
  if (!indexToken) return undefined;
  const index = Number.parseInt(indexToken.value, 10);
  if (!Number.isInteger(index) || index < 0) return undefined;
  const elements = aggregateElementTypes(aggregateType);
  return elements[index];
};

/** 表示用に整形済みの集約型文字列から top-level の要素型を分割する。 */
const aggregateElementTypes = (type: string): readonly string[] => {
  const structMatch = /^\{ (?<body>.*) \}$/u.exec(type) ?? /^<\{ (?<body>.*) \}>$/u.exec(type);
  if (structMatch?.groups?.body !== undefined)
    return splitTopLevelTypeText(structMatch.groups.body);
  const arrayMatch = /^\[(?<count>\d+) x (?<element>.+)\]$/u.exec(type);
  if (arrayMatch?.groups?.element !== undefined) return [arrayMatch.groups.element];
  return [];
};

/** top-level の `,` で型文字列を分割する。 */
const splitTopLevelTypeText = (source: string): readonly string[] => {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of source) {
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
    if (char === "{" || char === "[" || char === "<" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ">" || char === ")")
      depth = Math.max(0, depth - 1);
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
};

/** atomicrmw は演算名の後にポインタ operand と値 operand が続く。 */
const inferAtomicRmwResultType = (tokens: readonly Token[]): string | undefined => {
  const withoutOperation = tokens.slice(1);
  const segments = splitTopLevelSegments(withoutOperation);
  return leadingTypeOf(segments[1] ?? []);
};

/**
 * 識別子の直前にある型トークンを推定する。
 *
 * @param source `parseModule` に渡したものと同じ元ソース。
 * @param ref 型を推定する識別子出現。
 * @returns 識別子直前の型トークン。推定できない場合は undefined。
 *
 * @remarks
 * 主な用途は関数引数 `i32 %x` の型取得。
 * 行頭から識別子直前までだけを見るため、別行の型や複雑な属性列には踏み込まない。
 */
const inferTypeBefore = (source: string | undefined, ref: IdentifierRef): string | undefined => {
  if (!source) return undefined;
  const lineStart = source.lastIndexOf("\n", Math.max(0, ref.range.start.offset - 1)) + 1;
  const before = source.slice(lineStart, ref.range.start.offset);
  return inferLeadingParameterType(before) ?? trailingTypeText(before);
};

/**
 * 関数引数の先頭型を、現在の引数セグメントから推定する。
 *
 * @param before 行頭から識別子直前までのソース断片。
 * @returns `ptr addrspace(1)` や `%T` などの先頭型。推定できなければ undefined。
 *
 * @remarks
 * `ptr addrspace(N) %p` では識別子直前の最後のトークンが `)` になるため、単純な「直前トークン」では
 * 型を取れない。ここでは関数呼び出し/宣言の括弧深さを見て、現在の引数セグメント先頭を読む。
 */
const inferLeadingParameterType = (before: string): string | undefined => {
  const tokens = tokenize(before).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  let parenDepth = 0;
  let typeDepth = 0;
  let segmentStart = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token.value === "(" && typeDepth === 0) {
      parenDepth += 1;
      if (parenDepth === 1) segmentStart = i + 1;
      continue;
    }
    if (token.value === ")" && typeDepth === 0) {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (token.value === "," && parenDepth === 1 && typeDepth === 0) {
      segmentStart = i + 1;
      continue;
    }
    if (parenDepth >= 1) typeDepth = updateTypeDepth(typeDepth, token.value);
  }
  const segment = tokens.slice(segmentStart);
  return leadingTypeOf(segment);
};

/** 引数セグメントの先頭から、この analyzer が安全に扱える型だけを取り出す。 */
const leadingTypeOf = (tokens: readonly Token[]): string | undefined => {
  const first = tokens.findIndex((token) => token.kind !== "Comment");
  if (first < 0) return undefined;
  return leadingTypeTextFromTokens(tokens.slice(first));
};

/** 文字列断片の先頭から、型パーサが読める型だけを取り出す。 */
const leadingTypeText = (source: string): string | undefined =>
  leadingTypeTextFromTokens(
    tokenize(source).filter((token) => token.kind !== "Eof" && token.kind !== "Comment"),
  );

/** トークン列の先頭から、型パーサが読める型だけを取り出す。 */
const leadingTypeTextFromTokens = (tokens: readonly Token[]): string | undefined => {
  const candidates = candidateTypeTexts(tokens);
  for (let length = candidates.length; length > 0; length -= 1) {
    const source = candidates.slice(0, length).join(" ");
    const parsed = parseLlvmType(source);
    const formatted = formatLlvmType(parsed.type);
    if (formatted && parsed.diagnostics.length === 0) return formatted;
  }
  return undefined;
};

/** 識別子直前の文字列断片末尾から、型パーサが読める型だけを取り出す。 */
const trailingTypeText = (source: string): string | undefined => {
  const tokens = tokenize(source).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const candidates = candidateTypeTexts(tokens);
  for (let start = Math.max(0, candidates.length - 8); start < candidates.length; start += 1) {
    const parsed = parseLlvmType(candidates.slice(start).join(" "));
    const formatted = formatLlvmType(parsed.type);
    if (formatted && parsed.diagnostics.length === 0) return formatted;
  }
  return undefined;
};

/** 型候補のトークン値列。アライメントなど型でない後続属性に当たったら止める。 */
const candidateTypeTexts = (tokens: readonly Token[]): string[] => {
  const values: string[] = [];
  let square = 0;
  let paren = 0;
  let brace = 0;
  let angle = 0;
  for (const token of tokens) {
    if (token.value === "," && square === 0 && paren === 0 && brace === 0 && angle === 0) break;
    if (token.kind === "GlobalIdentifier" || token.kind === "AttributeGroup") break;
    if (
      values.length > 0 &&
      square === 0 &&
      paren === 0 &&
      brace === 0 &&
      angle === 0 &&
      token.kind === "LocalIdentifier"
    ) {
      break;
    }
    values.push(token.value);
    if (token.value === "[") square += 1;
    else if (token.value === "]") square = Math.max(0, square - 1);
    else if (token.value === "(") paren += 1;
    else if (token.value === ")") paren = Math.max(0, paren - 1);
    else if (token.value === "{") brace += 1;
    else if (token.value === "}") brace = Math.max(0, brace - 1);
    else if (token.value === "<") angle += 1;
    else if (token.value === ">") angle = Math.max(0, angle - 1);
  }
  return values;
};

/** 型構文内の区切りを値・引数の区切りと誤認しないための深さ更新。 */
const updateTypeDepth = (depth: number, value: string): number => {
  if (value === "{" || value === "[" || value === "<") return depth + 1;
  if (value === "}" || value === "]" || value === ">") return Math.max(0, depth - 1);
  return depth;
};

/** 単語境界を見てキーワードの位置を探す。 */
const indexOfWord = (source: string, word: string): number => {
  const match = new RegExp(String.raw`(?:^|\s)${escapeRegExp(word)}(?:\s|$)`, "u").exec(source);
  return match ? match.index + match[0].indexOf(word) : -1;
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

/**
 * 文字列を正規表現リテラルとして安全に埋め込むためにエスケープする。
 *
 * @param value 正規表現へ埋め込む文字列。
 * @returns 正規表現メタ文字をエスケープした文字列。
 */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
