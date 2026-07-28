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
import { lazyValue } from "./lazy-value.ts";
import { inferInstructionResultType, inferTypeBefore } from "./type-inference.ts";

const MODULE_SCOPE_ID = "module";
const MODULE_SCOPE_NAME = "module";

type SymbolTypeSource = IdentifierRef | Instruction | "label";

/**
 * 解析中の追記と、解析後の読み取り専用公開を一つの表現で扱う意味シンボル。
 *
 * @remarks
 * 未参照シンボルへ一要素配列と型推論クロージャを割り当てない。
 * Definitionの位置問い合わせでは参照列も型も不要なため、必要になったプロパティだけを構築する。
 */
class MutableSymbol implements SemanticSymbol {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly scopeId: string;
  readonly scopeName: string;
  readonly definition: IdentifierRef;
  private additionalReferences: IdentifierRef[] | undefined;
  private publicReferences: readonly IdentifierRef[] | undefined;
  private didInferType = false;
  private inferredType: string | undefined;
  private readonly source: string | undefined;
  private readonly typeSource: SymbolTypeSource | undefined;

  constructor(
    id: SymbolId,
    name: string,
    kind: SymbolKind,
    scopeId: string,
    scopeName: string,
    definition: IdentifierRef,
    source: string | undefined,
    typeSource: SymbolTypeSource | undefined,
  ) {
    this.id = id;
    this.name = name;
    this.kind = kind;
    this.scopeId = scopeId;
    this.scopeName = scopeName;
    this.definition = definition;
    this.source = source;
    this.typeSource = typeSource;
  }

  get references(): readonly IdentifierRef[] {
    this.publicReferences ??= this.makeReferences();
    return this.publicReferences;
  }

  get type(): string | undefined {
    if (this.typeSource === undefined) return undefined;
    if (!this.didInferType) {
      this.inferredType = inferSymbolType(this.source, this.typeSource);
      this.didInferType = true;
    }
    return this.inferredType;
  }

  /** 解決済み参照を解析中の列へ追加する。 */
  addReference(ref: IdentifierRef): void {
    this.additionalReferences ??= [];
    this.additionalReferences.push(ref);
  }

  private makeReferences(): readonly IdentifierRef[] {
    if (!this.additionalReferences) return [this.definition];
    const references = [this.definition, ...this.additionalReferences];
    return isSourceOrdered(references) ? references : references.toSorted(compareRefs);
  }
}

/** シンボル種別に応じた表示用型を要求時に一度だけ推定する。 */
const inferSymbolType = (
  source: string | undefined,
  typeSource: SymbolTypeSource,
): string | undefined => {
  if (typeSource === "label") return "label";
  return typeSource.kind === "Instruction"
    ? inferInstructionResultType(source, typeSource)
    : inferTypeBefore(source, typeSource);
};

interface Scope {
  readonly id: string;
  readonly name: string;
  readonly symbols: Map<string, MutableSymbol>;
}

interface Occurrence {
  readonly ref: IdentifierRef;
  readonly symbol: MutableSymbol;
}

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

