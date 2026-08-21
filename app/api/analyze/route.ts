import { CONTRACT_CLAUSE_EXPLANATION_PROMPT } from "../../ai-prompts";

const explanationSchema = {
  type: "object", additionalProperties: false,
  required: ["explanations", "glossary"],
  properties: {
    explanations: { type: "array", minItems: 1, maxItems: 10, items: {
      type: "object", additionalProperties: false,
      required: ["clauseId", "title", "core", "easyExplanation", "impact", "checkPoint", "action"],
      properties: {
        clauseId: { type: "string" }, title: { type: "string" }, core: { type: "string" },
        easyExplanation: { type: "string" }, impact: { type: "string" }, checkPoint: { type: "string" }, action: { type: "string" },
      },
    } },
    glossary: { type: "array", maxItems: 20, items: {
      type: "object", additionalProperties: false, required: ["term", "definition"],
      properties: { term: { type: "string" }, definition: { type: "string" } },
    } },
  },
} as const;

type InputClause = { id: string; page: number; marker: string; text: string };
function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }
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
        input: JSON.stringify(clauses),
        text: { format: { type: "json_schema", name: "fixed_clause_explanations", strict: true, schema: explanationSchema } },
      }),
    });
    if (!response.ok) {
      const detail = await response.text(); console.error("OpenAI clause explanation error", response.status, detail.slice(0, 500));
      return jsonError(response.status === 429 ? "분석 요청이 많습니다. 잠시 후 다시 시도해 주세요." : "계약서 조항을 설명하지 못했습니다.", response.status === 429 ? 429 : 502);
    }
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = getOutputText(payload);
    if (!text) return jsonError("조항 설명을 읽지 못했습니다.", 502);
    const result = JSON.parse(text) as { explanations: Array<{ clauseId: string }>; glossary: unknown[] };
    const expected = new Set(clauses.map((clause) => clause.id));
    const returned = new Set(result.explanations.map((item) => item.clauseId));
    if (returned.size !== expected.size || [...expected].some((id) => !returned.has(id))) return jsonError("일부 조항 설명이 누락됐습니다.", 502);
    return Response.json(result);
  } catch (reason) {
    console.error("Clause explanation failed", reason);
    return jsonError("계약서 조항을 설명하지 못했습니다.", 502);
  }
}
