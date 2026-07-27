import { analyze, collectFileReferenceCandidates } from "../packages/analyzer/src/index.ts";
import {
  getDefinition,
  makeDocumentSnapshot,
  updateDocumentSnapshot,
} from "../packages/language-server/src/index.ts";
import { CallHierarchyIndex } from "../packages/language-server/src/lsp/call-hierarchy.ts";
import { getInlayHints } from "../packages/language-server/src/lsp/features.ts";
import { WorkspaceSymbolIndex } from "../packages/language-server/src/lsp/workspace-symbols.ts";
import { parseModule } from "../packages/parser/src/index.ts";
import { measureMedianDuration } from "./stable-benchmark.mts";

const SIZE_FACTOR = 4;
const RECOVERY_SIZE_FACTOR = 16;
const MAX_NORMALIZED_GROWTH = 2;
const MIN_INCREMENTAL_SPEEDUP = 1.2;
const MIN_SHARING_SPEEDUP = 1.5;
const SAMPLES = 5;
const FILE_REFERENCE_BENCHMARK = {
  warmupIterations: 3,
  iterationsPerSample: 25,
  samples: 5,
};
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

const recoverySmall = benchmarkParse(makeWideRecoveryInstruction(500));
const recoveryLarge = benchmarkParse(makeWideRecoveryInstruction(500 * RECOVERY_SIZE_FACTOR));
const recoveryNormalizedGrowth =
  recoveryLarge.parseMs / recoverySmall.parseMs / RECOVERY_SIZE_FACTOR;
console.log(
  JSON.stringify({
    scenario: "wide-instruction-recovery",
    small: recoverySmall,
    large: recoveryLarge,
    normalizedGrowth: round(recoveryNormalizedGrowth),
  }),
);
if (process.argv.includes("--check") && recoveryNormalizedGrowth > MAX_NORMALIZED_GROWTH) {
  console.error(
    `wide-instruction-recovery: 構文解析時間が入力倍率を正規化した上で ${round(recoveryNormalizedGrowth)} 倍に増加しました`,
  );
  failed = true;
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
  fullRebuildEdit:
    lifecycleLarge.fullRebuildEditMs / lifecycleSmall.fullRebuildEditMs / SIZE_FACTOR,
  incrementalEdit:
    lifecycleLarge.incrementalEditMs / lifecycleSmall.incrementalEditMs / SIZE_FACTOR,
  visibleTypeQuery:
    lifecycleLarge.visibleTypeQueryMs / lifecycleSmall.visibleTypeQueryMs / SIZE_FACTOR,
};
const lifecycleSpeedup = lifecycleLarge.fullRebuildEditMs / lifecycleLarge.incrementalEditMs;
console.log(
  JSON.stringify({
    scenario: "lsp-document-lifecycle",
    small: lifecycleSmall,
    large: lifecycleLarge,
    normalizedGrowth: {
      initialLoad: round(lifecycleNormalizedGrowth.initialLoad),
      fullRebuildEdit: round(lifecycleNormalizedGrowth.fullRebuildEdit),
      incrementalEdit: round(lifecycleNormalizedGrowth.incrementalEdit),
      visibleTypeQuery: round(lifecycleNormalizedGrowth.visibleTypeQuery),
    },
    incrementalSpeedup: round(lifecycleSpeedup),
  }),
);
if (
  process.argv.includes("--check") &&
  Object.values(lifecycleNormalizedGrowth).some((growth) => growth > MAX_NORMALIZED_GROWTH)
) {
  console.error(
    `lsp-document-lifecycle: 入力倍率を正規化した増加率が initial-load=${round(lifecycleNormalizedGrowth.initialLoad)}, full-rebuild-edit=${round(lifecycleNormalizedGrowth.fullRebuildEdit)}, incremental-edit=${round(lifecycleNormalizedGrowth.incrementalEdit)}, visible-type-query=${round(lifecycleNormalizedGrowth.visibleTypeQuery)} になりました`,
  );
  failed = true;
}
if (process.argv.includes("--check") && lifecycleSpeedup < MIN_INCREMENTAL_SPEEDUP) {
  console.error(
    `lsp-document-lifecycle: インクリメンタル更新の高速化率が ${round(lifecycleSpeedup)} 倍に留まりました`,
  );
  failed = true;
}

const fanoutSmall = benchmarkOpenDocumentFanout(makeManyFunctions(400, 40));
const fanoutLarge = benchmarkOpenDocumentFanout(makeManyFunctions(400 * SIZE_FACTOR, 40));
const fanoutNormalizedGrowth =
  fanoutLarge.sharedSnapshotMs / fanoutSmall.sharedSnapshotMs / SIZE_FACTOR;
