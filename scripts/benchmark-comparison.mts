import {
  summarizePairedRatios,
  summarizeSamples,
  type BenchmarkClassification,
  type BenchmarkStatistics,
} from "./stable-benchmark.mts";

/** 一回のbaseと変更後の計測結果。 */
export interface BenchmarkRound {
  /** baseの平坦化済み指標。 */
  readonly baseline: Readonly<Record<string, number>>;
  /** 変更後の平坦化済み指標。 */
  readonly candidate: Readonly<Record<string, number>>;
}

/** 一指標のbase比較結果。 */
export interface MetricComparison {
  /** 安定した指標名。 */
  readonly name: string;
  /** base計測値の要約統計。 */
  readonly baseline: BenchmarkStatistics;
  /** 変更後計測値の要約統計。 */
  readonly candidate: BenchmarkStatistics;
  /** 各roundの`candidate / baseline`。 */
  readonly ratio: BenchmarkStatistics;
  /** 各roundの`candidate - baseline`。単位はms。 */
  readonly absoluteDifferenceMs: BenchmarkStatistics;
  /** 相対差と絶対差を組み合わせた判定。 */
  readonly classification: BenchmarkClassification;
}

/** 全指標のbase比較結果。 */
export interface BenchmarkComparison {
  /** 比較に使ったround数。 */
  readonly rounds: number;
  /** 指標名順の比較結果。 */
  readonly metrics: readonly MetricComparison[];
  /** 一つ以上の確定した性能回帰を含むか。 */
  readonly hasRegression: boolean;
  /** 一つ以上の判定不能を含むか。 */
  readonly hasInconclusive: boolean;
}

/** 比較対象ごとの実行識別子。 */
export type BenchmarkTarget = "baseline" | "candidate";

/** base比として許容する初期上限。 */
export const MAX_CANDIDATE_RATIO = 1.1;
/** 実用上の回帰として扱う実時間差の下限。単位はms。 */
export const MIN_REGRESSION_DIFFERENCE_MS = 5;

/**
 * base先行と変更後先行を交互にする実行順を作る。
 *
 * @param rounds 比較する正の奇数round数。
 * @returns 各roundに二対象を一度ずつ含む実行順。
 * @throws 0以下または偶数のround数を拒否する。
 */
export const createAlternatingExecutionOrder = (
  rounds: number,
): readonly (readonly BenchmarkTarget[])[] => {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds % 2 === 0) {
    throw new RangeError("roundsは正の奇数で指定してください");
  }
  return Array.from({ length: rounds }, (_, index) =>
    index % 2 === 0 ? (["baseline", "candidate"] as const) : (["candidate", "baseline"] as const),
  );
};

/**
 * JSON Lines形式の巨大IRベンチマーク出力からbase比較用指標を取り出す。
 *
 * @remarks
 * 指標名は成果物と履歴の識別子になるため、表示文言から独立させる。
 * 存在しないシナリオは無視し、baseと変更後に共通する指標だけを後段で比較する。
 *
 * @param rows `scenario`を持つ巨大IRベンチマーク出力。
 * @returns 小さいほど良いwall timeの平坦な指標。
 */
