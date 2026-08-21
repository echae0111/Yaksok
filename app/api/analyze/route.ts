import { CONTRACT_ANALYSIS_PROMPT, CONTRACT_COVERAGE_PROMPT } from "../../ai-prompts";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const analysisSchema = {
  type: "object", additionalProperties: false,
  required: ["documentType", "summary", "items", "glossary"],
  properties: {
    documentType: { type: "string" }, summary: { type: "string" },
    items: { type: "array", minItems: 1, maxItems: 80, items: {
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
      type: "object", additionalProperties: false,
      required: ["term", "definition"],
      properties: { term: { type: "string" }, definition: { type: "string" } },
    } },
  },
} as const;

function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonError("AI 분석 서비스 설정이 아직 완료되지 않았습니다.", 503);
  const formData = await request.formData();
  const uploaded = formData.get("file");
  if (!(uploaded instanceof File)) return jsonError("PDF 파일을 선택해 주세요.", 400);
  if (uploaded.type !== "application/pdf" && !uploaded.name.toLowerCase().endsWith(".pdf")) return jsonError("PDF 파일만 분석할 수 있습니다.", 415);
  if (uploaded.size === 0) return jsonError("빈 파일은 분석할 수 없습니다.", 400);
  if (uploaded.size > MAX_FILE_SIZE) return jsonError("파일은 10MB 이하로 올려 주세요.", 413);

  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const fileData = `data:application/pdf;base64,${btoa(binary)}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.4", store: false,
      instructions: `${CONTRACT_ANALYSIS_PROMPT}\n\n${CONTRACT_COVERAGE_PROMPT}`,
      input: [{ role: "user", content: [
        { type: "input_text", text: "이 금융 계약서를 분석해 핵심 요약과 중요한 조항을 알려주세요." },
        { type: "input_file", filename: uploaded.name, file_data: fileData, detail: "auto" },
      ] }],
      text: { format: { type: "json_schema", name: "financial_contract_analysis", strict: true, schema: analysisSchema } },
    }),
  });
  if (!response.ok) {
    const detail = await response.text(); console.error("OpenAI response error", response.status, detail.slice(0, 500));
    if (response.status === 401) return jsonError("AI 서비스 인증 설정을 확인해 주세요.", 503);
    if (response.status === 429) return jsonError("분석 요청이 많습니다. 잠시 후 다시 시도해 주세요.", 429);
    return jsonError("문서를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
  }
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const outputText = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
  if (!outputText) return jsonError("분석 결과를 읽지 못했습니다.", 502);
  try { return Response.json(JSON.parse(outputText)); } catch { return jsonError("분석 결과 형식이 올바르지 않습니다.", 502); }
}
