const MAX_FILE_SIZE = 10 * 1024 * 1024;

const answerSchema = {
  type: "object", additionalProperties: false,
  required: ["answer", "citations", "notFound"],
  properties: {
    answer: { type: "string" },
    notFound: { type: "boolean" },
    citations: { type: "array", maxItems: 4, items: {
      type: "object", additionalProperties: false,
      required: ["original", "page", "relevance"],
      properties: { original: { type: "string" }, page: { type: ["integer", "null"] }, relevance: { type: "string" } },
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
      model: "gpt-5.4", store: false,
      instructions: [
        "당신은 한국 금융 계약서 문답 도우미입니다.",
        "반드시 첨부 PDF에 실제로 적힌 내용만 근거로 답하세요. 일반 지식으로 빈칸을 채우거나 법률 자문처럼 단정하지 마세요.",
        "답을 찾을 수 없으면 notFound를 true로 하고 문서에서 확인되지 않는다고 명확히 말하세요.",
        "모든 실질적 답변에는 근거 원문을 짧게 인용하고, 확인 가능한 경우에만 페이지를 표시하세요.",
        "이전 대화는 질문의 문맥 파악에만 사용하고 근거는 항상 PDF에서 다시 찾으세요.",
      ].join("\n"),
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