export const extractBenchmarkMetrics = (
  rows: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, number>> => {
  const metrics: Record<string, number> = {};
  for (const row of rows) {
    const scenario = stringValue(row.scenario);
    if (scenario === "many-functions" || scenario === "shared-global-references") {
      setFirstNestedNumber(metrics, `${scenario}.large.analyze`, row, [
        ["large", "statistics", "analyzeMs", "median"],
        ["large", "analyzeMs"],
      ]);
    } else if (scenario === "wide-instruction-recovery") {
      setFirstNestedNumber(metrics, "wide-recovery.large.parse", row, [
        ["large", "statistics", "parseMs", "median"],
        ["large", "parseMs"],
      ]);
    } else if (scenario === "file-references") {
      setFirstNestedNumber(metrics, "file-references.large", row, [
        ["large", "statistics", "fileReferencesMs", "median"],
        ["large", "fileReferencesMs"],
      ]);
    } else if (scenario === "lsp-document-lifecycle") {
      setStatisticMetric(metrics, "lsp.initial-load", row, "initialLoadMs");
      setStatisticMetric(metrics, "lsp.full-rebuild-edit", row, "fullRebuildEditMs");
      setStatisticMetric(metrics, "lsp.incremental-edit", row, "incrementalEditMs");
      setStatisticMetric(metrics, "lsp.visible-type-query", row, "visibleTypeQueryMs");
    } else if (scenario === "open-document-index-fanout") {
      setFirstNestedNumber(metrics, "fanout.shared-snapshot", row, [
        ["large", "statistics", "sharedSnapshotMs", "median"],
        ["large", "sharedSnapshotMs"],
      ]);
    } else if (scenario === "deferred-navigation-indexes") {
      setFirstNestedNumber(metrics, "deferred-index.ensure", row, [
        ["statistics", "ensureMs", "median"],
        ["ensureMs"],
      ]);
    } else if (scenario === "extra-large-initial-navigation") {
      setFirstNestedNumber(metrics, "navigation.extra-large", row, [
        ["large", "statistics", "initialNavigationMs", "median"],
        ["initialNavigationMs"],
      ]);
    } else if (scenario === "language-actions") {
      addActionMetrics(metrics, isRecord(row.large) ? row.large : undefined);
    } else if (scenario === "benchmark-metadata") {
      setNestedNumber(metrics, "suite.wall", row, ["wallMs"]);
      setNestedNumber(metrics, "suite.cpu-user", row, ["cpuUserMs"]);
      setNestedNumber(metrics, "suite.cpu-system", row, ["cpuSystemMs"]);
    }
  }
  return metrics;
};

/**
 * 同じVMで計測したroundからbase比と実時間差を判定する。
 *
 * @remarks
 * 相対差の信頼区間が10%悪化を超え、実時間差の信頼区間も5 msを超えた場合だけ
 * `regression`とする。
 * どちらかが許容範囲内なら`pass`、それ以外は`inconclusive`とする。
 *
 * @param rounds baseと変更後を一度ずつ含むround。
 * @returns 共通指標の比較結果。
 * @throws roundが空の場合は`RangeError`。
 */
export const compareBenchmarkRounds = (rounds: readonly BenchmarkRound[]): BenchmarkComparison => {
  if (rounds.length === 0) throw new RangeError("roundを一つ以上指定してください");
  const metricNames = Object.keys(rounds[0]!.baseline)
    .filter((name) =>
      rounds.every(
        (round) => Number.isFinite(round.baseline[name]) && Number.isFinite(round.candidate[name]),
      ),
    )
    .toSorted();
  const metrics = metricNames.map((name) => compareMetric(name, rounds));
  return {
    rounds: rounds.length,
    metrics,
    hasRegression: metrics.some((metric) => metric.classification === "regression"),
    hasInconclusive: metrics.some((metric) => metric.classification === "inconclusive"),
  };
};

/**
 * 比較結果をGitHub Actions Job Summary用Markdownへ整形する。
 *
 * @param comparison 全指標の比較結果。
 * @returns 見出し、判定規則、指標表を含むMarkdown。
 */
export const formatComparisonMarkdown = (comparison: BenchmarkComparison): string => {
  const lines = [
    "# 巨大IR性能比較",
    "",
    `同じrunnerで${comparison.rounds} roundを交互に計測しました。`,
    `比率の95%信頼区間が${MAX_CANDIDATE_RATIO.toFixed(2)}を超え、実時間差も${MIN_REGRESSION_DIFFERENCE_MS.toFixed(1)} msを超えた場合だけ回帰と判定します。`,
    "",
    "| 指標 | 判定 | base中央値 | 変更後中央値 | 比率中央値 | 比率95% CI | 差分95% CI |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...comparison.metrics.map(
      (metric) =>
        `| ${metric.name} | ${metric.classification} | ${formatMilliseconds(metric.baseline.median)} | ${formatMilliseconds(metric.candidate.median)} | ${metric.ratio.median.toFixed(3)} | ${formatInterval(metric.ratio, 3)} | ${formatInterval(metric.absoluteDifferenceMs, 1, " ms")} |`,
    ),
    "",
  ];
  return lines.join("\n");
};

