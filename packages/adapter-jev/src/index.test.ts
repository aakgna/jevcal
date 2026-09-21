import { defineDecision } from "@jevcal/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JevAdapter } from "./index.js";

const evaluateMock = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ experimental_evaluate: evaluateMock }));

const decision = defineDecision({
  name: "loan-approval",
  confidence: "none", // Jev supplies native confidence; jevcal shouldn't also inject self-reported companion fields
  fields: z.object({
    approved: z.boolean().describe("Should this loan be approved?"),
    riskTier: z.enum(["low", "medium", "high"]).describe("Risk classification for this applicant"),
    severityScore: z.number().describe("How severe is the applicant's credit risk?"),
  }),
});

function mockFetchOnce(responseBody: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("JevAdapter — direct transport (api.typesafe.ai)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps fields to noul/choice/score, sends `model` in the body, and parses inline confidence", async () => {
    const fetchMock = mockFetchOnce({
      model: "jev-1.13.0",
      answers: {
        approved: { type: "noul", noul: 0.92 },
        riskTier: {
          type: "choice",
          choice: "low",
          confidence: 0.81,
          probabilities: { low: 0.81, medium: 0.15, high: 0.04 },
        },
        severityScore: {
          type: "score",
          score: 1.3,
          confidence: 0.54,
          probabilities: { "0": 0.0, "1": 0.7, "2": 0.3 },
          legend: { "0": "none", "1": "moderate", "2": "severe" },
        },
      },
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const adapter = new JevAdapter({
      apiKey: "test-key",
      scoreCriteria: { severityScore: ["none", "moderate", "severe"] },
    });

    const result = await adapter.decide(decision, { input: "Applicant has a thin credit file." });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((requestInit.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const requestBody = JSON.parse(requestInit.body as string);
    expect(requestBody.model).toBe("jev-latest");
    expect(requestBody.questions.approved.type).toBe("noul");
    expect(requestBody.questions.riskTier).toEqual({
      type: "choice",
      instructions: "Risk classification for this applicant",
      criteria: { low: "low", medium: "medium", high: "high" },
    });
    expect(requestBody.questions.severityScore.criteria).toEqual(["none", "moderate", "severe"]);

    expect(result.values.approved).toBe(true);
    expect(result.confidenceSignals.approved).toEqual({ kind: "native", probability: 0.92 });
    expect(result.values.riskTier).toBe("low");
    expect(result.confidenceSignals.riskTier).toEqual({
      kind: "native",
      probability: 0.81,
      distribution: { low: 0.81, medium: 0.15, high: 0.04 },
    });
    expect(result.model).toBe("jev-1.13.0");
  });

  it("defaults to direct transport when an apiKey is provided", async () => {
    const fetchMock = mockFetchOnce({ model: "jev-latest", answers: {} });
    const adapter = new JevAdapter({
      apiKey: "test-key",
      scoreCriteria: { severityScore: ["a", "b"] },
    });
    await adapter.decide(decision, { input: "state" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("throws a clear error when a number field is missing scoreCriteria", async () => {
    mockFetchOnce({ answers: {} });
    const adapter = new JevAdapter({ apiKey: "test-key" });
    await expect(adapter.decide(decision, { input: "state" })).rejects.toThrow(/scoreCriteria/);
  });

  it("throws a clear error when a field is missing .describe()", async () => {
    mockFetchOnce({ answers: {} });
    const undescribed = defineDecision({
      name: "undescribed",
      confidence: "none",
      fields: z.object({ ok: z.boolean() }),
    });
    const adapter = new JevAdapter({ apiKey: "test-key" });
    await expect(adapter.decide(undescribed, { input: "state" })).rejects.toThrow(/\.describe\(/);
  });
});

describe("JevAdapter — gateway transport (experimental_evaluate)", () => {
  beforeEach(() => {
    evaluateMock.mockReset();
  });

  it("defaults to gateway transport when no apiKey is provided, using boolean question type", async () => {
    evaluateMock.mockResolvedValue({
      answers: {
        approved: { type: "boolean", probability: 0.81 },
        riskTier: {
          type: "choice",
          choice: "low",
          probabilities: { low: 0.74, medium: 0.26, high: 0 },
        },
        severityScore: {
          type: "score",
          score: 0.37,
          probabilities: { "0": 0.63, "1": 0.37, "2": 0 },
        },
      },
      providerMetadata: { typesafe: { confidence: { riskTier: 0.61, severityScore: 0.45 } } },
      response: { modelId: "typesafe-ai/jev" },
    });

    const adapter = new JevAdapter({
      scoreCriteria: { severityScore: ["minimal", "moderate", "severe"] },
    });
    const result = await adapter.decide(decision, { input: "Applicant has a thin credit file." });

    expect(evaluateMock).toHaveBeenCalledTimes(1);
    const call = evaluateMock.mock.calls[0]?.[0];
    expect(call.model).toBe("typesafe-ai/jev");
    expect(call.questions.approved.type).toBe("boolean");

    expect(result.values.approved).toBe(true);
    expect(result.confidenceSignals.approved).toEqual({ kind: "native", probability: 0.81 });

    // choice/score confidence comes from providerMetadata.typesafe.confidence, not inline on the answer
    expect(result.confidenceSignals.riskTier).toEqual({
      kind: "native",
      probability: 0.61,
      distribution: { low: 0.74, medium: 0.26, high: 0 },
    });
    expect(result.values.severityScore).toBe(0.37);
    expect(result.model).toBe("typesafe-ai/jev");
  });

  it("falls back to the top distribution probability when providerMetadata.typesafe.confidence is absent", async () => {
    evaluateMock.mockResolvedValue({
      answers: {
        approved: { type: "boolean", probability: 0.6 },
        riskTier: {
          type: "choice",
          choice: "medium",
          probabilities: { low: 0.2, medium: 0.7, high: 0.1 },
        },
        severityScore: {
          type: "score",
          score: 1.0,
          probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 },
        },
      },
      providerMetadata: {},
      response: { modelId: "typesafe-ai/jev" },
    });

    const adapter = new JevAdapter({ scoreCriteria: { severityScore: ["a", "b", "c"] } });
    const result = await adapter.decide(decision, { input: "state" });

    expect(result.confidenceSignals.riskTier).toMatchObject({ kind: "native", probability: 0.7 });
  });
});
