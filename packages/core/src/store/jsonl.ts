import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  DecisionInput,
  DecisionResult,
  DecisionStore,
  LoggedDecisionRecord,
  OutcomeLabel,
} from "../types.js";

type DecisionLine = {
  kind: "decision";
  result: DecisionResult;
  input: DecisionInput;
};

type OutcomeLine = {
  kind: "outcome";
  requestId: string;
  outcome: OutcomeLabel;
};

type JsonlLine = DecisionLine | OutcomeLine;

/**
 * Zero-dependency append-only JSONL store. Decisions and outcomes are written
 * as separate lines and joined by requestId only at read time in getRecords()
 * — this avoids read-modify-write races when outcomes arrive concurrently
 * (e.g. from a batch labeling job) while the file stays trivially `jq`-able.
 */
export class JsonlStore implements DecisionStore {
  constructor(private readonly filePath: string = ".jevcal/decisions.jsonl") {}

  async logDecision(result: DecisionResult, input: DecisionInput): Promise<void> {
    await this.appendLine({ kind: "decision", result, input });
  }

  async attachOutcome(requestId: string, outcome: OutcomeLabel): Promise<void> {
    await this.appendLine({ kind: "outcome", requestId, outcome });
  }

  async getRecords(query?: { decisionName?: string; since?: string }): Promise<
    LoggedDecisionRecord[]
  > {
    const lines = await this.readLines();
    const records = new Map<string, LoggedDecisionRecord>();

    for (const line of lines) {
      if (line.kind === "decision") {
        const { result, input } = line;
        records.set(result.requestId, {
          requestId: result.requestId,
          decisionName: result.decisionName,
          schemaVersion: result.schemaVersion,
          backendId: result.backendId,
          model: result.model,
          timestamp: result.timestamp,
          input,
          fields: result.fields as LoggedDecisionRecord["fields"],
          outcomes: records.get(result.requestId)?.outcomes ?? {},
        });
      } else {
        const existing = records.get(line.requestId);
        if (existing) {
          existing.outcomes[line.outcome.field] = line.outcome;
        } else {
          // Outcome arrived before (or without) its decision line — keep it under a
          // placeholder so attachOutcome() never silently drops data out of order.
          records.set(line.requestId, {
            requestId: line.requestId,
            decisionName: "",
            schemaVersion: "",
            backendId: "",
            timestamp: "",
            fields: {},
            outcomes: { [line.outcome.field]: line.outcome },
          });
        }
      }
    }

    let results = Array.from(records.values());
    if (query?.decisionName) {
      results = results.filter((r) => r.decisionName === query.decisionName);
    }
    if (query?.since) {
      const since = query.since;
      results = results.filter((r) => r.timestamp >= since);
    }
    return results;
  }

  private async appendLine(line: JsonlLine): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(line)}\n`, "utf8");
  }

  private async readLines(): Promise<JsonlLine[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as JsonlLine);
  }
}
