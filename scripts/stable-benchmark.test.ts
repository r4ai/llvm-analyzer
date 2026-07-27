import { describe, expect, it } from "vitest";
import { measureMedianDuration, type StableBenchmarkOptions } from "./stable-benchmark.mts";

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
