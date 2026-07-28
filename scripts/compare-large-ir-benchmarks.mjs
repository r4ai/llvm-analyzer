import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  compareBenchmarkRounds,
  createAlternatingExecutionOrder,
  extractBenchmarkMetrics,
  formatComparisonMarkdown,
} from "./benchmark-comparison.mts";

const options = parseArguments(process.argv.slice(2));
const candidateDirectory = path.resolve(options.candidate);
const baselineDirectory = path.resolve(options.baseline);
const outputDirectory = path.resolve(options.output);

mkdirSync(outputDirectory, { recursive: true });
if (options.synchronizeHarness && baselineDirectory !== candidateDirectory) {
  synchronizeHarness(candidateDirectory, baselineDirectory);
}

const rounds = [];
for (const [roundIndex, order] of createAlternatingExecutionOrder(options.rounds).entries()) {
  const results = {};
  for (const target of order) {
    const directory = target === "baseline" ? baselineDirectory : candidateDirectory;
    const result = runBenchmark(directory);
    results[target] = extractBenchmarkMetrics(result.rows);
    writeFileSync(
      path.join(outputDirectory, `round-${roundIndex + 1}-${target}.jsonl`),
      result.jsonLines.join("\n") + "\n",
    );
  }
  rounds.push({ baseline: results.baseline, candidate: results.candidate });
}

const comparison = compareBenchmarkRounds(rounds);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baselineDirectory,
  candidateDirectory,
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    v8: process.versions.v8,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    cpuAffinity: process.env.LLVM_ANALYZER_BENCHMARK_CPU_AFFINITY ?? null,
  },
  comparison,
};
writeFileSync(
  path.join(outputDirectory, "comparison.json"),
  JSON.stringify(report, null, 2) + "\n",
);

const summary = formatComparisonMarkdown(comparison);
writeFileSync(path.join(outputDirectory, "summary.md"), summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
process.stdout.write(summary);
if (options.check && comparison.hasRegression) process.exitCode = 1;

function runBenchmark(directory) {
  const result = spawnSync(
    process.execPath,
    ["scripts/benchmark-large-ir.mjs", "--comparison-run"],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        LLVM_ANALYZER_BENCHMARK_MODE: "comparison",
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `ベンチマークを実行できませんでした: ${directory}\n${result.stderr || result.stdout}`,
    );
  }
  const jsonLines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  return {
    jsonLines,
    rows: jsonLines.map((line) => JSON.parse(line)),
  };
}

function synchronizeHarness(candidate, baseline) {
  for (const filename of ["benchmark-large-ir.mjs", "stable-benchmark.mts"]) {
    copyFileSync(
      path.join(candidate, "scripts", filename),
      path.join(baseline, "scripts", filename),
    );
  }
}

function parseArguments(arguments_) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") continue;
    if (argument === "--check" || argument === "--synchronize-harness") {
      flags.add(argument);
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new RangeError(`不明な引数です: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new RangeError(`${argument}の値を指定してください`);
    }
    values.set(argument, value);
    index += 1;
  }
  const roundCount = Number(values.get("--rounds") ?? 3);
  createAlternatingExecutionOrder(roundCount);
  return {
    baseline: values.get("--baseline") ?? ".",
    candidate: values.get("--candidate") ?? ".",
    output: values.get("--output") ?? "benchmark-results",
    rounds: roundCount,
    check: flags.has("--check"),
    synchronizeHarness: flags.has("--synchronize-harness"),
  };
}
