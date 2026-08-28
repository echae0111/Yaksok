import { CONTRACT_CLAUSE_EXPLANATION_PROMPT } from "../../ai-prompts";

const explanationSchema = (clauseCount: number) => ({
  type: "object", additionalProperties: false,
  required: ["explanations", "glossary"],
  properties: {
    explanations: { type: "array", minItems: clauseCount, maxItems: clauseCount, items: {
      type: "object", additionalProperties: false,
      required: ["title", "core", "easyExplanation", "impact", "checkPoint", "action"],
      properties: {
        title: { type: "string" }, core: { type: "string" },
        easyExplanation: { type: "string" }, impact: { type: "string" }, checkPoint: { type: "string" }, action: { type: "string" },
      },
    } },
    glossary: { type: "array", maxItems: 20, items: {
      type: "object", additionalProperties: false, required: ["term", "definition"],
      properties: { term: { type: "string" }, definition: { type: "string" } },
    } },
  },
} as const);

type InputClause = { id: string; page: number; marker: string; text: string };
function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }
function parseResetSeconds(value: string | null) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, Math.ceil(numeric));
  const match = value.match(/(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/);
  return match ? Number(match[1] ?? 0) * 60 + Math.ceil(Number(match[2] ?? 0)) : 0;
}
function getOutputText(payload: { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonError("AI 분석 서비스 설정이 아직 완료되지 않았습니다.", 503);
  try {
    const body = await request.json() as { clauses?: InputClause[] };
    const clauses = body.clauses;
    if (!Array.isArray(clauses) || !clauses.length || clauses.length > 10) return jsonError("설명할 조항 묶음이 올바르지 않습니다.", 400);
    if (clauses.some((clause) => !clause.id || !clause.text || clause.text.length > 12000)) return jsonError("조항 원문이 올바르지 않습니다.", 400);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4-2026-03-05", store: false,
        instructions: CONTRACT_CLAUSE_EXPLANATION_PROMPT,
        input: JSON.stringify(clauses.map(({ page, marker, text }) => ({ page, marker, text }))),
        text: { format: { type: "json_schema", name: "fixed_clause_explanations", strict: true, schema: explanationSchema(clauses.length) } },
      }),
    });
    if (!response.ok) {
      const detail = await response.text(); console.error("OpenAI clause explanation error", response.status, detail.slice(0, 500));
      if (response.status === 429) {
        let errorCode = "rate_limited";
        try {
          const parsed = JSON.parse(detail) as { error?: { code?: string; type?: string } };
          if (parsed.error?.code === "insufficient_quota" || parsed.error?.type === "insufficient_quota") errorCode = "quota_exhausted";
        } catch { /* 원문은 서버 로그에만 남깁니다. */ }
        const retryAfterSeconds = Math.max(
          parseResetSeconds(response.headers.get("retry-after")),
          parseResetSeconds(response.headers.get("x-ratelimit-reset-requests")),
          parseResetSeconds(response.headers.get("x-ratelimit-reset-tokens")),
        );
        return Response.json({
          error: errorCode === "quota_exhausted" ? "AI API 사용 한도가 소진됐습니다. 결제 및 사용량 설정을 확인해 주세요." : "분석 요청이 잠시 제한됐습니다. 자동으로 기다린 뒤 다시 이어갈게요.",
          errorCode,
          retryAfterSeconds,
        }, { status: 429, headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined });
      }
      return jsonError("계약서 조항을 설명하지 못했습니다.", 502);
    }
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = getOutputText(payload);
    if (!text) return jsonError("조항 설명을 읽지 못했습니다.", 502);
    const result = JSON.parse(text) as { explanations: Array<Record<string, string>>; glossary: unknown[] };
    if (result.explanations.length !== clauses.length) return jsonError("일부 조항 설명이 누락됐습니다.", 502);
    return Response.json({
      explanations: result.explanations.map((explanation, index) => ({ ...explanation, clauseId: clauses[index].id })),
      glossary: result.glossary,
    });
  } catch (reason) {
    console.error("Clause explanation failed", reason);
    return jsonError("계약서 조항을 설명하지 못했습니다.", 502);
  }
}
