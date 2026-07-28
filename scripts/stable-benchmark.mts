/** 短時間処理を安定して計測するための反復設定。 */
export interface StableBenchmarkOptions {
  /** 計測前に実行し、結果へ含めない回数。 */
  readonly warmupIterations: number;
  /** 一サンプル内で処理を繰り返す回数。 */
  readonly iterationsPerSample: number;
  /** 中央値を求めるための奇数個のサンプル数。 */
  readonly samples: number;
}

/** 自動バッチ計測の反復数と収束条件。 */
export interface AdaptiveBenchmarkOptions {
  /** 計測前に実行し、結果へ含めない回数。 */
  readonly warmupIterations: number;
  /** 一サンプルの計測時間として確保する下限。単位はms。 */
  readonly minSampleDurationMs: number;
  /** 最初に計測する奇数個のサンプル数。 */
  readonly minSamples: number;
  /** 収束しない場合に計測する奇数個のサンプル数の上限。 */
  readonly maxSamples: number;
  /** 追加計測を止める95%信頼区間の相対誤差上限。 */
  readonly maxRelativeMarginOfError: number;
  /** 一サンプル内の反復回数上限。 */
  readonly maxIterationsPerSample: number;
}

/** 代表値の95%信頼区間。 */
export interface ConfidenceInterval {
  /** 信頼区間の下端。 */
  readonly lower: number;
  /** 信頼区間の上端。 */
  readonly upper: number;
}

/** 生サンプルから求めたロバストな要約統計。 */
export interface BenchmarkStatistics {
  /** 計測順を保った丸め前のサンプル。 */
  readonly samples: readonly number[];
  /** サンプルの中央値。 */
  readonly median: number;
  /** 中央絶対偏差。 */
  readonly mad: number;
  /** nearest-rank法で求めた90パーセンタイル。 */
  readonly p90: number;
  /** 固定seedのbootstrapで求めた中央値の95%信頼区間。 */
  readonly confidenceInterval: ConfidenceInterval;
  /** 信頼区間の半幅を中央値で割った値。 */
  readonly relativeMarginOfError: number;
}

/** 自動バッチ計測の結果。 */
export interface AdaptiveBenchmarkResult {
  /** 一サンプル内で処理を繰り返した回数。 */
  readonly iterationsPerSample: number;
  /** 一回あたり実行時間の要約統計。単位はms。 */
  readonly statistics: BenchmarkStatistics;
}

/** ペア計測で比率から除く係数を含む設定。 */
export interface AdaptivePairedBenchmarkOptions extends AdaptiveBenchmarkOptions {
  /** 入力倍率など、第二処理と第一処理の比率から除く正の係数。 */
  readonly ratioNormalizer?: number;
}

/** 自動バッチで交互に計測した二処理と比率の結果。 */
export interface AdaptivePairedBenchmarkResult {
  /** 第一処理の計測結果。 */
  readonly first: AdaptiveBenchmarkResult;
  /** 第二処理の計測結果。 */
  readonly second: AdaptiveBenchmarkResult;
  /** `second / first / ratioNormalizer`の要約統計。 */
  readonly ratio: {
    readonly statistics: BenchmarkStatistics;
  };
}

/** 信頼区間と閾値の関係から得られる判定。 */
export type BenchmarkClassification = "pass" | "regression" | "inconclusive";

const BOOTSTRAP_RESAMPLES = 2_000;
const BOOTSTRAP_SEED = 0x6d_65_64_69;
const CONFIDENCE_LEVEL = 0.95;
const MIN_TIMER_RESOLUTION_MS = 0.001;

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

/**
 * 一サンプルが目標時間を満たすように反復数を調整し、収束するまで奇数個のサンプルを計測する。
 *
 * @remarks
 * 最初の一回で反復数を調整する。
 * 最小サンプル数の計測後、95%信頼区間の相対誤差が上限を超える場合は二サンプルずつ追加する。
 * 操作は同期的で、反復しても意味が変わらない処理に限る。
 *
 * @param operation 計測する同期処理。
 * @param options ウォームアップ、目標時間、収束条件。
 * @param now 単調増加する時刻をms単位で返す関数。
 * @returns 反復回数と丸め前サンプルの要約統計。
 * @throws 設定値が範囲外の場合は`RangeError`。
 */
