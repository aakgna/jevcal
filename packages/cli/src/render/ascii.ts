import type { ReliabilityBin } from "@jevcal/core";

const BAR_WIDTH = 32;

export function renderReliabilityAscii(
  bins: ReliabilityBin[],
  ece: number,
  brier: number,
  n: number,
  title: string,
): string {
  const lines: string[] = [`Reliability diagram: ${title}  (n=${n})`];

  for (const bin of bins) {
    if (bin.sampleCount === 0) continue;
    const barLen = Math.round(bin.observedFrequency * BAR_WIDTH);
    const bar = "#".repeat(barLen).padEnd(BAR_WIDTH, " ");
    const range = `${bin.binStart.toFixed(1)}-${bin.binEnd.toFixed(1)}`;
    lines.push(
      `${range.padEnd(9)}| ${bar}  observed ${bin.observedFrequency.toFixed(2)}  predicted ${bin.avgPredictedProbability.toFixed(2)}  (n=${bin.sampleCount})`,
    );
  }

  if (lines.length === 1) lines.push("(no samples with both a prediction and an outcome yet)");
  lines.push(`ECE: ${ece.toFixed(3)}   Brier: ${brier.toFixed(3)}`);
  return lines.join("\n");
}
