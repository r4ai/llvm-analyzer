/** 短時間処理を安定して計測するための反復設定。 */
export interface StableBenchmarkOptions {
  /** 計測前に実行し、結果へ含めない回数。 */
  readonly warmupIterations: number;
  /** 一サンプル内で処理を繰り返す回数。 */
  readonly iterationsPerSample: number;
  /** 中央値を求めるための奇数個のサンプル数。 */
  readonly samples: number;
}

/**
 * 短時間処理を反復し、一回あたり実行時間の中央値を返す。
 *
 * @remarks
 * ウォームアップはJITの初期コストを計測対象から除く。
 * 各サンプルをバッチ化して一時停止の影響を薄め、奇数個の中央値で単発の外れ値を除く。
 *
 * @param operation 計測する同期処理。
 * @param options ウォームアップ、バッチ、サンプルの反復設定。
 * @param now 単調増加する時刻をms単位で返す関数。テスト以外では既定値を使う。
 * @returns ウォームアップ後の一回あたり実行時間の中央値。単位はms。
 * @throws `options`に負数、0回のバッチ、偶数のサンプル数が含まれる場合は`RangeError`。
 */
export const measureMedianDuration = (
  operation: () => void,
  options: StableBenchmarkOptions,
  now: () => number = () => performance.now(),
): number => {
  validateOptions(options);
  repeat(operation, options.warmupIterations);
  const durations = Array.from({ length: options.samples }, () =>
    measureBatch(operation, options.iterationsPerSample, now),
  );
  return durations.toSorted((left, right) => left - right)[Math.floor(durations.length / 2)]!;
};

const validateOptions = (options: StableBenchmarkOptions): void => {
  if (!Number.isInteger(options.warmupIterations) || options.warmupIterations < 0) {
    throw new RangeError("warmupIterationsは0以上の整数で指定してください");
  }
  if (!Number.isInteger(options.iterationsPerSample) || options.iterationsPerSample < 1) {
    throw new RangeError("iterationsPerSampleは1以上の整数で指定してください");
  }
  if (!Number.isInteger(options.samples) || options.samples < 1 || options.samples % 2 === 0) {
    throw new RangeError("samplesは1以上の奇数で指定してください");
  }
};

const measureBatch = (operation: () => void, iterations: number, now: () => number): number => {
  const start = now();
  repeat(operation, iterations);
  return (now() - start) / iterations;
};

const repeat = (operation: () => void, iterations: number): void => {
  for (let iteration = 0; iteration < iterations; iteration += 1) operation();
};
