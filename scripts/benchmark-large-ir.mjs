import os from "node:os";
import { analyze, collectFileReferenceCandidates } from "../packages/analyzer/src/index.ts";
import {
  getCodeActions,
  getCompletionItems,
  getControlFlowGraph,
  getDefinition,
  getDocumentSymbols,
  getFoldingRanges,
  getFormattingEdits,
  getHover,
  getRangeFormattingEdits,
  getReferences,
  getRenameEdit,
  getSemanticTokens,
  makeDocumentSnapshot,
  updateDocumentSnapshot,
} from "../packages/language-server/src/lsp/features.ts";
import { CallHierarchyIndex } from "../packages/language-server/src/lsp/call-hierarchy.ts";
import { getDocumentLinks } from "../packages/language-server/src/lsp/document-links.ts";
import { getDiagnostics, getInlayHints } from "../packages/language-server/src/lsp/features.ts";
import { SnapshotDerivedIndexes } from "../packages/language-server/src/lsp/snapshot-derived-indexes.ts";
import { WorkspaceSymbolIndex } from "../packages/language-server/src/lsp/workspace-symbols.ts";
import { parseModule, tokenize } from "../packages/parser/src/index.ts";
import {
  classifyMaximum,
  classifyMinimum,
  measureAdaptiveAsyncDuration,
  measureAdaptiveDuration,
  measureAdaptivePairedDurations,
  summarizePairedRatios,
  summarizeSamples,
} from "./stable-benchmark.mts";

const SIZE_FACTOR = 4;
const RECOVERY_SIZE_FACTOR = 16;
const MAX_NORMALIZED_GROWTH = 2;
const MAX_POINT_QUERY_GROWTH = 2;
const MAX_INTERACTIVE_ACTION_MS = 20;
const MAX_COLD_FULL_ACTION_MS = 100;
const MAX_INITIAL_SNAPSHOT_MS = 500;
const MAX_INCREMENTAL_NAVIGATION_MS = 150;
const MAX_EXTRA_LARGE_NORMALIZED_GROWTH = 1.3;
const MAX_NUMERIC_LEXING_RATIO = 1.4;
const MIN_POINT_GROWTH_BASELINE_MS = 5;
const MIN_OUTPUT_GROWTH_BASELINE_MS = 10;
const MIN_INCREMENTAL_SPEEDUP = 1.2;
const MIN_SHARING_SPEEDUP = 1.2;
const MIN_SHARING_SAVED_MS = 50;
const MIN_DEFERRED_INDEX_SAVED_MS = 0.5;
const INPUT_LINEAR_COLD_POINT_ACTIONS = new Set(["code-action", "document-links"]);
const IS_COMPARISON_RUN = process.argv.includes("--comparison-run");
const SAMPLES = IS_COMPARISON_RUN ? 3 : 9;
const ADAPTIVE_BENCHMARK = {
  warmupIterations: 3,
  minSampleDurationMs: IS_COMPARISON_RUN ? 25 : 100,
  minSamples: IS_COMPARISON_RUN ? 3 : 9,
  maxSamples: IS_COMPARISON_RUN ? 3 : 25,
  maxRelativeMarginOfError: 0.1,
  maxIterationsPerSample: 10_000,
};
const LSP_DOCUMENT_URI = "file:///benchmark-large-ir.ll";
const benchmarkStartedAt = performance.now();
const benchmarkCpuStartedAt = process.cpuUsage();

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

const warmupSource = makeManyFunctions(10, 10);
analyze(parseModule(warmupSource).ast, { source: warmupSource });

let failed = false;
const inconclusiveScenarios = [];

const numericLexingPair = benchmarkLexingPair(
  makeNumericInstructions(8_000),
  makeIdentifierInstructions(8_000),
);
const numericLexingRatio = numericLexingPair.ratio.statistics.median;
console.log(
  JSON.stringify({
    scenario: "numeric-heavy-lexing",
    numeric: numericLexingPair.first,
    identifier: numericLexingPair.second,
    ratio: round(numericLexingRatio),
    ratioStatistics: numericLexingPair.ratio.statistics,
  }),
);
checkMaximum(
  "numeric-heavy-lexing",
  numericLexingPair.ratio.statistics,
  MAX_NUMERIC_LEXING_RATIO,
  `数値中心IRの字句解析が同じトークン数の識別子中心IRに対して ${round(numericLexingRatio)} 倍かかりました`,
);

for (const scenario of scenarios) {
  const benchmarkPair = benchmarkAnalysisPair(
    scenario.makeSource(scenario.smallSize),
    scenario.makeSource(scenario.smallSize * SIZE_FACTOR),
  );
  const normalizedGrowth = benchmarkPair.normalizedGrowth.statistics.median;
  console.log(
    JSON.stringify({
      scenario: scenario.name,
      small: benchmarkPair.small,
      large: benchmarkPair.large,
      normalizedGrowth: round(normalizedGrowth),
      normalizedGrowthStatistics: benchmarkPair.normalizedGrowth.statistics,
    }),
  );
  checkMaximum(
    scenario.name,
    benchmarkPair.normalizedGrowth.statistics,
    MAX_NORMALIZED_GROWTH,
    `意味解析時間が入力倍率を正規化した上で ${round(normalizedGrowth)} 倍に増加しました`,
  );
}

