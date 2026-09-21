import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  DecisionInput,
  DecisionResult,
  DecisionStore,
  LoggedDecisionRecord,
  OutcomeLabel,
} from "../types.js";

// biome-ignore lint/suspicious/noExplicitAny: better-sqlite3's Database type, avoided as a hard import
type SqliteDatabase = any;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  requestId TEXT PRIMARY KEY,
  decisionName TEXT NOT NULL,
  schemaVersion TEXT NOT NULL,
  backendId TEXT NOT NULL,
  model TEXT,
  timestamp TEXT NOT NULL,
  input TEXT,
  fields TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outcomes (
  requestId TEXT NOT NULL,
  field TEXT NOT NULL,
  actualValue TEXT NOT NULL,
  observedAt TEXT NOT NULL,
  metadata TEXT,
  PRIMARY KEY (requestId, field)
);
`;

/**
 * Optional local store backed by better-sqlite3, useful once a JSONL file grows
 * past comfortable full-scan size. better-sqlite3 is an optional peer dependency,
 * dynamically imported here so JsonlStore users never pay for the native binary.
 */
export class SqliteStore implements DecisionStore {
  private db: Promise<SqliteDatabase>;

  constructor(private readonly filePath: string = ".jevcal/decisions.sqlite") {
    this.db = this.open();
  }

  private async open(): Promise<SqliteDatabase> {
    await mkdir(dirname(this.filePath), { recursive: true });
    let Database: new (path: string) => SqliteDatabase;
    try {
      ({ default: Database } = await import("better-sqlite3"));
    } catch {
      throw new Error(
        "SqliteStore requires the optional 'better-sqlite3' dependency. Install it with `pnpm add better-sqlite3`, or use JsonlStore instead.",
      );
    }
    const db = new Database(this.filePath);
    db.exec(SCHEMA);
    return db;
  }

  async logDecision(result: DecisionResult, input: DecisionInput): Promise<void> {
    const db = await this.db;
    db.prepare(
      `INSERT OR REPLACE INTO decisions (requestId, decisionName, schemaVersion, backendId, model, timestamp, input, fields)
       VALUES (@requestId, @decisionName, @schemaVersion, @backendId, @model, @timestamp, @input, @fields)`,
    ).run({
      requestId: result.requestId,
      decisionName: result.decisionName,
      schemaVersion: result.schemaVersion,
      backendId: result.backendId,
      model: result.model ?? null,
      timestamp: result.timestamp,
      input: JSON.stringify(input),
      fields: JSON.stringify(result.fields),
    });
  }

  async attachOutcome(requestId: string, outcome: OutcomeLabel): Promise<void> {
    const db = await this.db;
    db.prepare(
      `INSERT OR REPLACE INTO outcomes (requestId, field, actualValue, observedAt, metadata)
       VALUES (@requestId, @field, @actualValue, @observedAt, @metadata)`,
    ).run({
      requestId,
      field: outcome.field,
      actualValue: JSON.stringify(outcome.actualValue),
      observedAt: outcome.observedAt,
      metadata: outcome.metadata ? JSON.stringify(outcome.metadata) : null,
    });
  }

  async getRecords(query?: { decisionName?: string; since?: string }): Promise<
    LoggedDecisionRecord[]
  > {
    const db = await this.db;
    let sql = "SELECT * FROM decisions";
    const conditions: string[] = [];
    const params: Record<string, string> = {};
    if (query?.decisionName) {
      conditions.push("decisionName = @decisionName");
      params.decisionName = query.decisionName;
    }
    if (query?.since) {
      conditions.push("timestamp >= @since");
      params.since = query.since;
    }
    if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;

    // biome-ignore lint/suspicious/noExplicitAny: raw sqlite row shape
    const rows: any[] = db.prepare(sql).all(params);
    const outcomeStmt = db.prepare("SELECT * FROM outcomes WHERE requestId = ?");

    return rows.map((row) => {
      // biome-ignore lint/suspicious/noExplicitAny: raw sqlite row shape
      const outcomeRows: any[] = outcomeStmt.all(row.requestId);
      const outcomes: Record<string, OutcomeLabel> = {};
      for (const o of outcomeRows) {
        outcomes[o.field] = {
          field: o.field,
          actualValue: JSON.parse(o.actualValue),
          observedAt: o.observedAt,
          metadata: o.metadata ? JSON.parse(o.metadata) : undefined,
        };
      }
      return {
        requestId: row.requestId,
        decisionName: row.decisionName,
        schemaVersion: row.schemaVersion,
        backendId: row.backendId,
        model: row.model ?? undefined,
        timestamp: row.timestamp,
        input: row.input ? JSON.parse(row.input) : undefined,
        fields: JSON.parse(row.fields),
        outcomes,
      };
    });
  }
}
