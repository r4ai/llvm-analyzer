import { analyze, collectFileReferenceCandidates } from "../packages/analyzer/src/index.ts";
import { getDefinition, makeDocumentSnapshot } from "../packages/language-server/src/index.ts";
import { parseModule } from "../packages/parser/src/index.ts";

const SIZE_FACTOR = 4;
const MAX_NORMALIZED_GROWTH = 2;
const SAMPLES = 3;
const LSP_DOCUMENT_URI = "file:///benchmark-large-ir.ll";

const scenarios = [
  {
    name: "many-functions",
    smallSize: 400,
    makeSource: (size) => makeManyFunctions(size, 40),
  },
  {
    name: "shared-global-references",
    smallSize: 4_000,
    makeSource: makeSharedGlobalReferences,
  },
];

parseAndAnalyze(makeManyFunctions(10, 10));

let failed = false;
for (const scenario of scenarios) {
  const small = benchmark(scenario.makeSource(scenario.smallSize));
  const large = benchmark(scenario.makeSource(scenario.smallSize * SIZE_FACTOR));
  const normalizedGrowth = large.analyzeMs / small.analyzeMs / SIZE_FACTOR;
  console.log(
    JSON.stringify({
      scenario: scenario.name,
      small,
      large,
      normalizedGrowth: round(normalizedGrowth),
    }),
  );
  if (process.argv.includes("--check") && normalizedGrowth > MAX_NORMALIZED_GROWTH) {
    console.error(
      `${scenario.name}: 意味解析時間が入力倍率を正規化した上で ${round(normalizedGrowth)} 倍に増加しました`,
    );
    failed = true;
  }
}

const fileReferenceSmall = benchmarkFileReferences(makeManyFunctions(400, 1));
const fileReferenceLarge = benchmarkFileReferences(makeManyFunctions(400 * SIZE_FACTOR, 1));
const fileReferenceNormalizedGrowth =
  fileReferenceLarge.fileReferencesMs / fileReferenceSmall.fileReferencesMs / SIZE_FACTOR;
console.log(
  JSON.stringify({
    scenario: "file-references",
    small: fileReferenceSmall,
    large: fileReferenceLarge,
    normalizedGrowth: round(fileReferenceNormalizedGrowth),
  }),
);
if (process.argv.includes("--check") && fileReferenceNormalizedGrowth > MAX_NORMALIZED_GROWTH) {
  console.error(
    `file-references: 抽出時間が入力倍率を正規化した上で ${round(fileReferenceNormalizedGrowth)} 倍に増加しました`,
  );
  failed = true;
}

const lifecycleSmall = benchmarkLspDocumentLifecycle(makeManyFunctions(400, 40));
const lifecycleLarge = benchmarkLspDocumentLifecycle(makeManyFunctions(400 * SIZE_FACTOR, 40));
const lifecycleNormalizedGrowth = {
  initialLoad: lifecycleLarge.initialLoadMs / lifecycleSmall.initialLoadMs / SIZE_FACTOR,
  incrementalEdit:
    lifecycleLarge.incrementalEditMs / lifecycleSmall.incrementalEditMs / SIZE_FACTOR,
};
console.log(
  JSON.stringify({
    scenario: "lsp-document-lifecycle",
    small: lifecycleSmall,
    large: lifecycleLarge,
    normalizedGrowth: {
      initialLoad: round(lifecycleNormalizedGrowth.initialLoad),
      incrementalEdit: round(lifecycleNormalizedGrowth.incrementalEdit),
    },
  }),
);
if (
  process.argv.includes("--check") &&
  Object.values(lifecycleNormalizedGrowth).some((growth) => growth > MAX_NORMALIZED_GROWTH)
) {
  console.error(
    `lsp-document-lifecycle: 入力倍率を正規化した増加率が initial-load=${round(lifecycleNormalizedGrowth.initialLoad)}, incremental-edit=${round(lifecycleNormalizedGrowth.incrementalEdit)} になりました`,
  );
  failed = true;
}

if (failed) process.exitCode = 1;