export const measureAdaptiveDuration = (
  operation: () => void,
  options: AdaptiveBenchmarkOptions,
  now: () => number = () => performance.now(),
): AdaptiveBenchmarkResult => {
  validateAdaptiveOptions(options);
  repeat(operation, options.warmupIterations);
  const calibrationStart = now();
  operation();
  const calibrationDuration = Math.max(now() - calibrationStart, MIN_TIMER_RESOLUTION_MS);
  const iterationsPerSample = Math.min(
    options.maxIterationsPerSample,
    Math.max(1, Math.ceil(options.minSampleDurationMs / calibrationDuration)),
  );
  const samples: number[] = [];
  appendSamples(samples, options.minSamples, operation, iterationsPerSample, now);
  let statistics = summarizeSamples(samples);
  while (
    statistics.relativeMarginOfError > options.maxRelativeMarginOfError &&
    samples.length < options.maxSamples
  ) {
    appendSamples(samples, 2, operation, iterationsPerSample, now);
    statistics = summarizeSamples(samples);
  }
  return { iterationsPerSample, statistics };
};

/**
 * 非同期処理を一サンプルの目標時間へ調整し、収束するまで計測する。
 *
 * @remarks
 * 同期版と同じ収束条件を使い、各反復を直列に待機する。
 * 並列実行によるthroughputではなく、一要求の待ち時間を対象にする。
 *
 * @param operation 計測する非同期処理。
 * @param options ウォームアップ、目標時間、収束条件。
 * @param now 単調増加する時刻をms単位で返す関数。
 * @returns 反復回数と丸め前サンプルの要約統計。
 * @throws 設定値が範囲外の場合は`RangeError`。
 */
export const measureAdaptiveAsyncDuration = async (
  operation: () => Promise<void>,
  options: AdaptiveBenchmarkOptions,
  now: () => number = () => performance.now(),
): Promise<AdaptiveBenchmarkResult> => {
  validateAdaptiveOptions(options);
  for (let iteration = 0; iteration < options.warmupIterations; iteration += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 一要求の待ち時間を測るため直列に実行する。
    await operation();
  }
  const calibrationStart = now();
  await operation();
  const calibrationDuration = Math.max(now() - calibrationStart, MIN_TIMER_RESOLUTION_MS);
  const iterationsPerSample = Math.min(
    options.maxIterationsPerSample,
    Math.max(1, Math.ceil(options.minSampleDurationMs / calibrationDuration)),
  );
  const samples: number[] = [];
  await appendAsyncSamples(samples, options.minSamples, operation, iterationsPerSample, now);
  let statistics = summarizeSamples(samples);
  while (
    statistics.relativeMarginOfError > options.maxRelativeMarginOfError &&
    samples.length < options.maxSamples
  ) {
    // oxlint-disable-next-line no-await-in-loop -- 前サンプルの統計を確認してから追加計測する。
    await appendAsyncSamples(samples, 2, operation, iterationsPerSample, now);
    statistics = summarizeSamples(samples);
  }
  return { iterationsPerSample, statistics };
};

/**
 * 二処理を同じroundで交互に自動バッチ計測する。
 *
 * @remarks
 * ウォームアップと反復数調整の後、偶数roundでは第一処理、奇数roundでは第二処理を
 * 先に計測する。
 * 追加サンプルの要否はペア比率の相対誤差で判定する。
 *
 * @param first 第一処理。
 * @param second 第二処理。
 * @param options 自動バッチ条件と比率の正規化係数。
 * @param now 単調増加する時刻をms単位で返す関数。
 * @returns 二処理の要約統計とペア比率。
 * @throws 設定値が範囲外の場合は`RangeError`。
 */
export const measureAdaptivePairedDurations = (
  first: () => void,
  second: () => void,
  options: AdaptivePairedBenchmarkOptions,
  now: () => number = () => performance.now(),
): AdaptivePairedBenchmarkResult => {
  validateAdaptiveOptions(options);
  const ratioNormalizer = options.ratioNormalizer ?? 1;
  if (!Number.isFinite(ratioNormalizer) || ratioNormalizer <= 0) {
    throw new RangeError("ratioNormalizerは正の有限値で指定してください");
  }
  for (let iteration = 0; iteration < options.warmupIterations; iteration += 1) {
    first();
    second();
  }
  const firstIterations = calibrateIterations(first, options, now);
  const secondIterations = calibrateIterations(second, options, now);
  const firstSamples: number[] = [];
  const secondSamples: number[] = [];
  appendPairedSamples(
    firstSamples,
    secondSamples,
    options.minSamples,
    first,
    second,
    firstIterations,
    secondIterations,
    now,
  );
  let ratioStatistics = summarizePairedRatios(firstSamples, secondSamples, ratioNormalizer);
  while (
    ratioStatistics.relativeMarginOfError > options.maxRelativeMarginOfError &&
    firstSamples.length < options.maxSamples
  ) {
    appendPairedSamples(
      firstSamples,
      secondSamples,
      2,
      first,
      second,
      firstIterations,
      secondIterations,
      now,
    );
    ratioStatistics = summarizePairedRatios(firstSamples, secondSamples, ratioNormalizer);
  }
  return {
    first: {
      iterationsPerSample: firstIterations,
      statistics: summarizeSamples(firstSamples),
    },
    second: {
      iterationsPerSample: secondIterations,
      statistics: summarizeSamples(secondSamples),
    },
    ratio: { statistics: ratioStatistics },
  };
};

