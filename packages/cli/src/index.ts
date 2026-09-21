#!/usr/bin/env node
import { outcomeCommand } from "./commands/outcome.js";
import { reportCommand } from "./commands/report.js";

const HELP = `jevcal — calibration CLI

Commands:
  jevcal report <decisionName> <field> [--store <path>] [--bins <n>] [--svg <outFile>]
  jevcal outcome <requestId> <field> <actualValue> [--store <path>]`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "report":
      await reportCommand(rest);
      break;
    case "outcome":
      await outcomeCommand(rest);
      break;
    default:
      console.log(HELP);
      if (command) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