const sharingSpeedup = fanoutLarge.duplicatedAnalysisMs / fanoutLarge.sharedSnapshotMs;
console.log(
  JSON.stringify({
    scenario: "open-document-index-fanout",
    small: fanoutSmall,
    large: fanoutLarge,
    normalizedGrowth: round(fanoutNormalizedGrowth),
    sharingSpeedup: round(sharingSpeedup),
  }),
);
if (process.argv.includes("--check") && fanoutNormalizedGrowth > MAX_NORMALIZED_GROWTH) {
  console.error(
    `open-document-index-fanout: 共有スナップショットの登録時間が入力倍率を正規化した上で ${round(fanoutNormalizedGrowth)} 倍に増加しました`,
  );
  failed = true;
}
if (process.argv.includes("--check") && sharingSpeedup < MIN_SHARING_SPEEDUP) {
  console.error(
    `open-document-index-fanout: 解析済みスナップショット共有の高速化率が ${round(sharingSpeedup)} 倍に留まりました`,
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

function benchmarkParse(source) {
  const samples = Array.from({ length: SAMPLES }, () => {
    const start = performance.now();
    parseModule(source);
    return performance.now() - start;
  });
  return {
    bytes: source.length,
    parseMs: round(median(samples)),
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
  return {
    bytes: source.length,
    fileReferencesMs: round(
      measureMedianDuration(() => {
        collectFileReferenceCandidates(ast, source);
      }, FILE_REFERENCE_BENCHMARK),
    ),
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
  const visibleTypeQuerySamples = Array.from({ length: SAMPLES }, (_, index) => {
    const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source, SAMPLES + index + 1);
    const start = performance.now();
    assertVisibleTypesAvailable(snapshot, referenceOffset);
    return performance.now() - start;
  });

  let current = source;
  let previous = makeDocumentSnapshot(LSP_DOCUMENT_URI, current, SAMPLES * 2 + 1);
  const editSamples = Array.from({ length: SAMPLES }, (_, index) => {
    const edit = incrementalEditAt(current, index);
    const updated = replaceAt(current, edit.offset, edit.text);
    const version = SAMPLES * 2 + index + 2;

    const fullStart = performance.now();
    const full = makeDocumentSnapshot(LSP_DOCUMENT_URI, updated, version);
    assertDefinitionAvailable(full, edit.referenceOffset);
    const fullRebuildMs = performance.now() - fullStart;

    const incrementalStart = performance.now();
    previous = updateDocumentSnapshot(previous, updated, version, [
      {
        range: {
          start: previous.document.positionAt(edit.offset),
          end: previous.document.positionAt(edit.offset + 1),
        },
        text: edit.text,
      },
    ]);
    if (previous.parser.strategy !== "incremental") {
      throw new Error("単一命令内の編集がインクリメンタルに処理されませんでした");
    }
    assertDefinitionAvailable(previous, edit.referenceOffset);
    const incrementalEditMs = performance.now() - incrementalStart;
    current = updated;
    return {
      fullRebuildMs,
      incrementalEditMs,
      incrementalReparsedBytes: previous.parser.reparsedBytes,
    };
  });

  return {
    bytes: source.length,
    initialLoadMs: round(median(initialLoadSamples)),
    fullRebuildEditMs: round(median(editSamples.map((sample) => sample.fullRebuildMs))),
    incrementalEditMs: round(median(editSamples.map((sample) => sample.incrementalEditMs))),
    incrementalReparsedBytes: median(editSamples.map((sample) => sample.incrementalReparsedBytes)),
    visibleTypeQueryMs: round(median(visibleTypeQuerySamples)),
  };
}

function benchmarkOpenDocumentFanout(source) {
  const duplicatedSamples = Array.from({ length: SAMPLES }, (_, index) => {
    const workspaceSymbols = new WorkspaceSymbolIndex();
    const callHierarchy = new CallHierarchyIndex();
    const start = performance.now();
    const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source, index + 1);
    workspaceSymbols.upsertOpenDocument(snapshot.uri, source, snapshot.version);
    callHierarchy.upsertSnapshot(snapshot);
    return performance.now() - start;
  });
  const sharedSamples = Array.from({ length: SAMPLES }, (_, index) => {
    const workspaceSymbols = new WorkspaceSymbolIndex();
    const callHierarchy = new CallHierarchyIndex();
    const start = performance.now();
    const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source, index + 1);
    workspaceSymbols.upsertOpenSnapshot(snapshot);
    callHierarchy.upsertSnapshot(snapshot);
    return performance.now() - start;
  });
  return {
    bytes: source.length,
    duplicatedAnalysisMs: round(median(duplicatedSamples)),
    sharedSnapshotMs: round(median(sharedSamples)),
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

function assertVisibleTypesAvailable(snapshot, referenceOffset) {
  const referencePosition = snapshot.document.positionAt(referenceOffset);
  const hints = getInlayHints(snapshot, {
    start: { line: Math.max(0, referencePosition.line - 45), character: 0 },
    end: { line: referencePosition.line + 2, character: 0 },
  });
  if (hints.length < 40 || hints.some((hint) => hint.label !== ": i32")) {
    throw new Error("表示範囲の型情報を解決できませんでした");
  }
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

function makeWideRecoveryInstruction(incomingCount) {
  const incoming = Array.from({ length: incomingCount }, () => "[ 0, %entry ]").join(", ");
  return [
    "define i32 @wide_recovery() {",
    "entry:",
    `  %value = unknown ${incoming} add`,
    "  ret i32 %value",
    "}",
  ].join("\n");
}

function median(values) {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)];
}

function round(value) {
  return Math.round(value * 10) / 10;
}