/**
 * 生サンプルから中央値、MAD、p90、中央値の95%信頼区間を求める。
 *
 * @remarks
 * bootstrapは固定seedを使うため、同じサンプルから常に同じ信頼区間を返す。
 * 入力順は成果物へ残し、統計量の計算だけで整列した複製を使う。
 *
 * @param samples 丸め前の有限な計測値。
 * @returns 生サンプルを含む要約統計。
 * @throws 空配列または有限でない値を含む場合は`RangeError`。
 */
export const summarizeSamples = (samples: readonly number[]): BenchmarkStatistics => {
  if (samples.length === 0 || samples.some((sample) => !Number.isFinite(sample))) {
    throw new RangeError("samplesは有限な値を一つ以上含む必要があります");
  }
  const sorted = samples.toSorted((left, right) => left - right);
  const sampleMedian = median(sorted);
  const mad = median(
    sorted.map((sample) => Math.abs(sample - sampleMedian)).toSorted((left, right) => left - right),
  );
  const confidenceInterval = bootstrapMedianConfidenceInterval(samples);
  return {
    samples: [...samples],
    median: sampleMedian,
    mad,
    p90: sorted[Math.ceil(sorted.length * 0.9) - 1]!,
    confidenceInterval,
    relativeMarginOfError: relativeMarginOfError(sampleMedian, confidenceInterval),
  };
};

/**
 * 同じroundで計測したbaseと変更後の比率を要約する。
 *
 * @param baselineSamples 各roundのbase計測値。
 * @param candidateSamples 各roundの変更後計測値。
 * @param normalizer 入力倍率など、比率から除く正の係数。
 * @returns `candidate / baseline / normalizer`の要約統計。
 * @throws ペア数が異なる場合、空配列、0以下のbaseまたはnormalizerを拒否する。
 */
export const summarizePairedRatios = (
  baselineSamples: readonly number[],
  candidateSamples: readonly number[],
  normalizer = 1,
): BenchmarkStatistics => {
  if (
    baselineSamples.length === 0 ||
    baselineSamples.length !== candidateSamples.length ||
    baselineSamples.some((sample) => sample <= 0) ||
    !Number.isFinite(normalizer) ||
    normalizer <= 0
  ) {
    throw new RangeError("同数のペア、正のbase、正のnormalizerを指定してください");
  }
  return summarizeSamples(
    baselineSamples.map((baseline, index) => candidateSamples[index]! / baseline / normalizer),
  );
};

/**
 * 上限付き契約を信頼区間から判定する。
 *
 * @param interval 計測値の信頼区間。
 * @param maximum 許容する上限。
 * @returns 区間全体が上限以下なら`pass`、上限超過なら`regression`、またぐ場合は`inconclusive`。
 */
export const classifyMaximum = (
  interval: ConfidenceInterval,
  maximum: number,
): BenchmarkClassification => {
  if (interval.upper <= maximum) return "pass";
  if (interval.lower > maximum) return "regression";
  return "inconclusive";
};

/**
 * 下限付き契約を信頼区間から判定する。
 *
 * @param interval 計測値の信頼区間。
 * @param minimum 許容する下限。
 * @returns 区間全体が下限以上なら`pass`、下限未満なら`regression`、またぐ場合は`inconclusive`。
 */