const recoveryPair = benchmarkParsePair(
  makeWideRecoveryInstruction(500),
  makeWideRecoveryInstruction(500 * RECOVERY_SIZE_FACTOR),
  RECOVERY_SIZE_FACTOR,
);
const recoveryNormalizedGrowth = recoveryPair.normalizedGrowth.statistics.median;
console.log(
  JSON.stringify({
    scenario: "wide-instruction-recovery",
    small: recoveryPair.small,
    large: recoveryPair.large,
    normalizedGrowth: round(recoveryNormalizedGrowth),
    normalizedGrowthStatistics: recoveryPair.normalizedGrowth.statistics,
  }),
);
checkMaximum(
  "wide-instruction-recovery",
  recoveryPair.normalizedGrowth.statistics,
  MAX_NORMALIZED_GROWTH,
  `構文解析時間が入力倍率を正規化した上で ${round(recoveryNormalizedGrowth)} 倍に増加しました`,
);

const fileReferencePair = benchmarkFileReferencePair(
  makeManyFunctions(400, 1),
  makeManyFunctions(400 * SIZE_FACTOR, 1),
);
const fileReferenceNormalizedGrowth = fileReferencePair.normalizedGrowth.statistics.median;
console.log(
  JSON.stringify({
    scenario: "file-references",
    small: fileReferencePair.small,
    large: fileReferencePair.large,
    normalizedGrowth: round(fileReferenceNormalizedGrowth),
    normalizedGrowthStatistics: fileReferencePair.normalizedGrowth.statistics,
  }),
);
checkMaximum(
  "file-references",
  fileReferencePair.normalizedGrowth.statistics,
  MAX_NORMALIZED_GROWTH,
  `抽出時間が入力倍率を正規化した上で ${round(fileReferenceNormalizedGrowth)} 倍に増加しました`,
);

const lifecycleSmall = benchmarkLspDocumentLifecycle(makeManyFunctions(400, 40));
const lifecycleLarge = benchmarkLspDocumentLifecycle(makeManyFunctions(400 * SIZE_FACTOR, 40));
const lifecycleNormalizedGrowthStatistics = {
  initialLoad: summarizePairedRatios(
    lifecycleSmall.statistics.initialLoadMs.samples,
    lifecycleLarge.statistics.initialLoadMs.samples,
    SIZE_FACTOR,
  ),
  fullRebuildEdit: summarizePairedRatios(
    lifecycleSmall.statistics.fullRebuildEditMs.samples,
    lifecycleLarge.statistics.fullRebuildEditMs.samples,
    SIZE_FACTOR,
  ),
  incrementalEdit: summarizePairedRatios(
    lifecycleSmall.statistics.incrementalEditMs.samples,
    lifecycleLarge.statistics.incrementalEditMs.samples,
    SIZE_FACTOR,
  ),
  visibleTypeQuery: summarizePairedRatios(
    lifecycleSmall.statistics.visibleTypeQueryMs.samples,
    lifecycleLarge.statistics.visibleTypeQueryMs.samples,
    SIZE_FACTOR,
  ),
};
const lifecycleNormalizedGrowth = {
  initialLoad: lifecycleNormalizedGrowthStatistics.initialLoad.median,
  fullRebuildEdit: lifecycleNormalizedGrowthStatistics.fullRebuildEdit.median,
  incrementalEdit: lifecycleNormalizedGrowthStatistics.incrementalEdit.median,
  visibleTypeQuery: lifecycleNormalizedGrowthStatistics.visibleTypeQuery.median,
};
const lifecycleSpeedupStatistics = summarizePairedRatios(
  lifecycleLarge.statistics.incrementalEditMs.samples,
  lifecycleLarge.statistics.fullRebuildEditMs.samples,
);
const lifecycleSpeedup = lifecycleSpeedupStatistics.median;
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
    normalizedGrowthStatistics: lifecycleNormalizedGrowthStatistics,
    incrementalSpeedup: round(lifecycleSpeedup),
    incrementalSpeedupStatistics: lifecycleSpeedupStatistics,
  }),
);
for (const [name, statistics] of Object.entries(lifecycleNormalizedGrowthStatistics)) {
  checkMaximum(
    `lsp-document-lifecycle.${name}`,
    statistics,
    MAX_NORMALIZED_GROWTH,
    `入力倍率を正規化した${name}の増加率が ${round(statistics.median)} になりました`,
  );
}
checkMinimum(
  "lsp-document-lifecycle.incremental-speedup",
  lifecycleSpeedupStatistics,
  MIN_INCREMENTAL_SPEEDUP,
  `インクリメンタル更新の高速化率が ${round(lifecycleSpeedup)} 倍に留まりました`,
);
checkMaximum(
  "lsp-document-lifecycle.initial-load",
  lifecycleLarge.statistics.initialLoadMs,
  MAX_INITIAL_SNAPSHOT_MS,
  `巨大IRの初回snapshotとDefinitionが ${MAX_INITIAL_SNAPSHOT_MS} msを超えました: ${lifecycleLarge.initialLoadMs} ms`,
);
checkMaximum(
  "lsp-document-lifecycle.incremental-edit",
  lifecycleLarge.statistics.incrementalEditMs,
  MAX_INCREMENTAL_NAVIGATION_MS,
  `巨大IRの局所編集後snapshotとDefinitionが ${MAX_INCREMENTAL_NAVIGATION_MS} msを超えました: ${lifecycleLarge.incrementalEditMs} ms`,
);