const ENTRY_SYMBOL_KINDS: Readonly<Partial<Record<TopLevelEntry["kind"], SymbolKind>>> = {
  AttributeGroupDefinition: "attributeGroup",
  ComdatDefinition: "comdat",
  FunctionDeclaration: "function",
  FunctionDefinition: "function",
  GlobalVariable: "global",
  MetadataDefinition: "metadata",
  TypeDefinition: "type",
};

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
  const reportUndefinedReferences = options.reportUndefinedReferences ?? true;
  const typeDefinitionRanges = ast.entries
    .filter((entry) => entry.kind === "TypeDefinition")
    .map((entry) => entry.range);

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
   * @param type 最初の参照時に LLVM IR 型を推定する関数。型を持たない定義では省略する。
   * @returns 登録した内部シンボル。
   */
  const addSymbol = (
    scope: Scope,
    ref: IdentifierRef,
    kind: SymbolKind,
    typeSource?: SymbolTypeSource,
  ): MutableSymbol => {
    const existing = scope.symbols.get(ref.name);
    const symbol = new MutableSymbol(
      symbols.length.toString(36),
      ref.name,
      kind,
      scope.id,
      scope.name,
      ref,
      options.source,
      typeSource,
    );
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
   * ASTの各参照は一度だけ解決するため、重複し得るのは定義として先に登録した同じ出現だけである。
   * 定義と同一範囲の参照は、referencesOf と位置インデックスへ二重登録しない。
   */
  const addReference = (symbol: MutableSymbol, ref: IdentifierRef): void => {
    if (sameRange(symbol.definition.range, ref.range)) return;
    symbol.addReference(ref);
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
      addSymbol(functionScope, ref, "parameter", ref);
    }
    for (const block of entry.blocks) {
      if (block.label) addSymbol(functionScope, block.label, "label", "label");
      for (const instruction of block.instructions) {
        if (instruction.result) {
          addSymbol(functionScope, instruction.result, "local", instruction);
        }
      }
    }
    validateFunctionBody(entry, diagnostics);
  }

  const resolveContextual = (ref: IdentifierRef): MutableSymbol | undefined =>
    resolveContextualRef(options.source, ref, moduleScope, functionScopes, typeDefinitionRanges);

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

  occurrences.sort(compareOccurrences);
  return makeModel(symbols, occurrences, diagnostics, ast.entries, functionScopes, options.source);
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
  if (isAttributeTypeArgumentRef(source, ref)) return false;
  const next = nextNonWhitespaceOffset(source, ref.range.end.offset);
  if (isValueIdentifierStart(source[next])) return false;
  if (source[next] === "*") {
    const afterPointer = nextNonWhitespaceOffset(source, next + 1);
    if (isValueIdentifierStart(source[afterPointer])) return false;
  }
  return inferTypeBefore(source, ref) !== undefined;
};

/** 指定位置以降にある最初の非空白文字のoffsetを返す。 */
const nextNonWhitespaceOffset = (source: string, start: number): number => {
  let offset = start;
  while (offset < source.length && /\s/u.test(source.charAt(offset))) offset += 1;
  return offset;
};

/** 関数引数名になり得るローカルまたはグローバル識別子の開始文字かを判定する。 */
const isValueIdentifierStart = (character: string | undefined): boolean =>
  character === "%" || character === "@";

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
  return ENTRY_SYMBOL_KINDS[entry.kind]!;
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
          message: `終端命令 \`${terminator.opcode!}\` の後に命令があります`,
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
  const blocks = entry.blocks.map((block) => ({
    name: block.label?.name ?? "entry",
    range: block.range,
  }));
  const knownLabels = new Set(blocks.map((block) => block.name));
  const edges: ControlFlowEdge[] = [];

  entry.blocks.forEach((block, index) => {
    const sourceName = blocks[index]!.name;
    const terminator = block.instructions.find(
      (instruction) => instruction.opcode && CFG_TERMINATOR_OPCODES.has(instruction.opcode),
    );
    if (terminator) {
      for (const targetName of successorLabels(terminator, knownLabels, source)) {
        edges.push({ from: sourceName, to: targetName, range: terminator.range });
      }
    }
  });

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
  switch (ref.kind) {
    case "LabelRef":
      return functionScope?.symbols.get(labelNameOf(ref));
    case "LocalRef":
      return functionScope?.symbols.get(ref.name);
    case "GlobalRef":
    case "MetadataRef":
    case "AttributeGroupRef":
    case "ComdatRef":
      return moduleScope.symbols.get(ref.name);
  }
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
  typeDefinitionRanges: readonly Range[],
): MutableSymbol | undefined =>
  resolveTypePositionRef(source, ref, moduleScope, typeDefinitionRanges) ??
  resolveBlockAddressRef(source, ref, functionScopes);

