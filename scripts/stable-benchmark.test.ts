import { describe, expect, it } from "vitest";
import {
  classifyMaximum,
  classifyMinimum,
  measureAdaptiveAsyncDuration,
  measureAdaptiveDuration,
  measureAdaptivePairedDurations,
  measureMedianDuration,
  summarizePairedRatios,
  summarizeSamples,
  type AdaptiveBenchmarkOptions,
  type StableBenchmarkOptions,
} from "./stable-benchmark.mts";

const measure = (durations: readonly number[], options: StableBenchmarkOptions): number => {
  let elapsed = 0;
  let call = 0;
  const result = measureMedianDuration(
    () => {
      elapsed += durations[call]!;
      call += 1;
    },
    options,
    () => elapsed,
  );
  expect(call).toBe(durations.length);
  return result;
};

describe("measureMedianDuration", () => {
  it("既定の単調時計で同期処理を計測する", () => {
    expect(
      measureMedianDuration(() => {}, {
        warmupIterations: 0,
        iterationsPerSample: 1,
        samples: 1,
      }),
    ).toBeGreaterThanOrEqual(0);
  });

  it("ウォームアップを除外し、バッチの一回あたり時間の中央値を返す", () => {
    expect(
      measure([100, 100, 2, 2, 4, 4, 6, 6], {
        warmupIterations: 2,
        iterationsPerSample: 2,
        samples: 3,
      }),
    ).toBe(4);
  });

  it("一サンプルだけの遅延を代表値から除外する", () => {
    expect(
      measure([1, 1, 20, 1, 1], {
        warmupIterations: 0,
        iterationsPerSample: 1,
        samples: 5,
      }),
    ).toBe(1);
  });

  it("過半数のサンプルで続く遅延を代表値にする", () => {
    expect(
      measure([1, 10, 10, 10, 1], {
        warmupIterations: 0,
        iterationsPerSample: 1,
        samples: 5,
      }),
    ).toBe(10);
  });

  it.each([
    {
      name: "負のウォームアップ回数",
      options: { warmupIterations: -1, iterationsPerSample: 1, samples: 3 },
    },
    {
      name: "0回のバッチ",
      options: { warmupIterations: 0, iterationsPerSample: 0, samples: 3 },
    },
    {
      name: "偶数のサンプル数",
      options: { warmupIterations: 0, iterationsPerSample: 1, samples: 4 },
    },
  ])("$nameを拒否する", ({ options }) => {
    expect(() => measure([], options)).toThrow(RangeError);
  });
});

describe("measureAdaptiveDuration", () => {
  const stableOptions: AdaptiveBenchmarkOptions = {
    warmupIterations: 1,
    minSampleDurationMs: 10,
    minSamples: 3,
    maxSamples: 5,
    maxRelativeMarginOfError: 0.1,
    maxIterationsPerSample: 100,
  };

  it("目標時間を満たす反復数へ調整し、安定した最小サンプル数で終了する", () => {
    let elapsed = 0;
    let calls = 0;
    const result = measureAdaptiveDuration(
      () => {
        elapsed += 2;
        calls += 1;
      },
      stableOptions,
      () => elapsed,
    );

    expect(result.iterationsPerSample).toBe(5);
    expect(result.statistics.samples).toEqual([2, 2, 2]);
    expect(result.statistics.median).toBe(2);
    expect(calls).toBe(17);
  });

  it("既定の単調時計で同期処理を計測する", () => {
    expect(
      measureAdaptiveDuration(() => {}, {
        ...stableOptions,
        warmupIterations: 0,
        minSampleDurationMs: 0.001,
        minSamples: 1,
        maxSamples: 1,
        maxIterationsPerSample: 1,
      }).statistics.median,
    ).toBeGreaterThanOrEqual(0);
  });

  it("信頼区間が収束しない場合は奇数個ずつ最大サンプル数まで増やす", () => {
    const durations = [1, 1, 10, 1, 10, 1];
    let elapsed = 0;
    let calls = 0;
    const result = measureAdaptiveDuration(
      () => {
        elapsed += durations[calls]!;
        calls += 1;
      },
      {
        ...stableOptions,
        warmupIterations: 0,
        minSampleDurationMs: 1,
        maxIterationsPerSample: 1,
      },
      () => elapsed,
    );

    expect(result.statistics.samples).toHaveLength(5);
    expect(result.statistics.samples.length % 2).toBe(1);
  });

  it.each([
    {
      name: "偶数の最小サンプル数",
      options: { ...stableOptions, minSamples: 4 },
    },
    {
      name: "負のウォームアップ回数",
      options: { ...stableOptions, warmupIterations: -1 },
    },
    {
      name: "最小値より少ない最大サンプル数",
      options: { ...stableOptions, maxSamples: 1 },
    },
    {
      name: "範囲外の相対誤差",
      options: { ...stableOptions, maxRelativeMarginOfError: 0 },
    },
    {
      name: "0msのサンプル時間",
      options: { ...stableOptions, minSampleDurationMs: 0 },
    },
    {
      name: "0回の最大反復数",
      options: { ...stableOptions, maxIterationsPerSample: 0 },
    },
  ])("$nameを拒否する", ({ options }) => {
    expect(() => measureAdaptiveDuration(() => {}, options)).toThrow(RangeError);
  });
});

