const mergeSchema = {
  type: "object", additionalProperties: false,
  required: ["documentType", "summary", "duplicateGroups"],
  properties: {
    documentType: { type: "string" }, summary: { type: "string" },
    duplicateGroups: { type: "array", maxItems: 120, items: {
      type: "array", minItems: 2, maxItems: 12, items: { type: "integer" },
    } },
  },
} as const;

type Item = { level: "danger" | "caution" | "important" | "general"; title: string; core: string; easyExplanation: string; impact: string; checkPoint: string; action: string; original: string; page: number | null };
type GlossaryTerm = { term: string; definition: string };
type ChunkResult = { items: Item[]; glossary: GlossaryTerm[] };

function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }
function getOutputText(payload: { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
}
function removeExactDuplicates(items: Item[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title} ${item.original}`.replace(/[\s\p{P}]/gu, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonError("AI 분석 서비스 설정이 아직 완료되지 않았습니다.", 503);
  try {
    const body = await request.json() as { results?: ChunkResult[] };
    if (!Array.isArray(body.results) || !body.results.length) return jsonError("통합할 분석 결과가 없습니다.", 400);
    let items = removeExactDuplicates(body.results.flatMap((result) => result.items ?? []));
    const compactItems = items.map((item, index) => ({ index, title: item.title, original: item.original, page: item.page, level: item.level }));
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4", store: false,
        instructions: "여러 구간에서 추출한 금융 계약서 조항 목록을 최종 정리하세요. 제공된 내용만 사용하세요. 같은 계약 조건을 표현만 달리해 반복한 항목은 duplicateGroups에 해당 index들을 묶으세요. 서로 다른 조건은 합치지 마세요. documentType과 summary는 전체 목록을 바탕으로 짧고 쉬운 한국어로 작성하세요.",
        input: JSON.stringify(compactItems),
        text: { format: { type: "json_schema", name: "contract_analysis_merge", strict: true, schema: mergeSchema } },
      }),
    });
    if (!response.ok) {
      const detail = await response.text(); console.error("OpenAI merge error", response.status, detail.slice(0, 500));
      return jsonError("분석 결과를 정리하지 못했습니다.", 502);
    }
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = getOutputText(payload);
    if (!text) return jsonError("최종 분석 결과를 읽지 못했습니다.", 502);
    const merged = JSON.parse(text) as { documentType: string; summary: string; duplicateGroups: number[][] };
    const remove = new Set<number>();
    for (const group of merged.duplicateGroups) group.slice(1).forEach((index) => { if (index >= 0 && index < items.length) remove.add(index); });
    items = items.filter((_, index) => !remove.has(index));
    const order = { danger: 0, caution: 1, important: 2, general: 3 };
    items.sort((a, b) => order[a.level] - order[b.level] || (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER));
    const glossary = [...new Map(body.results.flatMap((result) => result.glossary ?? []).map((entry) => [entry.term, entry])).values()];
    return Response.json({ documentType: merged.documentType, summary: merged.summary, items, glossary });
  } catch (reason) {
    console.error("Analysis merge failed", reason);
    return jsonError("분석 결과를 정리하지 못했습니다.", 502);
  }
}