const fanoutSmall = benchmarkOpenDocumentFanout(makeManyFunctions(400, 40));
const fanoutLarge = benchmarkOpenDocumentFanout(makeManyFunctions(400 * SIZE_FACTOR, 40));
const fanoutNormalizedGrowthStatistics = summarizePairedRatios(
  fanoutSmall.statistics.sharedSnapshotMs.samples,
  fanoutLarge.statistics.sharedSnapshotMs.samples,
  SIZE_FACTOR,
);
const sharingSpeedupStatistics = summarizePairedRatios(
  fanoutLarge.statistics.sharedSnapshotMs.samples,
  fanoutLarge.statistics.duplicatedAnalysisMs.samples,
);
const sharingSavedStatistics = summarizeSamples(
  fanoutLarge.statistics.duplicatedAnalysisMs.samples.map(
    (duplicated, index) => duplicated - fanoutLarge.statistics.sharedSnapshotMs.samples[index],
  ),
);
const fanoutNormalizedGrowth = fanoutNormalizedGrowthStatistics.median;
const sharingSpeedup = sharingSpeedupStatistics.median;
const sharingSavedMs = sharingSavedStatistics.median;
console.log(
  JSON.stringify({
    scenario: "open-document-index-fanout",
    small: fanoutSmall,
    large: fanoutLarge,
    normalizedGrowth: round(fanoutNormalizedGrowth),
    normalizedGrowthStatistics: fanoutNormalizedGrowthStatistics,
    sharingSpeedup: round(sharingSpeedup),
    sharingSpeedupStatistics,
    sharingSavedMs: round(sharingSavedMs),
    sharingSavedStatistics,
  }),
);
checkMaximum(
  "open-document-index-fanout.normalized-growth",
  fanoutNormalizedGrowthStatistics,
  MAX_NORMALIZED_GROWTH,
  `共有スナップショットの登録時間が入力倍率を正規化した上で ${round(fanoutNormalizedGrowth)} 倍に増加しました`,
);
checkMinimum(
  "open-document-index-fanout.sharing-speedup",
  sharingSpeedupStatistics,
  MIN_SHARING_SPEEDUP,
  `解析済みスナップショット共有の高速化率が ${round(sharingSpeedup)} 倍に留まりました`,
);
checkMinimum(
  "open-document-index-fanout.saved-ms",
  sharingSavedStatistics,
  MIN_SHARING_SAVED_MS,
  `snapshot共有で省けた巨大IRの重複解析時間が ${round(sharingSavedMs)} msに留まりました`,
);

const deferredNavigation = benchmarkDeferredNavigationIndexes(
  makeManyFunctions(400 * SIZE_FACTOR, 40),
);
console.log(
  JSON.stringify({
    scenario: "deferred-navigation-indexes",
    ...deferredNavigation,
  }),
);
checkMinimum(
  "deferred-navigation-indexes.saved-ms",
  deferredNavigation.statistics.savedFromNavigationMs,
  MIN_DEFERRED_INDEX_SAVED_MS,
  `Definitionから分離した派生索引時間が ${MIN_DEFERRED_INDEX_SAVED_MS} ms未満でした: ${deferredNavigation.savedFromNavigationMs} ms`,
);

const extraLargeNavigation = benchmarkInitialNavigationPair(
  makeManyFunctions(1_600, 40),
  makeManyFunctions(6_400, 40),
);
const extraLargeNormalizedGrowth = extraLargeNavigation.normalizedGrowth.statistics.median;
console.log(
  JSON.stringify({
    scenario: "extra-large-initial-navigation",
    small: extraLargeNavigation.small,
    large: extraLargeNavigation.large,
    bytes: extraLargeNavigation.large.bytes,
    initialNavigationMs: extraLargeNavigation.large.initialNavigationMs,
    normalizedGrowth: round(extraLargeNormalizedGrowth),
    normalizedGrowthStatistics: extraLargeNavigation.normalizedGrowth.statistics,
  }),
);
checkMaximum(
  "extra-large-initial-navigation",
  extraLargeNavigation.normalizedGrowth.statistics,
  MAX_EXTRA_LARGE_NORMALIZED_GROWTH,
  `約6 MBの初回Definitionが入力4倍で正規化後 ${round(extraLargeNormalizedGrowth)} 倍に増加しました`,
);

