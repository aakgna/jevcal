import { writeFile } from "node:fs/promises";
import { getCalibration, JsonlStore } from "@jevcal/core";
import { parseFlags } from "../flags.js";
import { renderReliabilityAscii } from "../render/ascii.js";
import { renderReliabilitySVG } from "../render/svg.js";

export async function reportCommand(args: string[]): Promise<void> {
  const [decisionName, field, ...rest] = args;
  if (!decisionName || !field) {
    console.error("Usage: jevcal report <decisionName> <field> [--store <path>] [--bins <n>] [--svg <outFile>]");
    process.exitCode = 1;
    return;
  }

  const opts = parseFlags(rest);
  const store = new JsonlStore(opts.store || undefined);
  const numBins = opts.bins ? Number(opts.bins) : undefined;

  const report = await getCalibration(store, { decisionName, field, numBins });

  console.log(
    renderReliabilityAscii(report.reliability, report.ece, report.brier, report.n, `${decisionName}.${field}`),
  );

  if (opts.svg) {
    await writeFile(opts.svg, renderReliabilitySVG(report.reliability), "utf8");
    console.log(`\nWrote reliability diagram to ${opts.svg}`);
  }
}
