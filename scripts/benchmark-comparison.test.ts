import { describe, expect, it } from "vitest";
import {
  compareBenchmarkRounds,
  createAlternatingExecutionOrder,
  extractBenchmarkMetrics,
  formatComparisonMarkdown,
  type BenchmarkRound,
} from "./benchmark-comparison.mts";

const makeRounds = (
  baseline: readonly number[],
  candidate: readonly number[],
): readonly BenchmarkRound[] =>
  baseline.map((value, index) => ({
    baseline: { "lsp.initial-load": value },
    candidate: { "lsp.initial-load": candidate[index]! },
  }));

describe("createAlternatingExecutionOrder", () => {
  it("base先行と変更後先行をroundごとに交互にする", () => {
    expect(createAlternatingExecutionOrder(3)).toEqual([
      ["baseline", "candidate"],
      ["candidate", "baseline"],
      ["baseline", "candidate"],
    ]);
  });

  it("0以下と偶数のround数を拒否する", () => {
    expect(() => createAlternatingExecutionOrder(0)).toThrow(RangeError);
    expect(() => createAlternatingExecutionOrder(2)).toThrow(RangeError);
  });
});

describe("extractBenchmarkMetrics", () => {
  it("比較対象の巨大IR指標とLSP操作を平坦化する", () => {
    const metrics = extractBenchmarkMetrics([
      {
        scenario: "many-functions",
        large: { analyzeMs: 99, statistics: { analyzeMs: { median: 20 } } },
      },
      {
        scenario: "shared-global-references",
        large: { analyzeMs: 4 },
      },
      {
        scenario: "wide-instruction-recovery",
        large: { parseMs: 3 },
      },
      {
        scenario: "file-references",
        large: {
          fileReferencesMs: 0,
          statistics: { fileReferencesMs: { median: 0.002 } },
        },
      },
      {
        scenario: "lsp-document-lifecycle",
        large: { initialLoadMs: 80, incrementalEditMs: 30 },
      },
      {
        scenario: "open-document-index-fanout",
        large: { sharedSnapshotMs: 70 },
      },
      {
        scenario: "deferred-navigation-indexes",
        ensureMs: 2,
      },
      {
        scenario: "extra-large-initial-navigation",
        initialNavigationMs: 350,
      },
      {
        scenario: "language-actions",
        large: {
          pointActions: [
            {
              name: "definition",
              coldMs: 1,
              ms: 9,
              statistics: { median: 0.1 },
            },
          ],
          outputActions: [{ name: "formatting", coldMs: 8, ms: 4 }],
        },
      },
      {
        scenario: "benchmark-metadata",
        wallMs: 1_000,
        cpuUserMs: 900,
        cpuSystemMs: 20,
      },
    ]);

    expect(metrics).toEqual({
      "many-functions.large.analyze": 20,
      "shared-global-references.large.analyze": 4,
      "wide-recovery.large.parse": 3,
      "file-references.large": 0.002,
      "lsp.initial-load": 80,
      "lsp.incremental-edit": 30,
      "fanout.shared-snapshot": 70,
      "deferred-index.ensure": 2,
      "navigation.extra-large": 350,
      "action.definition.cold": 1,
      "action.definition.warm": 0.1,
      "action.formatting.cold": 8,
      "action.formatting.warm": 4,
      "suite.wall": 1_000,
      "suite.cpu-user": 900,
      "suite.cpu-system": 20,
    });
  });

  it("欠損値と不正なactionを無視する", () => {
    expect(
      extractBenchmarkMetrics([
        { scenario: 1 },
        { scenario: "language-actions", large: 1 },
        {
          scenario: "language-actions",
          large: {
            pointActions: "not-array",
            outputActions: [
              null,
              { name: "", coldMs: 1, ms: 1 },
              { name: "invalid", coldMs: "1", ms: "1" },
            ],
          },
        },
        { scenario: "many-functions", large: { analyzeMs: "20" } },
        { scenario: "benchmark-metadata", wallMs: "1000" },
      ]),
    ).toEqual({});
  });
});

describe("compareBenchmarkRounds", () => {
  it("比率と実時間差が許容範囲ならpassにする", () => {
    const comparison = compareBenchmarkRounds(makeRounds([100, 100, 100], [105, 104, 106]));

    expect(comparison.metrics[0]?.classification).toBe("pass");
  });

  it("比率と実時間差の信頼区間が両方上限を超えた場合だけregressionにする", () => {
    const comparison = compareBenchmarkRounds(makeRounds([100, 100, 100], [120, 121, 122]));

    expect(comparison.metrics[0]?.classification).toBe("regression");
    expect(comparison.hasRegression).toBe(true);
  });

  it("相対悪化が大きくても実時間差が小さい場合はpassにする", () => {
    const comparison = compareBenchmarkRounds(makeRounds([1, 1, 1], [1.2, 1.2, 1.2]));

    expect(comparison.metrics[0]?.classification).toBe("pass");
    expect(comparison.hasRegression).toBe(false);
  });

  it("信頼区間が許容境界をまたぐ場合はinconclusiveにする", () => {
    const comparison = compareBenchmarkRounds(makeRounds([100, 100, 100], [105, 115, 120]));

    expect(comparison.metrics[0]?.classification).toBe("inconclusive");
  });

  it("baseと変更後の共通指標だけを比較する", () => {
    const comparison = compareBenchmarkRounds([
      {
        baseline: { shared: 10, baselineOnly: 1 },
        candidate: { shared: 10, candidateOnly: 1 },
      },
    ]);

    expect(comparison.metrics.map((metric) => metric.name)).toEqual(["shared"]);
  });

  it("空roundを拒否する", () => {
    expect(() => compareBenchmarkRounds([])).toThrow(RangeError);
  });
});

describe("formatComparisonMarkdown", () => {
  it("判定、中央値、信頼区間をJob Summary用の表へ整形する", () => {
    const comparison = compareBenchmarkRounds([
      {
        baseline: { "lsp.initial-load": 100 },
        candidate: { "lsp.initial-load": 120 },
      },
    ]);

    expect(formatComparisonMarkdown(comparison)).toContain(
      "| lsp.initial-load | regression | 100.0 ms | 120.0 ms | 1.200 |",
    );
    expect(
      formatComparisonMarkdown(
        compareBenchmarkRounds([
          {
            baseline: { micro: 0.001, submillisecond: 0.1 },
            candidate: { micro: 0.002, submillisecond: 0.2 },
          },
        ]),
      ),
    ).toContain("| micro | pass | 0.001000 ms | 0.002000 ms |");
    expect(
      formatComparisonMarkdown(
        compareBenchmarkRounds([
          {
            baseline: { submillisecond: 0.1 },
            candidate: { submillisecond: 0.2 },
          },
        ]),
      ),
    ).toContain("| submillisecond | pass | 0.100 ms | 0.200 ms |");
  });
});