/** 型位置の `%T` は、同名のローカル値よりモジュールスコープの名前付き型を優先する。 */
const resolveTypePositionRef = (
  source: string | undefined,
  ref: IdentifierRef,
  moduleScope: Scope,
  typeDefinitionRanges: readonly Range[],
): MutableSymbol | undefined => {
  if (!isTypePositionRef(source, ref, typeDefinitionRanges)) return undefined;
  const symbol = moduleScope.symbols.get(ref.name);
  return symbol?.kind === "type" ? symbol : undefined;
};

/** 粗いトークン文脈から、ローカル識別子が型名として現れているかを判定する。 */
const isTypePositionRef = (
  source: string | undefined,
  ref: IdentifierRef,
  typeDefinitionRanges: readonly Range[],
): boolean => {
  if (!source || ref.kind !== "LocalRef") return false;
  if (isAttributeTypeArgumentRef(source, ref)) return true;
  if (isGetElementPtrTypeOperandRef(source, ref)) return true;
  const lineStart = source.lastIndexOf("\n", Math.max(0, ref.range.start.offset - 1)) + 1;
  const lineEndIndex = source.indexOf("\n", ref.range.end.offset);
  const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex;
  const beforeTokens = tokenize(source.slice(lineStart, ref.range.start.offset)).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const next = tokenize(source.slice(ref.range.end.offset, lineEnd)).find(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const previous = beforeTokens.at(-1);
  if (next && isValueTokenAfterType(next)) return true;
  if (next?.value === "*") return true;
  return (
    previous?.kind === "Opcode" ||
    (previous?.kind === "Keyword" && TYPE_PRECEDING_KEYWORDS.has(previous.value)) ||
    beforeTokens.some((token) => token.kind === "Keyword" && token.value === "type") ||
    isWithinTopLevelTypeDefinition(typeDefinitionRanges, ref)
  );
};

const TYPE_PRECEDING_KEYWORDS = new Set(["constant", "global", "to", "type"]);

const ATTRIBUTE_TYPE_ARGUMENT_KEYWORDS = new Set([
  "byval",
  "sret",
  "preallocated",
  "inalloca",
  "elementtype",
]);

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

/** `byval(%T)` のような属性引数内にある型参照かを判定する。 */
const isAttributeTypeArgumentRef = (source: string, ref: IdentifierRef): boolean => {
  const { tokens, index } = tokenContextOnLine(source, ref);
  let parenDepth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const token = tokens[i]!;
    if (token.value === ")") {
      parenDepth += 1;
      continue;
    }
    if (token.value !== "(") continue;
    if (parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    return ATTRIBUTE_TYPE_ARGUMENT_KEYWORDS.has(tokens[i - 1]?.value ?? "");
  }
  return false;
};

/** `getelementptr ... %T, ptr ...` の先頭型オペランドかを判定する。 */
const isGetElementPtrTypeOperandRef = (source: string, ref: IdentifierRef): boolean => {
  const { tokens, index } = tokenContextOnLine(source, ref);
  const opcodeIndex = tokens.findIndex(
    (token, candidateIndex) =>
      candidateIndex < index && token.kind === "Opcode" && token.value === "getelementptr",
  );
  if (opcodeIndex < 0) return false;
  return !tokens.slice(opcodeIndex + 1, index).some((token) => token.value === ",");
};

/** 参照が現れる行をtokenizeし、行内での該当token位置を返す。 */
const tokenContextOnLine = (
  source: string,
  ref: IdentifierRef,
): { readonly tokens: readonly Token[]; readonly index: number } => {
  const lineStart = source.lastIndexOf("\n", Math.max(0, ref.range.start.offset - 1)) + 1;
  const lineEndIndex = source.indexOf("\n", ref.range.end.offset);
  const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex;
  const tokens = tokenize(source.slice(lineStart, lineEnd)).filter(
    (token) => token.kind !== "Eof" && token.kind !== "Comment",
  );
  const relativeOffset = ref.range.start.offset - lineStart;
  const index = tokens.findIndex(
    (token) => token.range.start.offset === relativeOffset && token.value === ref.name,
  );
  return { tokens, index };
};

/**
 * 参照がトップレベル型定義の範囲内にあるかを二分探索する。
 *
 * @param ranges ASTの出現順に並んだ型定義range。
 * @param ref 判定する識別子参照。
 * @returns いずれかの型定義に含まれるならtrue。
 */
const isWithinTopLevelTypeDefinition = (ranges: readonly Range[], ref: IdentifierRef): boolean => {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle]!;
    if (ref.range.start.offset < range.start.offset) high = middle - 1;
    else if (ref.range.end.offset > range.end.offset) low = middle + 1;
    else return true;
  }
  return false;
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
 * @param source 呼び出し先とCFGを要求時に抽出する元ソース。
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
  source: string | undefined,
): SemanticModel => {
  const symbols: readonly SemanticSymbol[] = mutableSymbols;
  const symbolsByDefinition = definitionSymbolsOf(occurrences);
  const symbolsByScope = lazyValue(() => groupSymbolsByScope(symbols));
  const documentSymbols = lazyValue(() => makeDocumentSymbols(entries, functionScopes));
  const functionEntries = entries.filter(
    (entry): entry is FunctionDefinition => entry.kind === "FunctionDefinition",
  );
  const directCalls = lazyValue(() =>
    functionEntries.flatMap((entry) => extractDirectCalls(entry, source)),
  );
  const controlFlowGraphCache = new WeakMap<FunctionDefinition, ControlFlowGraph>();
  const graphOf = (entry: FunctionDefinition): ControlFlowGraph => {
    const cached = controlFlowGraphCache.get(entry);
    if (cached) return cached;
    const graph = extractControlFlowGraph(entry, source);
    controlFlowGraphCache.set(entry, graph);
    return graph;
  };
  const controlFlowGraphs = lazyValue(() => functionEntries.map(graphOf));

  const publicOccurrenceAt = (position: Position) => occurrenceAt(occurrences, position);
  const functionAt = (position: Position) => rangeEntryAt(functionEntries, position);
  const graphAt = (position: Position) => {
    const entry = functionAt(position);
    return entry ? graphOf(entry) : undefined;
  };

  return {
    symbols,
    occurrenceAt: publicOccurrenceAt,
    occurrences: () => occurrences,
    symbolAt: (position) => publicOccurrenceAt(position)?.symbol,
    definitionAt: (position) => publicOccurrenceAt(position)?.symbol,
    referencesOf: (symbolId) => symbolById(symbols, symbolId)?.references ?? [],
    symbolsInRange: (range) => symbolsWithin(symbolsByDefinition, range),
    visibleSymbolsAt: (position) => {
      const symbolsByScopeValue = symbolsByScope();
      const moduleSymbols = symbolsByScopeValue.get(MODULE_SCOPE_ID) ?? [];
      const entry = functionAt(position);
      return entry
        ? [...moduleSymbols, ...symbolsByScopeValue.get(`function:${entry.defines.name}`)!]
        : moduleSymbols;
    },
    documentSymbols,
    directCalls,
    controlFlowGraphs,
    controlFlowGraphAt: graphAt,
    diagnostics: () => diagnostics,
  };
};