const actionSmall = await benchmarkLanguageActions(400);
const actionLarge = await benchmarkLanguageActions(400 * SIZE_FACTOR);
const pointActionGrowth = Object.fromEntries(
  actionSmall.pointActions.map((smallAction) => {
    const largeAction = actionLarge.pointActions.find(
      (candidate) => candidate.name === smallAction.name,
    );
    return [
      smallAction.name,
      largeAction.coldMs /
        Math.max(smallAction.coldMs, MIN_POINT_GROWTH_BASELINE_MS) /
        (INPUT_LINEAR_COLD_POINT_ACTIONS.has(smallAction.name) ? SIZE_FACTOR : 1),
    ];
  }),
);
const outputActionGrowth = Object.fromEntries(
  actionSmall.outputActions.map((smallAction) => {
    const largeAction = actionLarge.outputActions.find(
      (candidate) => candidate.name === smallAction.name,
    );
    return [
      smallAction.name,
      largeAction.coldMs /
        Math.max(smallAction.coldMs, MIN_OUTPUT_GROWTH_BASELINE_MS) /
        SIZE_FACTOR,
    ];
  }),
);
console.log(
  JSON.stringify({
    scenario: "language-actions",
    small: actionSmall,
    large: actionLarge,
    pointActionGrowth: roundRecord(pointActionGrowth),
    outputActionNormalizedGrowth: roundRecord(outputActionGrowth),
  }),
);
if (
  process.argv.includes("--check") &&
  Object.entries(pointActionGrowth).some(([, growth]) => growth > MAX_POINT_QUERY_GROWTH)
) {
  console.error(
    `language-actions: 入力倍率を考慮した対話操作時間が ${JSON.stringify(roundRecord(pointActionGrowth))} 倍に増加しました`,
  );
  failed = true;
}
if (
  process.argv.includes("--check") &&
  Object.entries(outputActionGrowth).some(([, growth]) => growth > MAX_NORMALIZED_GROWTH)
) {
  console.error(
    `language-actions: 出力件数を正規化した操作時間が ${JSON.stringify(roundRecord(outputActionGrowth))} 倍に増加しました`,
  );
  failed = true;
}
if (
  process.argv.includes("--check") &&
  actionLarge.pointActions.some(
    (action) => Math.max(action.coldMs, action.ms) > MAX_INTERACTIVE_ACTION_MS,
  )
) {
  console.error(
    `language-actions: 巨大IRの対話操作が ${MAX_INTERACTIVE_ACTION_MS} msを超えました: ${JSON.stringify(actionLarge.pointActions)}`,
  );
  failed = true;
}
if (
  process.argv.includes("--check") &&
  actionLarge.outputActions.some((action) => action.coldMs > MAX_COLD_FULL_ACTION_MS)
) {
  console.error(
    `language-actions: 巨大IRの全件操作が初回 ${MAX_COLD_FULL_ACTION_MS} msを超えました: ${JSON.stringify(actionLarge.outputActions)}`,
  );
  failed = true;
}

const benchmarkCpu = process.cpuUsage(benchmarkCpuStartedAt);
console.log(
  JSON.stringify({
    scenario: "benchmark-metadata",
    wallMs: round(performance.now() - benchmarkStartedAt),
    cpuUserMs: round(benchmarkCpu.user / 1_000),
    cpuSystemMs: round(benchmarkCpu.system / 1_000),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      v8: process.versions.v8,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    inconclusiveScenarios,
  }),
);
if (failed) process.exitCode = 1;

function benchmarkAnalysisPair(smallSource, largeSource) {
  const smallAst = parseModule(smallSource).ast;
  const largeAst = parseModule(largeSource).ast;
  const tokenizePair = measureAdaptivePairedDurations(
    () => tokenize(smallSource),
    () => tokenize(largeSource),
    { ...ADAPTIVE_BENCHMARK, ratioNormalizer: SIZE_FACTOR },
  );
  const parsePair = measureAdaptivePairedDurations(
    () => parseModule(smallSource),
    () => parseModule(largeSource),
    { ...ADAPTIVE_BENCHMARK, ratioNormalizer: SIZE_FACTOR },
  );
  const analyzePair = measureAdaptivePairedDurations(
    () => analyze(smallAst, { source: smallSource }),
    () => analyze(largeAst, { source: largeSource }),
    { ...ADAPTIVE_BENCHMARK, ratioNormalizer: SIZE_FACTOR },
  );
  return {
    small: analysisResult(smallSource, tokenizePair.first, parsePair.first, analyzePair.first),
    large: analysisResult(largeSource, tokenizePair.second, parsePair.second, analyzePair.second),
    normalizedGrowth: analyzePair.ratio,
  };
}

