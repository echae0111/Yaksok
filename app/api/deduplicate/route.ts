import { CONTRACT_DEDUPLICATION_PROMPT } from "../../ai-prompts";
import { callGemini, geminiText, type GeminiPayload } from "../gemini";

const schema = {
  type: "object", additionalProperties: false, required: ["duplicateGroups"],
  properties: {
    duplicateGroups: { type: "array", maxItems: 60, items: { type: "object", additionalProperties: false, required: ["keepId", "mergeIds"], properties: {
      keepId: { type: "string" }, mergeIds: { type: "array", minItems: 1, maxItems: 9, items: { type: "string" } },
    } } },
  },
} as const;

type Candidate = { id: string; source: string; title: string; summary: string; effect: string };
type Decision = { keepId: string; mergeIds: string[] };

function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonError("AI 분석 서비스 설정이 아직 완료되지 않았습니다.", 503);
  try {
    const body = await request.json() as { candidateGroups?: Candidate[][] };
    const groups = body.candidateGroups;
    if (!Array.isArray(groups) || groups.length > 60 || groups.some((group) => !Array.isArray(group) || group.length < 2 || group.length > 10)) return jsonError("중복 후보 형식이 올바르지 않습니다.", 400);
    const total = groups.reduce((sum, group) => sum + group.length, 0);
    if (!total || total > 200) return jsonError("중복 후보가 너무 많습니다.", 400);
    const compactGroups = groups.map((group, groupIndex) => ({ groupIndex, items: group.map((item) => ({ id: item.id, source: item.source, title: item.title.slice(0, 180), summary: item.summary.slice(0, 260), effect: item.effect.slice(0, 260) })) }));
    const response = await callGemini(apiKey, CONTRACT_DEDUPLICATION_PROMPT, [{ text: JSON.stringify(compactGroups) }], schema);
    if (!response.ok) {
      const detail = await response.text(); console.error("Gemini deduplication error", response.status, detail.slice(0, 500));
      return jsonError("유사 항목을 자동으로 정리하지 못했습니다.", response.status === 429 ? 429 : 502);
    }
    const payload = await response.json() as GeminiPayload;
    const text = geminiText(payload);
    if (!text) return jsonError("중복 판정 결과를 읽지 못했습니다.", 502);
    const parsed = JSON.parse(text) as { duplicateGroups?: Decision[] };
    const groupById = new Map<string, number>();
    groups.forEach((group, groupIndex) => group.forEach((item) => groupById.set(item.id, groupIndex)));
    const used = new Set<string>();
    const duplicateGroups: Decision[] = [];
    for (const decision of parsed.duplicateGroups ?? []) {
      const groupIndex = groupById.get(decision.keepId);
      if (groupIndex === undefined || used.has(decision.keepId)) continue;
      const mergeIds = [...new Set(decision.mergeIds)].filter((id) => id !== decision.keepId && groupById.get(id) === groupIndex && !used.has(id));
      if (!mergeIds.length) continue;
      used.add(decision.keepId); mergeIds.forEach((id) => used.add(id));
      duplicateGroups.push({ keepId: decision.keepId, mergeIds });
    }
    return Response.json({ duplicateGroups });
  } catch (reason) {
    console.error("Deduplication failed", reason);
    return jsonError("유사 항목을 자동으로 정리하지 못했습니다.", 502);
  }
}