/**
 * 解析結果内IDからシンボルを定数時間で返す。
 *
 * @param symbols 登録順の公開シンボル列。
 * @param symbolId 同じ解析結果が発行したシンボルID。
 * @returns IDがこの解析結果のシンボルと一致すればそのシンボル、未知のIDなら`undefined`。
 *
 * @remarks
 * ID全体をbase36の登録順インデックスとして使い、最初のReferences要求で全シンボルのMapを構築しない。
 * IDは単一解析結果内だけで有効なため、scope名とsymbol名を重ねて保持しない。
 */
const symbolById = (
  symbols: readonly SemanticSymbol[],
  symbolId: SymbolId,
): SemanticSymbol | undefined => {
  const index = Number.parseInt(symbolId, 36);
  const symbol = Number.isInteger(index) ? symbols[index] : undefined;
  return symbol?.id === symbolId ? symbol : undefined;
};

/** 参照列がソース位置の昇順かを返す。 */
const isSourceOrdered = (references: readonly IdentifierRef[]): boolean => {
  for (let index = 1; index < references.length; index += 1) {
    if (compareRefs(references[index - 1]!, references[index]!) > 0) return false;
  }
  return true;
};

/** ソース順の出現列から定義シンボルだけを同じ順序で取り出す。 */
const definitionSymbolsOf = (occurrences: readonly Occurrence[]): readonly SemanticSymbol[] => {
  const symbols: SemanticSymbol[] = [];
  for (const occurrence of occurrences) {
    if (sameRange(occurrence.ref.range, occurrence.symbol.definition.range)) {
      symbols.push(occurrence.symbol);
    }
  }
  return symbols;
};

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
        ? { children: functionChildren(entry, functionScopes.get(entry.defines.name)!) }
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
const functionChildren = (entry: FunctionDefinition, scope: Scope): readonly DocumentSymbol[] => {
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

/** 識別子出現をソース位置で比較する。 */
const compareOccurrences = (a: Occurrence, b: Occurrence): number =>
  a.ref.range.start.offset - b.ref.range.start.offset;

/**
 * ソース順に整列済みの識別子出現から、指定位置を含む出現を二分探索する。
 *
 * @param occurrences 開始offsetの昇順に整列済みの識別子出現。
 * @param position 問い合わせるソース位置。
 * @returns 指定位置を含む出現。識別子外ならundefined。
 */
const occurrenceAt = (
  occurrences: readonly Occurrence[],
  position: Position,
): Occurrence | undefined => {
  let low = 0;
  let high = occurrences.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const occurrence = occurrences[middle]!;
    if (contains(occurrence.ref.range, position)) return occurrence;
    if (position.offset < occurrence.ref.range.start.offset) high = middle - 1;
    else low = middle + 1;
  }
  return undefined;
};