function analysisResult(source, tokenizeResult, parseResult, analyzeResult) {
  return {
    bytes: source.length,
    tokenizeMs: round(tokenizeResult.statistics.median),
    parseMs: round(parseResult.statistics.median),
    analyzeMs: round(analyzeResult.statistics.median),
    statistics: {
      tokenizeMs: tokenizeResult.statistics,
      parseMs: parseResult.statistics,
      analyzeMs: analyzeResult.statistics,
    },
    iterationsPerSample: {
      tokenize: tokenizeResult.iterationsPerSample,
      parse: parseResult.iterationsPerSample,
      analyze: analyzeResult.iterationsPerSample,
    },
  };
}

function benchmarkParsePair(smallSource, largeSource, ratioNormalizer) {
  const pair = measureAdaptivePairedDurations(
    () => parseModule(smallSource),
    () => parseModule(largeSource),
    { ...ADAPTIVE_BENCHMARK, ratioNormalizer },
  );
  return {
    small: durationResult(smallSource, "parseMs", pair.first),
    large: durationResult(largeSource, "parseMs", pair.second),
    normalizedGrowth: pair.ratio,
  };
}

function durationResult(source, field, result) {
  return {
    bytes: source.length,
    [field]: roundDuration(result.statistics.median),
    statistics: { [field]: result.statistics },
    iterationsPerSample: result.iterationsPerSample,
  };
}

/**
 * 二つのlexer入力を同じウォームアップ状態と交互の測定順で比較する。
 *
 * @remarks
 * 入力ごとに全サンプルを直列計測すると、後から測る入力だけがJIT最適化や直前のGC停止を
 * 有利に受ける。各サンプルの先行入力を交互にし、入力固有でない順序差を比率から除く。
 */
function benchmarkLexingPair(firstSource, secondSource) {
  const pair = measureAdaptivePairedDurations(
    () => tokenize(firstSource),
    () => tokenize(secondSource),
    ADAPTIVE_BENCHMARK,
  );
  return {
    first: durationResult(firstSource, "tokenizeMs", pair.first),
    second: durationResult(secondSource, "tokenizeMs", pair.second),
    ratio: pair.ratio,
  };
}

function benchmarkFileReferencePair(smallSource, largeSource) {
  const smallAst = parseModule(smallSource).ast;
  const largeAst = parseModule(largeSource).ast;
  const pair = measureAdaptivePairedDurations(
    () => collectFileReferenceCandidates(smallAst, smallSource),
    () => collectFileReferenceCandidates(largeAst, largeSource),
    { ...ADAPTIVE_BENCHMARK, ratioNormalizer: SIZE_FACTOR },
  );
  return {
    small: durationResult(smallSource, "fileReferencesMs", pair.first),
    large: durationResult(largeSource, "fileReferencesMs", pair.second),
    normalizedGrowth: pair.ratio,
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
  const visibleTypeSnapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source, SAMPLES + 1);
  const visibleTypeQuery = measureAdaptiveDuration(
    () => assertVisibleTypesAvailable(visibleTypeSnapshot, referenceOffset),
    {
      ...ADAPTIVE_BENCHMARK,
      minSamples: SAMPLES,
      maxSamples: SAMPLES,
    },
  );

  let current = source;
  let previous = makeDocumentSnapshot(LSP_DOCUMENT_URI, current, SAMPLES * 2 + 1);
  const editSamples = Array.from({ length: SAMPLES }, (_, index) => {
    const edit = incrementalEditAt(current, index);
    const updated = replaceAt(current, edit.offset, edit.text);
    const version = SAMPLES * 2 + index + 2;

    let fullRebuildMs;
    let incrementalEditMs;
    const measureFullRebuild = () => {
      const start = performance.now();
      const full = makeDocumentSnapshot(LSP_DOCUMENT_URI, updated, version);
      assertDefinitionAvailable(full, edit.referenceOffset);
      fullRebuildMs = performance.now() - start;
    };
    const measureIncrementalEdit = () => {
      const start = performance.now();
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
      incrementalEditMs = performance.now() - start;
    };
    if (index % 2 === 0) {
      measureFullRebuild();
      measureIncrementalEdit();
    } else {
      measureIncrementalEdit();
      measureFullRebuild();
    }
    current = updated;
    return {
      fullRebuildMs,
      incrementalEditMs,
      incrementalReparsedBytes: previous.parser.reparsedBytes,
    };
  });

  const statistics = {
    initialLoadMs: summarizeSamples(initialLoadSamples),
    fullRebuildEditMs: summarizeSamples(editSamples.map((sample) => sample.fullRebuildMs)),
    incrementalEditMs: summarizeSamples(editSamples.map((sample) => sample.incrementalEditMs)),
    visibleTypeQueryMs: visibleTypeQuery.statistics,
  };
  return {
    bytes: source.length,
    initialLoadMs: round(statistics.initialLoadMs.median),
    fullRebuildEditMs: round(statistics.fullRebuildEditMs.median),
    incrementalEditMs: round(statistics.incrementalEditMs.median),
    incrementalReparsedBytes: median(editSamples.map((sample) => sample.incrementalReparsedBytes)),
    visibleTypeQueryMs: roundDuration(statistics.visibleTypeQueryMs.median),
    statistics,
    visibleTypeIterationsPerSample: visibleTypeQuery.iterationsPerSample,
  };
}