describe("measureAdaptivePairedDurations", () => {
  it("各サンプルの先行処理を交互にし、ペア比率を返す", () => {
    let elapsed = 0;
    const order: string[] = [];
    const result = measureAdaptivePairedDurations(
      () => {
        order.push("baseline");
        elapsed += 2;
      },
      () => {
        order.push("candidate");
        elapsed += 4;
      },
      {
        warmupIterations: 1,
        minSampleDurationMs: 1,
        minSamples: 3,
        maxSamples: 3,
        maxRelativeMarginOfError: 0.1,
        maxIterationsPerSample: 1,
      },
      () => elapsed,
    );

    expect(order.slice(-6)).toEqual([
      "baseline",
      "candidate",
      "candidate",
      "baseline",
      "baseline",
      "candidate",
    ]);
    expect(result.first.statistics.samples).toEqual([2, 2, 2]);
    expect(result.second.statistics.samples).toEqual([4, 4, 4]);
    expect(result.ratio.statistics.samples).toEqual([2, 2, 2]);
  });

  it("比率が収束しない場合はペアを追加する", () => {
    const firstDurations = [1, 1, 1, 1, 1, 1, 1];
    const secondDurations = [2, 1, 3, 1, 3, 1, 3];
    let firstCall = 0;
    let secondCall = 0;
    let elapsed = 0;
    const result = measureAdaptivePairedDurations(
      () => {
        elapsed += firstDurations[firstCall]!;
        firstCall += 1;
      },
      () => {
        elapsed += secondDurations[secondCall]!;
        secondCall += 1;
      },
      {
        warmupIterations: 0,
        minSampleDurationMs: 1,
        minSamples: 3,
        maxSamples: 5,
        maxRelativeMarginOfError: 0.01,
        maxIterationsPerSample: 1,
      },
      () => elapsed,
    );

    expect(result.ratio.statistics.samples).toHaveLength(5);
  });

  it("0以下の比率正規化係数を拒否する", () => {
    expect(() =>
      measureAdaptivePairedDurations(
        () => {},
        () => {},
        {
          warmupIterations: 0,
          minSampleDurationMs: 1,
          minSamples: 1,
          maxSamples: 1,
          maxRelativeMarginOfError: 0.1,
          maxIterationsPerSample: 1,
          ratioNormalizer: 0,
        },
      ),
    ).toThrow(RangeError);
  });

  it("既定の単調時計でペアを計測する", () => {
    expect(
      measureAdaptivePairedDurations(
        () => {},
        () => {},
        {
          warmupIterations: 0,
          minSampleDurationMs: 0.001,
          minSamples: 1,
          maxSamples: 1,
          maxRelativeMarginOfError: 0.1,
          maxIterationsPerSample: 1,
        },
      ).ratio.statistics.median,
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("measureAdaptiveAsyncDuration", () => {
  it("非同期処理を目標時間へ自動調整する", async () => {
    let elapsed = 0;
    let calls = 0;
    const result = await measureAdaptiveAsyncDuration(
      async () => {
        elapsed += 2;
        calls += 1;
      },
      {
        warmupIterations: 1,
        minSampleDurationMs: 10,
        minSamples: 3,
        maxSamples: 3,
        maxRelativeMarginOfError: 0.1,
        maxIterationsPerSample: 100,
      },
      () => elapsed,
    );

    expect(result.iterationsPerSample).toBe(5);
    expect(result.statistics.samples).toEqual([2, 2, 2]);
    expect(calls).toBe(17);
  });

  it("信頼区間が収束しない非同期処理を最大サンプル数まで測る", async () => {
    const durations = [1, 1, 10, 1, 10, 1];
    let elapsed = 0;
    let calls = 0;
    const result = await measureAdaptiveAsyncDuration(
      async () => {
        elapsed += durations[calls]!;
        calls += 1;
      },
      {
        warmupIterations: 0,
        minSampleDurationMs: 1,
        minSamples: 3,
        maxSamples: 5,
        maxRelativeMarginOfError: 0.1,
        maxIterationsPerSample: 1,
      },
      () => elapsed,
    );

    expect(result.statistics.samples).toHaveLength(5);
  });

  it("既定の単調時計で非同期処理を計測する", async () => {
    expect(
      (
        await measureAdaptiveAsyncDuration(async () => {}, {
          warmupIterations: 0,
          minSampleDurationMs: 0.001,
          minSamples: 1,
          maxSamples: 1,
          maxRelativeMarginOfError: 0.1,
          maxIterationsPerSample: 1,
        })
      ).statistics.median,
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("summarizeSamples", () => {
  it("生サンプル、中央値、MAD、p90、95%信頼区間、相対誤差を返す", () => {
    const statistics = summarizeSamples([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    expect(statistics.samples).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(statistics.median).toBe(5);
    expect(statistics.mad).toBe(2);
    expect(statistics.p90).toBe(9);
    expect(statistics.confidenceInterval.lower).toBeGreaterThanOrEqual(1);
    expect(statistics.confidenceInterval.upper).toBeLessThanOrEqual(9);
    expect(statistics.relativeMarginOfError).toBeGreaterThan(0);
  });

  it("空サンプルを拒否する", () => {
    expect(() => summarizeSamples([])).toThrow(RangeError);
  });

  it("中央値0の相対誤差を区間幅に応じて0または無限大にする", () => {
    expect(summarizeSamples([0]).relativeMarginOfError).toBe(0);
    expect(summarizeSamples([0, 0, 1]).relativeMarginOfError).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("summarizePairedRatios", () => {
  it("各roundの変更後とbaseの比率を要約する", () => {
    const statistics = summarizePairedRatios([10, 20, 40], [11, 18, 44]);

    expect(statistics.samples).toEqual([1.1, 0.9, 1.1]);
    expect(statistics.median).toBe(1.1);
  });

  it("ペア数の不一致と0以下のbaseを拒否する", () => {
    expect(() => summarizePairedRatios([1], [1, 2])).toThrow(RangeError);
    expect(() => summarizePairedRatios([0], [1])).toThrow(RangeError);
  });
});

describe("信頼区間の三状態判定", () => {
  it("上限判定をpass、regression、inconclusiveに分ける", () => {
    expect(classifyMaximum({ lower: 0.8, upper: 0.9 }, 1)).toBe("pass");
    expect(classifyMaximum({ lower: 1.1, upper: 1.2 }, 1)).toBe("regression");
    expect(classifyMaximum({ lower: 0.9, upper: 1.1 }, 1)).toBe("inconclusive");
  });

  it("下限判定をpass、regression、inconclusiveに分ける", () => {
    expect(classifyMinimum({ lower: 1.1, upper: 1.2 }, 1)).toBe("pass");
    expect(classifyMinimum({ lower: 0.8, upper: 0.9 }, 1)).toBe("regression");
    expect(classifyMinimum({ lower: 0.9, upper: 1.1 }, 1)).toBe("inconclusive");
  });
});