/** ソース順の範囲列から、指定位置を含む要素を二分探索する。 */
const rangeEntryAt = <Entry extends { readonly range: Range }>(
  entries: readonly Entry[],
  position: Position,
): Entry | undefined => {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = entries[middle]!;
    if (contains(entry.range, position)) return entry;
    if (position.offset < entry.range.start.offset) high = middle - 1;
    else low = middle + 1;
  }
  return undefined;
};

/** 定義終端が指定範囲に入るシンボル列を二分探索で切り出す。 */
const symbolsWithin = (
  symbols: readonly SemanticSymbol[],
  range: Range,
): readonly SemanticSymbol[] => {
  const start = lowerBoundByDefinitionEnd(symbols, range.start.offset);
  const end = lowerBoundByDefinitionEnd(symbols, range.end.offset + 1);
  return symbols.slice(start, end);
};

/** シンボルをスコープ単位のソース順配列へまとめる。 */
const groupSymbolsByScope = (
  symbols: readonly SemanticSymbol[],
): ReadonlyMap<string, readonly SemanticSymbol[]> => {
  const groups = new Map<string, SemanticSymbol[]>();
  for (const symbol of symbols) {
    const group = groups.get(symbol.scopeId);
    if (group) group.push(symbol);
    else groups.set(symbol.scopeId, [symbol]);
  }
  return groups;
};

/** 定義終端offsetがtarget以上になる最初の位置を返す。 */
const lowerBoundByDefinitionEnd = (symbols: readonly SemanticSymbol[], target: number): number => {
  let low = 0;
  let high = symbols.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (symbols[middle]!.definition.range.end.offset < target) low = middle + 1;
    else high = middle;
  }
  return low;
};

/**
 * 2つの範囲が同じ出現を指すかを判定する。
 *
 * @param a 比較する範囲。
 * @param b 比較する範囲。
 * @returns 開始・終了 offset が同じなら true。
 */
const sameRange = (a: Range, b: Range): boolean =>
  a.start.offset === b.start.offset && a.end.offset === b.end.offset;