function benchmarkOpenDocumentFanout(source) {
  const duplicatedSamples = [];
  const sharedSamples = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const measureDuplicated = () => {
      const workspaceSymbols = new WorkspaceSymbolIndex();
      const callHierarchy = new CallHierarchyIndex();
      const start = performance.now();
      const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source, index + 1);
      workspaceSymbols.upsertOpenDocument(snapshot.uri, source, snapshot.version);
      callHierarchy.upsertSnapshot(snapshot);
      duplicatedSamples.push(performance.now() - start);
    };
    const measureShared = () => {
      const workspaceSymbols = new WorkspaceSymbolIndex();
      const callHierarchy = new CallHierarchyIndex();
      const start = performance.now();
      const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source, index + 1);
      workspaceSymbols.upsertOpenSnapshot(snapshot);
      callHierarchy.upsertSnapshot(snapshot);
      sharedSamples.push(performance.now() - start);
    };
    if (index % 2 === 0) {
      measureDuplicated();
      measureShared();
    } else {
      measureShared();
      measureDuplicated();
    }
  }
  const statistics = {
    duplicatedAnalysisMs: summarizeSamples(duplicatedSamples),
    sharedSnapshotMs: summarizeSamples(sharedSamples),
  };
  return {
    bytes: source.length,
    duplicatedAnalysisMs: round(statistics.duplicatedAnalysisMs.median),
    sharedSnapshotMs: round(statistics.sharedSnapshotMs.median),
    statistics,
  };
}

function benchmarkDeferredNavigationIndexes(source) {
  const referenceOffset = source.lastIndexOf(`ret i32 %v39`) + "ret i32 ".length;
  const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source);
  assertDefinitionOnly(snapshot, referenceOffset);
  const pair = measureAdaptivePairedDurations(
    () => {
      const workspaceSymbols = new WorkspaceSymbolIndex();
      const callHierarchy = new CallHierarchyIndex();
      const derived = new SnapshotDerivedIndexes(workspaceSymbols, callHierarchy);
      derived.defer(snapshot);
    },
    () => {
      const workspaceSymbols = new WorkspaceSymbolIndex();
      const callHierarchy = new CallHierarchyIndex();
      const derived = new SnapshotDerivedIndexes(workspaceSymbols, callHierarchy);
      derived.defer(snapshot);
      derived.ensure(snapshot.uri);
    },
    ADAPTIVE_BENCHMARK,
  );
  const pairedCount = Math.min(
    pair.first.statistics.samples.length,
    pair.second.statistics.samples.length,
  );
  const savedFromNavigationStatistics = summarizeSamples(
    Array.from(
      { length: pairedCount },
      (_, index) => pair.second.statistics.samples[index] - pair.first.statistics.samples[index],
    ),
  );

  const workspaceSymbols = new WorkspaceSymbolIndex();
  const callHierarchy = new CallHierarchyIndex();
  const derived = new SnapshotDerivedIndexes(workspaceSymbols, callHierarchy);
  derived.defer(snapshot);
  derived.ensure(snapshot.uri);
  if (workspaceSymbols.search("@f1599").length !== 1) {
    throw new Error("保留したWorkspace Symbol索引を最新化できませんでした");
  }
  return {
    bytes: source.length,
    deferMs: roundDuration(pair.first.statistics.median),
    ensureMs: roundDuration(pair.second.statistics.median),
    savedFromNavigationMs: roundDuration(savedFromNavigationStatistics.median),
    statistics: {
      deferMs: pair.first.statistics,
      ensureMs: pair.second.statistics,
      savedFromNavigationMs: savedFromNavigationStatistics,
    },
    iterationsPerSample: {
      defer: pair.first.iterationsPerSample,
      ensure: pair.second.iterationsPerSample,
    },
  };
}

