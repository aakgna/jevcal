import { JsonlStore } from "@jevcal/core";
import { parseFlags } from "../flags.js";

function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

export async function outcomeCommand(args: string[]): Promise<void> {
  const [requestId, field, actualValueRaw, ...rest] = args;
  if (!requestId || !field || actualValueRaw === undefined) {
    console.error("Usage: jevcal outcome <requestId> <field> <actualValue> [--store <path>]");
    process.exitCode = 1;
    return;
  }

  const opts = parseFlags(rest);
  const store = new JsonlStore(opts.store || undefined);
  const actualValue = parseValue(actualValueRaw);

  await store.attachOutcome(requestId, { field, actualValue, observedAt: new Date().toISOString() });
  console.log(`Attached outcome: ${field} = ${JSON.stringify(actualValue)} for request ${requestId}`);
}
