import { CONTRACT_ANALYSIS_PROMPT, CONTRACT_COVERAGE_PROMPT } from "../../ai-prompts";

const MAX_CHUNK_SIZE = 8 * 1024 * 1024;
const chunkSchema = {
  type: "object", additionalProperties: false,
  required: ["documentType", "summary", "items", "glossary"],
  properties: {
    documentType: { type: "string" }, summary: { type: "string" },
    items: { type: "array", minItems: 0, maxItems: 30, items: {
      type: "object", additionalProperties: false,
      required: ["level", "title", "core", "easyExplanation", "impact", "checkPoint", "action", "original", "page"],
      properties: {
        level: { type: "string", enum: ["danger", "caution", "important", "general"] }, title: { type: "string" },
        core: { type: "string" }, easyExplanation: { type: "string" }, impact: { type: "string" },
        checkPoint: { type: "string" }, action: { type: "string" }, original: { type: "string" },
        page: { type: ["integer", "null"] },
      },
    } },
    glossary: { type: "array", maxItems: 16, items: {
      type: "object", additionalProperties: false, required: ["term", "definition"],
      properties: { term: { type: "string" }, definition: { type: "string" } },
    } },
  },
} as const;

type ChunkResult = { items: Array<{ page: number | null }>; [key: string]: unknown };
function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }
function toDataUrl(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:application/pdf;base64,${btoa(binary)}`;
}
function getOutputText(payload: { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonError("AI 분석 서비스 설정이 아직 완료되지 않았습니다.", 503);
  const formData = await request.formData();
  const uploaded = formData.get("file");
  const startPage = Number(formData.get("startPage"));
  const endPage = Number(formData.get("endPage"));
  if (!(uploaded instanceof File)) return jsonError("PDF 구간을 읽지 못했습니다.", 400);
  if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage) return jsonError("페이지 범위가 올바르지 않습니다.", 400);
  if (uploaded.size === 0 || uploaded.size > MAX_CHUNK_SIZE) return jsonError("PDF 구간의 크기가 올바르지 않습니다.", 413);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4", store: false,
        instructions: `${CONTRACT_ANALYSIS_PROMPT}\n\n${CONTRACT_COVERAGE_PROMPT}\n\n이 PDF는 전체 계약서 중 원본 ${startPage}~${endPage}쪽 구간입니다. 이 구간에서 확인되는 의미 있는 계약 조건을 빠짐없이 정리하세요. page에는 이 분할 PDF 안에서의 페이지 번호(첫 장은 1)를 적으세요. 다른 구간의 내용을 추측하지 마세요.`,
        input: [{ role: "user", content: [
          { type: "input_text", text: `원본 계약서 ${startPage}~${endPage}쪽 구간의 조항을 분석하세요.` },
          { type: "input_file", filename: uploaded.name, file_data: toDataUrl(new Uint8Array(await uploaded.arrayBuffer())), detail: "auto" },
        ] }],
        text: { format: { type: "json_schema", name: "contract_chunk_analysis", strict: true, schema: chunkSchema } },
      }),
    });
    if (!response.ok) {
      const detail = await response.text(); console.error("OpenAI chunk error", response.status, detail.slice(0, 500));
      return jsonError(response.status === 429 ? "분석 요청이 많습니다. 잠시 후 다시 시도해 주세요." : "계약서 일부를 분석하지 못했습니다.", response.status === 429 ? 429 : 502);
    }
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = getOutputText(payload);
    if (!text) return jsonError("분석 결과를 읽지 못했습니다.", 502);
    const result = JSON.parse(text) as ChunkResult;
    result.items = result.items.map((item) => ({ ...item, page: item.page === null ? null : startPage + item.page - 1 }));
    return Response.json(result);
  } catch (reason) {
    console.error("Chunk analysis failed", reason);
    return jsonError("계약서 일부를 분석하지 못했습니다.", 502);
  }
}