function benchmarkInitialNavigationPair(smallSource, largeSource) {
  const smallReferenceOffset = smallSource.lastIndexOf(`ret i32 %v39`) + "ret i32 ".length;
  const largeReferenceOffset = largeSource.lastIndexOf(`ret i32 %v39`) + "ret i32 ".length;
  const pair = measureAdaptivePairedDurations(
    () => {
      const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, smallSource);
      assertDefinitionOnly(snapshot, smallReferenceOffset);
    },
    () => {
      const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, largeSource);
      assertDefinitionOnly(snapshot, largeReferenceOffset);
    },
    {
      ...ADAPTIVE_BENCHMARK,
      ratioNormalizer: SIZE_FACTOR,
      maxIterationsPerSample: 10,
    },
  );
  return {
    small: durationResult(smallSource, "initialNavigationMs", pair.first),
    large: durationResult(largeSource, "initialNavigationMs", pair.second),
    normalizedGrowth: pair.ratio,
  };
}

async function benchmarkLanguageActions(functionCount) {
  const source = `source_filename = "main.c"\n${makeManyFunctions(functionCount, 40)}`;
  const snapshot = makeDocumentSnapshot(LSP_DOCUMENT_URI, source);
  const lastFunctionOffset = source.lastIndexOf(`define i32 @f${functionCount - 1}`);
  const lastReturnOffset = source.indexOf("ret i32 %v39", lastFunctionOffset);
  const localReferenceOffset = lastReturnOffset + "ret i32 ".length;
  const localReferencePosition = snapshot.document.positionAt(localReferenceOffset);
  const visibleRange = {
    start: { line: localReferencePosition.line - 45, character: 0 },
    end: { line: localReferencePosition.line + 2, character: 0 },
  };
  const exactWorkspaceSymbols = new WorkspaceSymbolIndex();
  exactWorkspaceSymbols.upsertSnapshot(snapshot);

  const callSource = makeCallChain(functionCount);
  const callSnapshot = makeDocumentSnapshot(`${LSP_DOCUMENT_URI}.calls`, callSource);
  const callHierarchy = new CallHierarchyIndex();
  callHierarchy.upsertSnapshot(callSnapshot);
  const callOffset = callSource.indexOf(`@call${functionCount - 1}`);
  const callItem = callHierarchy.prepare(
    callSnapshot.uri,
    callSnapshot.document.positionAt(callOffset + 1),
  )[0];
  if (!callItem) throw new Error("Call Hierarchyベンチマークの対象を解決できませんでした");

  const typoSource = `${source}\ndeclare void @target_function()\ndefine void @typo_user() {\nentry:\n  call void @targat_function()\n  ret void\n}`;
  const typoSnapshot = makeDocumentSnapshot(`${LSP_DOCUMENT_URI}.typo`, typoSource);
  const typoDiagnostic = getDiagnostics(typoSnapshot).find(
    (diagnostic) => diagnostic.code === "undefined-reference",
  );
  if (!typoDiagnostic) throw new Error("Code Actionベンチマークの診断を作成できませんでした");

  const pointActions = [
    measureAction("definition", () => {
      if (!getDefinition(snapshot, localReferencePosition)) throw new Error("definitionなし");
    }),
    measureAction("hover", () => {
      if (!getHover(snapshot, localReferencePosition)) throw new Error("hoverなし");
    }),
    measureAction("visible-inlay-hints", () => {
      if (getInlayHints(snapshot, visibleRange).length < 40) throw new Error("inlay hint不足");
    }),
    measureAction("range-formatting", () => {
      getRangeFormattingEdits(snapshot, visibleRange);
    }),
    measureAction("control-flow-graph", () => {
      if (!getControlFlowGraph(snapshot, localReferencePosition)) {
        throw new Error("control flow graphなし");
      }
    }),
    measureAction("workspace-symbol-exact-query", () => {
      if (exactWorkspaceSymbols.search(`@f${functionCount - 1}`).length !== 1) {
        throw new Error("workspace symbolの完全一致結果が不正です");
      }
    }),
    measureAction("call-hierarchy-incoming", () => {
      const calls = callHierarchy.incoming(callItem);
      if (functionCount > 1 && calls.length !== 1) throw new Error("incoming call不足");
    }),
    measureAction("call-hierarchy-outgoing", () => {
      const calls = callHierarchy.outgoing(callItem);
      if (calls.length !== 0) throw new Error("終端関数にoutgoing callがあります");
    }),
    measureAction("code-action", () => {
      if (getCodeActions(typoSnapshot, typoDiagnostic.range, [typoDiagnostic]).length !== 1) {
        throw new Error("quick fix不足");
      }
    }),
    await measureAsyncAction("document-links", async () => {
      const links = await getDocumentLinks(snapshot, {
        workspaceFolderUris: [],
        fileExists: async () => true,
      });
      if (links.length !== 1) throw new Error("document link不足");
    }),
  ];

  const sharedSource = makeSharedGlobalReferences(functionCount * 10);
  const sharedSnapshot = makeDocumentSnapshot(`${LSP_DOCUMENT_URI}.references`, sharedSource);
  const sharedOffset = sharedSource.lastIndexOf("@shared");
  const sharedPosition = sharedSnapshot.document.positionAt(sharedOffset + 1);
  const outputActions = [
    measureAction("references", () => {
      if (getReferences(sharedSnapshot, sharedPosition).length !== functionCount * 10 + 1) {
        throw new Error("references不足");
      }
    }),
    measureAction("rename", () => {
      const edit = getRenameEdit(sharedSnapshot, sharedPosition, "renamed");
      if (edit?.changes?.[sharedSnapshot.uri]?.length !== functionCount * 10 + 1) {
        throw new Error("rename edit不足");
      }
    }),
    measureAction("completion", () => {
      if (getCompletionItems(snapshot, localReferencePosition).length < functionCount) {
        throw new Error("completion不足");
      }
    }),
    measureAction("document-symbols", () => {
      if (getDocumentSymbols(snapshot).length !== functionCount) {
        throw new Error("document symbol不足");
      }
    }),
    measureAction("semantic-tokens", () => {
      if (getSemanticTokens(snapshot).data.length === 0) throw new Error("semantic token不足");
    }),
    measureAction("folding-ranges", () => {
      if (getFoldingRanges(snapshot).length !== functionCount) {
        throw new Error("folding range不足");
      }
    }),
    measureAction("formatting", () => {
      getFormattingEdits(snapshot);
    }),
  ];
  return { bytes: source.length, pointActions, outputActions };
}

