import type { ReliabilityBin } from "@jevcal/core";

/** Hand-written SVG reliability diagram — zero charting dependency by design. */
export function renderReliabilitySVG(bins: ReliabilityBin[], width = 420, height = 420): string {
  const padding = 36;
  const plotSize = width - padding * 2;
  const toX = (v: number) => padding + v * plotSize;
  const toY = (v: number) => height - padding - v * plotSize;

  const bars = bins
    .filter((bin) => bin.sampleCount > 0)
    .map((bin) => {
      const x = toX(bin.binStart);
      const barWidth = Math.max(toX(bin.binEnd) - toX(bin.binStart) - 1, 1);
      const y = toY(bin.observedFrequency);
      const barHeight = height - padding - y;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="#4f7cff" fill-opacity="0.75" />`;
    })
    .join("\n  ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <rect width="${width}" height="${height}" fill="white" />`,
    `  <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#333" />`,
    `  <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#333" />`,
    `  <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${padding}" stroke="#999" stroke-dasharray="4,4" />`,
    `  ${bars}`,
    `  <text x="${width / 2}" y="${height - 8}" font-size="11" text-anchor="middle" fill="#333">Predicted probability</text>`,
    `  <text x="14" y="${height / 2}" font-size="11" text-anchor="middle" fill="#333" transform="rotate(-90 14 ${height / 2})">Observed frequency</text>`,
    "</svg>",
  ].join("\n");
}