const compareMetric = (name: string, rounds: readonly BenchmarkRound[]): MetricComparison => {
  const baselineSamples = rounds.map((round) => round.baseline[name]!);
  const candidateSamples = rounds.map((round) => round.candidate[name]!);
  const ratio = summarizePairedRatios(baselineSamples, candidateSamples);
  const absoluteDifferenceMs = summarizeSamples(
    baselineSamples.map((baseline, index) => candidateSamples[index]! - baseline),
  );
  return {
    name,
    baseline: summarizeSamples(baselineSamples),
    candidate: summarizeSamples(candidateSamples),
    ratio,
    absoluteDifferenceMs,
    classification: classifyRegression(ratio, absoluteDifferenceMs),
  };
};

const classifyRegression = (
  ratio: BenchmarkStatistics,
  difference: BenchmarkStatistics,
): BenchmarkClassification => {
  if (
    ratio.confidenceInterval.lower > MAX_CANDIDATE_RATIO &&
    difference.confidenceInterval.lower > MIN_REGRESSION_DIFFERENCE_MS
  ) {
    return "regression";
  }
  if (
    ratio.confidenceInterval.upper <= MAX_CANDIDATE_RATIO ||
    difference.confidenceInterval.upper <= MIN_REGRESSION_DIFFERENCE_MS
  ) {
    return "pass";
  }
  return "inconclusive";
};

const addActionMetrics = (
  metrics: Record<string, number>,
  large: Readonly<Record<string, unknown>> | undefined,
): void => {
  if (!large) return;
  for (const collectionName of ["pointActions", "outputActions"] as const) {
    const actions = large[collectionName];
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (!isRecord(action)) continue;
      const name = stringValue(action.name);
      const coldMs = numberValue(action.coldMs);
      const warmMs = nestedNumber(action, ["statistics", "median"]) ?? numberValue(action.ms);
      if (!name) continue;
      if (coldMs !== undefined) metrics[`action.${name}.cold`] = coldMs;
      if (warmMs !== undefined) metrics[`action.${name}.warm`] = warmMs;
    }
  }
};

const setNestedNumber = (
  metrics: Record<string, number>,
  name: string,
  row: Readonly<Record<string, unknown>>,
  path: readonly string[],
): void => {
  const value = nestedNumber(row, path);
  if (value !== undefined) metrics[name] = value;
};

const setFirstNestedNumber = (
  metrics: Record<string, number>,
  name: string,
  row: Readonly<Record<string, unknown>>,
  paths: readonly (readonly string[])[],
): void => {
  for (const path of paths) {
    const value = nestedNumber(row, path);
    if (value !== undefined) {
      metrics[name] = value;
      return;
    }
  }
};

const setStatisticMetric = (
  metrics: Record<string, number>,
  name: string,
  row: Readonly<Record<string, unknown>>,
  field: string,
): void => {
  setFirstNestedNumber(metrics, name, row, [
    ["large", "statistics", field, "median"],
    ["large", field],
  ]);
};

const nestedNumber = (
  value: Readonly<Record<string, unknown>>,
  path: readonly string[],
): number | undefined => {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return numberValue(current);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const formatMilliseconds = (value: number): string => {
  const absolute = Math.abs(value);
  const fractionDigits = absolute < 0.01 ? 6 : absolute < 1 ? 3 : 1;
  return `${value.toFixed(fractionDigits)} ms`;
};

const formatInterval = (
  statistics: BenchmarkStatistics,
  fractionDigits: number,
  suffix = "",
): string =>
  `${statistics.confidenceInterval.lower.toFixed(fractionDigits)}–${statistics.confidenceInterval.upper.toFixed(fractionDigits)}${suffix}`;
