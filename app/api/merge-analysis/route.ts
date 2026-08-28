import { callGemini, geminiText, type GeminiPayload } from "../gemini";
import { CONTRACT_DEDUPLICATION_PROMPT } from "../../ai-prompts";

const mergeSchema = {
  type: "object", additionalProperties: false,
  required: ["documentType", "summary", "duplicateGroups"],
  properties: {
    documentType: { type: "string" }, summary: { type: "string" },
    duplicateGroups: { type: "array", maxItems: 60, items: { type: "object", additionalProperties: false, required: ["indexes"], properties: { indexes: { type: "array", minItems: 2, maxItems: 20, items: { type: "integer" } } } } },
  },
} as const;

type Item = { level: "danger" | "caution" | "important" | "general"; title: string; core: string; easyExplanation: string; impact: string; checkPoint: string; action: string; original: string; page: number | null };

function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonError("AI 분석 서비스 설정이 아직 완료되지 않았습니다.", 503);
  try {
    const body = await request.json() as { items?: Item[] };
    const items = body.items;
    if (!Array.isArray(items) || !items.length) return jsonError("통합할 분석 결과가 없습니다.", 400);
    const compactItems = items.map((item, index) => ({ index, title: item.title, core: item.core, impact: item.impact, checkPoint: item.checkPoint, original: item.original, page: item.page, level: item.level }));
    const response = await callGemini(apiKey, CONTRACT_DEDUPLICATION_PROMPT, [{ text: JSON.stringify(compactItems) }], mergeSchema);
    if (!response.ok) {
      const detail = await response.text(); console.error("Gemini merge error", response.status, detail.slice(0, 500));
      return jsonError("분석 결과를 정리하지 못했습니다.", 502);
    }
    const payload = await response.json() as GeminiPayload;
    const text = geminiText(payload);
    if (!text) return jsonError("최종 분석 결과를 읽지 못했습니다.", 502);
    const result = JSON.parse(text) as { documentType: string; summary: string; duplicateGroups: Array<{ indexes: number[] }> };
    const used = new Set<number>();
    const validGroups: Array<{ indexes: number[] }> = [];
    for (const group of result.duplicateGroups) {
      const indexes = [...new Set(group.indexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < items.length && !used.has(index));
      if (indexes.length < 2) continue;
      indexes.forEach((index) => used.add(index));
      validGroups.push({ indexes });
    }
    result.duplicateGroups = validGroups;
    return Response.json(result);
  } catch (reason) {
    console.error("Analysis merge failed", reason);
    return jsonError("분석 결과를 정리하지 못했습니다.", 502);
  }
}
