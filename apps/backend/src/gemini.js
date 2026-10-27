// Gemini REST call with structured JSON output. Only the trimmed label/level JSON is sent.
const SYSTEM_INSTRUCTION = `You are an analyst preparing a report from an acoustic monitoring test.
You receive detected sound periods with scores from two models (yamnet, clap),
level data, user notes, and a label catalogue with priorities by time of day.
Rules:
1. Use only the data provided. Never invent events, times, labels or numbers.
2. Every event you output must reference one or more existing period_id values.
3. final_label must come from the label catalogue (or "unexplained_impact").
4. confidence is a number from 0 to 1 based only on the evidence: model scores,
   agreement between models, period length, and any user note at that time.
5. You may merge adjacent periods only if they are clearly one sound; list the merged ids.
6. You may raise a priority above the catalogue default and must give a short reason.
   You may never lower it.
7. If the user notes name what was played or done at that time, record whether the
   models agreed with it in "matches_note" (true, false or null). Do not let the note
   change the label.
8. Report disagreements between models and data-quality problems honestly.
9. Write short, plain sentences. No marketing language.
Return only JSON matching the response schema.`;

const str = { type: 'STRING' };
const strArr = { type: 'ARRAY', items: str };

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: {
      type: 'OBJECT',
      properties: {
        headline: str,
        counts_by_priority: {
          type: 'OBJECT',
          properties: { alert: { type: 'INTEGER' }, flag: { type: 'INTEGER' }, log: { type: 'INTEGER' } }
        },
        quiet_hours_summary: str,
        overall_notes: strArr
      },
      required: ['headline', 'quiet_hours_summary']
    },
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          period_ids: strArr,
          final_label: str,
          family: str,
          priority: { type: 'STRING', enum: ['log', 'flag', 'alert'] },
          priority_raised: { type: 'BOOLEAN' },
          priority_reason: { type: 'STRING', nullable: true },
          confidence: { type: 'NUMBER' },
          agreement: { type: 'STRING', enum: ['agree', 'partial', 'disagree', 'none'] },
          matches_note: { type: 'BOOLEAN', nullable: true },
          explanation: str,
          flags: strArr
        },
        required: ['period_ids', 'final_label', 'family', 'priority', 'confidence', 'agreement', 'explanation']
      }
    },
    merges: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { period_ids: strArr, reason: str }, required: ['period_ids', 'reason'] }
    },
    data_quality: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { period_ids: strArr, issue: str }, required: ['period_ids', 'issue'] }
    }
  },
  required: ['summary', 'events', 'merges', 'data_quality']
};

const TIMEOUT_MS = 60_000;

class GeminiError extends Error {
  constructor(publicMessage, status) {
    super(publicMessage);
    this.publicMessage = publicMessage;
    this.status = status;
  }
}

async function once(request, { apiKey, model, thinkingLevel }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(request) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel }
    }
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (err) {
    throw new GeminiError(err.name === 'AbortError' ? 'Gemini timed out' : 'Could not reach Gemini', 0);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new GeminiError(`Gemini returned HTTP ${res.status}`, res.status);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text) throw new GeminiError('Gemini returned no content', 200);
  let output;
  try {
    output = JSON.parse(text);
  } catch {
    throw new GeminiError('Gemini returned invalid JSON', 200);
  }
  const u = data.usageMetadata || {};
  return {
    output,
    model: data.modelVersion || model,
    usage: {
      prompt_tokens: u.promptTokenCount ?? null,
      output_tokens: u.candidatesTokenCount ?? null,
      thinking_tokens: u.thoughtsTokenCount ?? null,
      total_tokens: u.totalTokenCount ?? null
    }
  };
}

// One retry on 429 or 5xx.
export async function callGemini(request, opts) {
  try {
    return await once(request, opts);
  } catch (err) {
    const retryable = err.status === 429 || err.status >= 500;
    if (!retryable) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return once(request, opts);
  }
}