function measureAction(name, action) {
  const coldStart = performance.now();
  action();
  const coldMs = performance.now() - coldStart;
  const measurement = measureAdaptiveDuration(action, ADAPTIVE_BENCHMARK);
  return {
    name,
    coldMs: roundMilliseconds(coldMs),
    ms: roundMilliseconds(measurement.statistics.median),
    statistics: measurement.statistics,
    iterationsPerSample: measurement.iterationsPerSample,
  };
}

async function measureAsyncAction(name, action) {
  const coldStart = performance.now();
  await action();
  const coldMs = performance.now() - coldStart;
  const measurement = await measureAdaptiveAsyncDuration(action, ADAPTIVE_BENCHMARK);
  return {
    name,
    coldMs: roundMilliseconds(coldMs),
    ms: roundMilliseconds(measurement.statistics.median),
    statistics: measurement.statistics,
    iterationsPerSample: measurement.iterationsPerSample,
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
    text: String((sampleIndex % 8) + 2),
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

function assertDefinitionOnly(snapshot, referenceOffset) {
  const definition = getDefinition(snapshot, snapshot.document.positionAt(referenceOffset));
  if (!definition) throw new Error("Definitionを解決できませんでした");
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

function makeNumericInstructions(instructionCount) {
  return Array.from(
    { length: instructionCount },
    (_, index) => `%v${index} = add i32 ${index}, ${index + 1}\n`,
  ).join("");
}

function makeIdentifierInstructions(instructionCount) {
  return Array.from(
    { length: instructionCount },
    (_, index) => `%v${index} = add i32 %a${index}, %b${index}\n`,
  ).join("");
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

function makeCallChain(functionCount) {
  return Array.from({ length: functionCount }, (_unused, index) => {
    const body =
      index + 1 < functionCount
        ? [`  call void @call${index + 1}()`, "  ret void"]
        : ["  ret void"];
    return [`define void @call${index}() {`, "entry:", ...body, "}"].join("\n");
  }).join("\n");
}

function checkMaximum(scenario, statistics, maximum, regressionMessage) {
  if (!process.argv.includes("--check")) return;
  const classification = classifyMaximum(statistics.confidenceInterval, maximum);
  if (classification === "regression") {
    console.error(`${scenario}: ${regressionMessage}`);
    failed = true;
  } else if (classification === "inconclusive") {
    console.warn(
      `${scenario}: 95%信頼区間 ${formatConfidenceInterval(statistics)} が上限 ${maximum} をまたぐため判定不能です`,
    );
    inconclusiveScenarios.push(scenario);
  }
}

function checkMinimum(scenario, statistics, minimum, regressionMessage) {
  if (!process.argv.includes("--check")) return;
  const classification = classifyMinimum(statistics.confidenceInterval, minimum);
  if (classification === "regression") {
    console.error(`${scenario}: ${regressionMessage}`);
    failed = true;
  } else if (classification === "inconclusive") {
    console.warn(
      `${scenario}: 95%信頼区間 ${formatConfidenceInterval(statistics)} が下限 ${minimum} をまたぐため判定不能です`,
    );
    inconclusiveScenarios.push(scenario);
  }
}

function formatConfidenceInterval(statistics) {
  return `${round(statistics.confidenceInterval.lower)}–${round(statistics.confidenceInterval.upper)}`;
}

function median(values) {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function roundMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function roundDuration(value) {
  return Math.abs(value) < 1 ? roundMilliseconds(value) : round(value);
}

function roundRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, round(value)]));
}
