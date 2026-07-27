import { analyze, collectFileReferenceCandidates } from "../packages/analyzer/src/index.ts";
import { parseModule } from "../packages/parser/src/index.ts";

const SIZE_FACTOR = 4;
const MAX_NORMALIZED_GROWTH = 2;
const SAMPLES = 3;

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