export const classifyMinimum = (
  interval: ConfidenceInterval,
  minimum: number,
): BenchmarkClassification => {
  if (interval.lower >= minimum) return "pass";
  if (interval.upper < minimum) return "regression";
  return "inconclusive";
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

const validateAdaptiveOptions = (options: AdaptiveBenchmarkOptions): void => {
  if (!Number.isInteger(options.warmupIterations) || options.warmupIterations < 0) {
    throw new RangeError("warmupIterationsは0以上の整数で指定してください");
  }
  if (!Number.isFinite(options.minSampleDurationMs) || options.minSampleDurationMs <= 0) {
    throw new RangeError("minSampleDurationMsは正の有限値で指定してください");
  }
  if (!isPositiveOddInteger(options.minSamples)) {
    throw new RangeError("minSamplesは正の奇数で指定してください");
  }
  if (!isPositiveOddInteger(options.maxSamples) || options.maxSamples < options.minSamples) {
    throw new RangeError("maxSamplesはminSamples以上の正の奇数で指定してください");
  }
  if (
    !Number.isFinite(options.maxRelativeMarginOfError) ||
    options.maxRelativeMarginOfError <= 0 ||
    options.maxRelativeMarginOfError >= 1
  ) {
    throw new RangeError("maxRelativeMarginOfErrorは0より大きく1未満で指定してください");
  }
  if (!Number.isInteger(options.maxIterationsPerSample) || options.maxIterationsPerSample < 1) {
    throw new RangeError("maxIterationsPerSampleは1以上の整数で指定してください");
  }
};

const isPositiveOddInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value % 2 === 1;

const appendSamples = (
  samples: number[],
  count: number,
  operation: () => void,
  iterationsPerSample: number,
  now: () => number,
): void => {
  for (let sample = 0; sample < count; sample += 1) {
    samples.push(measureBatch(operation, iterationsPerSample, now));
  }
};

const appendAsyncSamples = async (
  samples: number[],
  count: number,
  operation: () => Promise<void>,
  iterationsPerSample: number,
  now: () => number,
): Promise<void> => {
  for (let sample = 0; sample < count; sample += 1) {
    // oxlint-disable-next-line no-await-in-loop -- サンプル間の重なりを避けて待ち時間を測る。
    samples.push(await measureAsyncBatch(operation, iterationsPerSample, now));
  }
};

const calibrateIterations = (
  operation: () => void,
  options: AdaptiveBenchmarkOptions,
  now: () => number,
): number => {
  const start = now();
  operation();
  const duration = Math.max(now() - start, MIN_TIMER_RESOLUTION_MS);
  return Math.min(
    options.maxIterationsPerSample,
    Math.max(1, Math.ceil(options.minSampleDurationMs / duration)),
  );
};

const appendPairedSamples = (
  firstSamples: number[],
  secondSamples: number[],
  count: number,
  first: () => void,
  second: () => void,
  firstIterations: number,
  secondIterations: number,
  now: () => number,
): void => {
  const startIndex = firstSamples.length;
  for (let offset = 0; offset < count; offset += 1) {
    if ((startIndex + offset) % 2 === 0) {
      firstSamples.push(measureBatch(first, firstIterations, now));
      secondSamples.push(measureBatch(second, secondIterations, now));
    } else {
      const secondDuration = measureBatch(second, secondIterations, now);
      const firstDuration = measureBatch(first, firstIterations, now);
      firstSamples.push(firstDuration);
      secondSamples.push(secondDuration);
    }
  }
};

const measureBatch = (operation: () => void, iterations: number, now: () => number): number => {
  const start = now();
  repeat(operation, iterations);
  return (now() - start) / iterations;
};

const measureAsyncBatch = async (
  operation: () => Promise<void>,
  iterations: number,
  now: () => number,
): Promise<number> => {
  const start = now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    // oxlint-disable-next-line no-await-in-loop -- throughputではなく一要求ずつの待ち時間を測る。
    await operation();
  }
  return (now() - start) / iterations;
};

const repeat = (operation: () => void, iterations: number): void => {
  for (let iteration = 0; iteration < iterations; iteration += 1) operation();
};

const median = (sortedValues: readonly number[]): number =>
  sortedValues[Math.floor(sortedValues.length / 2)]!;

const bootstrapMedianConfidenceInterval = (samples: readonly number[]): ConfidenceInterval => {
  if (samples.length === 1) {
    return { lower: samples[0]!, upper: samples[0]! };
  }
  const medians: number[] = [];
  let randomState = BOOTSTRAP_SEED;
  for (let resample = 0; resample < BOOTSTRAP_RESAMPLES; resample += 1) {
    const values = Array.from({ length: samples.length }, () => {
      randomState = nextRandomState(randomState);
      return samples[randomState % samples.length]!;
    });
    medians.push(median(values.toSorted((left, right) => left - right)));
  }
  medians.sort((left, right) => left - right);
  const tailProbability = (1 - CONFIDENCE_LEVEL) / 2;
  return {
    lower: medians[Math.floor(tailProbability * (medians.length - 1))]!,
    upper: medians[Math.ceil((1 - tailProbability) * (medians.length - 1))]!,
  };
};

const nextRandomState = (state: number): number =>
  (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

const relativeMarginOfError = (sampleMedian: number, interval: ConfidenceInterval): number => {
  const halfWidth = (interval.upper - interval.lower) / 2;
  if (sampleMedian === 0) return halfWidth === 0 ? 0 : Number.POSITIVE_INFINITY;
  return halfWidth / Math.abs(sampleMedian);
};
