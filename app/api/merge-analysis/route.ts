import { callGemini, geminiText, type GeminiPayload } from "../gemini";

const mergeSchema = {
  type: "object", additionalProperties: false,
  required: ["documentType", "summary"],
  properties: {
    documentType: { type: "string" }, summary: { type: "string" },
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
    const compactItems = items.map((item) => ({ title: item.title, original: item.original, page: item.page, level: item.level }));
    const response = await callGemini(apiKey, "프로그램이 확정한 금융 계약서 조항 목록입니다. 항목을 합치거나 삭제하거나 새로 만들지 말고, 제공된 내용만 바탕으로 documentType과 전체 summary만 짧고 쉬운 한국어로 작성하세요.", [{ text: JSON.stringify(compactItems) }], mergeSchema);
    if (!response.ok) {
      const detail = await response.text(); console.error("Gemini merge error", response.status, detail.slice(0, 500));
      return jsonError("분석 결과를 정리하지 못했습니다.", 502);
    }
    const payload = await response.json() as GeminiPayload;
    const text = geminiText(payload);
    if (!text) return jsonError("최종 분석 결과를 읽지 못했습니다.", 502);
    return Response.json(JSON.parse(text));
  } catch (reason) {
    console.error("Analysis merge failed", reason);
    return jsonError("분석 결과를 정리하지 못했습니다.", 502);
  }
}