function benchmark(source) {
  const samples = Array.from({ length: SAMPLES }, () => parseAndAnalyze(source));
  return {
    bytes: source.length,
    parseMs: median(samples.map((sample) => sample.parseMs)),
    analyzeMs: median(samples.map((sample) => sample.analyzeMs)),
  };
}

function parseAndAnalyze(source) {
  const start = performance.now();
  const parsed = parseModule(source);
  const parsedAt = performance.now();
  analyze(parsed.ast, { source });
  const analyzedAt = performance.now();
  return {
    parseMs: round(parsedAt - start),
    analyzeMs: round(analyzedAt - parsedAt),
  };
}

function benchmarkFileReferences(source) {
  const ast = parseModule(source).ast;
  const samples = Array.from({ length: SAMPLES }, () => {
    const start = performance.now();
    collectFileReferenceCandidates(ast, source);
    return performance.now() - start;
  });
  return {
    bytes: source.length,
    fileReferencesMs: round(median(samples)),
  };
}

function benchmarkLspDocumentLifecycle(source) {
  const referenceOffset = source.lastIndexOf(`ret i32 %v39`) + "ret i32 ".length;
  const initialLoadSamples = Array.from({ length: SAMPLES }, (_, index) => {
    const start = performance.now();
    const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source, index + 1);
    assertDefinitionAvailable(snapshot, referenceOffset);
    return performance.now() - start;
  });

  let current = source;
  const incrementalEditSamples = Array.from({ length: SAMPLES }, (_, index) => {
    const edit = incrementalEditAt(current, index);
    const start = performance.now();
    current = replaceAt(current, edit.offset, edit.text);
    const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, current, SAMPLES + index + 1);
    assertDefinitionAvailable(snapshot, edit.referenceOffset);
    return performance.now() - start;
  });

  return {
    bytes: source.length,
    initialLoadMs: round(median(initialLoadSamples)),
    incrementalEditMs: round(median(incrementalEditSamples)),
  };
}

function incrementalEditAt(source, sampleIndex) {
  const searchStart = Math.floor((source.length * (sampleIndex + 1)) / (SAMPLES + 1));
  const instructionStart = source.indexOf("add i32 0, 1", searchStart);
  const returnStart = source.indexOf("ret i32 %v39", instructionStart);
  if (instructionStart < 0 || returnStart < 0) {
    throw new Error("差分編集対象の命令を見つけられませんでした");
  }
  return {
    offset: instructionStart + "add i32 ".length,
    text: String(sampleIndex + 2),
    referenceOffset: returnStart + "ret i32 ".length,
  };
}

function replaceAt(source, offset, replacement) {
  return source.slice(0, offset) + replacement + source.slice(offset + 1);
}

function assertDefinitionAvailable(snapshot, referenceOffset) {
  if (snapshot.parse.diagnostics.length > 0 || snapshot.model.diagnostics().length > 0) {
    throw new Error("ベンチマーク用IRの解析で診断が発生しました");
  }
  const definition = getDefinition(snapshot, snapshot.document.positionAt(referenceOffset));
  if (!definition) throw new Error("差分編集後の定義参照を解決できませんでした");
}

function makeManyFunctions(functionCount, instructionCount) {
  return Array.from({ length: functionCount }, (_unusedFunction, functionIndex) => {
    const instructions = Array.from(
      { length: instructionCount },
      (_unusedInstruction, instructionIndex) =>
        `  %v${instructionIndex} = add i32 ${instructionIndex}, ${instructionIndex + 1}`,
    );
    instructions.push(`  ret i32 %v${instructionCount - 1}`);
    return [`define i32 @f${functionIndex}(i32 %input) {`, "entry:", ...instructions, "}"].join(
      "\n",
    );
  }).join("\n");
}

function makeSharedGlobalReferences(referenceCount) {
  const instructions = Array.from(
    { length: referenceCount },
    (_, index) => `  %v${index} = load i32, ptr @shared`,
  );
  return [
    "@shared = global i32 0",
    "define i32 @read_shared() {",
    "entry:",
    ...instructions,
    `  ret i32 %v${referenceCount - 1}`,
    "}",
  ].join("\n");
}

function median(values) {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)];
}

function round(value) {
  return Math.round(value * 10) / 10;
}
