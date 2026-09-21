export interface TokenLogprob {
  token: string;
  logprob: number;
}

/**
 * Best-effort mapping from OpenAI-style per-token logprobs to a per-field average
 * logprob, by locating each field's serialized value substring in the raw JSON
 * response text and averaging the logprobs of tokens whose text overlaps that span.
 * This is a heuristic, not a JSON parser — token boundaries rarely align perfectly
 * with field boundaries, which is exactly why "self-reported" confidence is the
 * default strategy and this "logprob" path is opt-in.
 */
export function extractFieldLogprobs(
  rawText: string,
  tokens: TokenLogprob[],
  fieldNames: string[],
): Record<string, { avgLogprob: number; tokenCount: number }> {
  const offsets: { start: number; end: number; logprob: number }[] = [];
  let cursor = 0;
  for (const t of tokens) {
    const idx = rawText.indexOf(t.token, cursor);
    const start = idx >= 0 ? idx : cursor;
    const end = start + t.token.length;
    offsets.push({ start, end, logprob: t.logprob });
    cursor = end;
  }

  const result: Record<string, { avgLogprob: number; tokenCount: number }> = {};
  for (const field of fieldNames) {
    const keyIdx = rawText.indexOf(`"${field}":`);
    if (keyIdx === -1) continue;
    const valueStart = keyIdx + field.length + 3; // `"field":`
    const nextComma = rawText.indexOf(",", valueStart);
    const nextBrace = rawText.indexOf("}", valueStart);
    const candidates = [nextComma, nextBrace].filter((i) => i !== -1);
    const valueEnd = candidates.length > 0 ? Math.min(...candidates) : rawText.length;

    const overlapping = offsets.filter((o) => o.end > valueStart && o.start < valueEnd);
    if (overlapping.length === 0) continue;
    const avgLogprob = overlapping.reduce((sum, o) => sum + o.logprob, 0) / overlapping.length;
    result[field] = { avgLogprob, tokenCount: overlapping.length };
  }
  return result;
}
