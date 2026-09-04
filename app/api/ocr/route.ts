import { callGemini, geminiText, type GeminiPayload } from "../gemini";

const MAX_IMAGE_LENGTH = 700_000;
const ocrSchema = {
  type: "object", additionalProperties: false, required: ["text"],
  properties: { text: { type: "string" } },
} as const;

const OCR_PROMPT = `
첨부 이미지는 한국어 PDF의 한 페이지입니다. 실제로 보이는 글자를 정확히 옮겨 적으세요.

- 내용을 요약, 설명, 번역, 교정하거나 새로 만들지 마세요.
- 제목, 조항 번호, 표의 항목명, 숫자, 금액, 날짜, 비율, 괄호와 문장부호를 최대한 보존하세요.
- 읽을 수 없는 글자는 추측하지 말고 [읽을 수 없음]으로 적으세요.
- 서명 이미지, 도장 모양, 선, 테두리, 체크박스 등 글자가 아닌 장식은 적지 마세요.
- 반복되는 머리말과 꼬리말도 실제 글자가 있으면 옮기되 페이지마다 한 번만 적으세요.
- 페이지가 2단이면 같은 높이의 좌우 문장을 섞지 말고 왼쪽 열을 위에서 아래까지 먼저 읽은 다음 오른쪽 열을 위에서 아래까지 읽으세요.
- 문서코드, 개정일, 보존본·고객용 표시, 준법감시인 심의번호, 로고, 페이지 번호처럼 상단·하단에 반복되는 서식 문구는 본문에서 제외하세요.
- text 안에서는 원래 문단과 줄 구분을 줄바꿈으로 보존하세요.
`.trim();

function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonError("OCR 서비스 설정이 아직 완료되지 않았습니다.", 503);
  try {
    const body = await request.json() as { image?: string; page?: number; part?: string };
    if (!body.image || body.image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(body.image)) return jsonError("OCR 페이지 이미지가 올바르지 않습니다.", 400);
    const response = await callGemini(apiKey, OCR_PROMPT, [{ text: `${body.page ?? 1}쪽${body.part ? ` (${body.part} 구간)` : ""}` }, { inlineData: { mimeType: "image/jpeg", data: body.image } }], ocrSchema);
    if (!response.ok) {
      const detail = await response.text();
      console.error("Gemini OCR error", response.status, detail.slice(0, 500));
      return jsonError(response.status === 429 ? "OCR 요청이 잠시 제한됐습니다. 잠시 후 다시 시도해 주세요." : "스캔 PDF의 글자를 읽지 못했습니다.", response.status === 429 ? 429 : 502);
    }
    const payload = await response.json() as GeminiPayload;
    const text = geminiText(payload);
    if (!text) return jsonError("스캔 PDF에서 읽은 글자가 없습니다.", 502);
    const result = JSON.parse(text) as { text?: string };
    // Blank separator/cover pages are valid in scanned contracts. The caller
    // decides whether the document as a whole contains enough recognized text.
    return Response.json({ page: body.page ?? 1, text: result.text?.trim() ?? "" });
  } catch (reason) {
    console.error("PDF OCR failed", reason);
    return jsonError("스캔 PDF의 글자를 읽지 못했습니다.", 502);
  }
}
