import { CONTRACT_QA_PROMPT } from "../../ai-prompts";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const answerSchema = {
  type: "object", additionalProperties: false,
  required: ["answer", "citations", "notFound", "glossary"],
  properties: {
    answer: { type: "string" },
    notFound: { type: "boolean" },
    citations: { type: "array", maxItems: 4, items: {
      type: "object", additionalProperties: false,
      required: ["original", "page", "relevance"],
      properties: { original: { type: "string" }, page: { type: ["integer", "null"] }, relevance: { type: "string" } },
    } },
    glossary: { type: "array", maxItems: 10, items: {
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
  const question = String(formData.get("question") ?? "").trim();
  const historyRaw = String(formData.get("history") ?? "[]");
  if (!(uploaded instanceof File)) return jsonError("먼저 PDF 파일을 분석해 주세요.", 400);
  if (!question) return jsonError("질문을 입력해 주세요.", 400);
  if (question.length > 500) return jsonError("질문은 500자 이하로 입력해 주세요.", 400);
  if (uploaded.size > MAX_FILE_SIZE) return jsonError("파일은 10MB 이하로 올려 주세요.", 413);
  let history: Array<{ role: string; text: string }> = [];
  try { history = JSON.parse(historyRaw).slice(-6); } catch { history = []; }

  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const fileData = `data:application/pdf;base64,${btoa(binary)}`;
  const conversation = history.map((entry) => `${entry.role === "user" ? "사용자" : "AI"}: ${entry.text}`).join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.4-2026-03-05", store: false,
      instructions: CONTRACT_QA_PROMPT,
      input: [{ role: "user", content: [
        { type: "input_text", text: `이전 대화:\n${conversation || "없음"}\n\n현재 질문: ${question}` },
        { type: "input_file", filename: uploaded.name, file_data: fileData, detail: "auto" },
      ] }],
      text: { format: { type: "json_schema", name: "contract_question_answer", strict: true, schema: answerSchema } },
    }),
  });
  if (!response.ok) {
    const detail = await response.text(); console.error("OpenAI ask error", response.status, detail.slice(0, 500));
    if (response.status === 429) return jsonError("질문 요청이 많습니다. 잠시 후 다시 시도해 주세요.", 429);
    return jsonError("질문에 답하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
  }
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const outputText = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
  if (!outputText) return jsonError("답변 결과를 읽지 못했습니다.", 502);
  try { return Response.json(JSON.parse(outputText)); } catch { return jsonError("답변 결과 형식이 올바르지 않습니다.", 502); }
}
