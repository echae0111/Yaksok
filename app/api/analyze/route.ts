import { PDFDocument } from "pdf-lib";
import { CONTRACT_ANALYSIS_PROMPT, CONTRACT_COVERAGE_PROMPT } from "../../ai-prompts";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PAGES_PER_CHUNK = 15;
const CONCURRENCY = 3;

const itemProperties = {
  level: { type: "string", enum: ["danger", "caution", "important", "general"] }, title: { type: "string" },
  core: { type: "string" }, easyExplanation: { type: "string" }, impact: { type: "string" },
  checkPoint: { type: "string" }, action: { type: "string" }, original: { type: "string" },
  page: { type: ["integer", "null"] },
} as const;

const chunkSchema = {
  type: "object", additionalProperties: false,
  required: ["documentType", "summary", "items", "glossary"],
  properties: {
    documentType: { type: "string" }, summary: { type: "string" },
    items: { type: "array", minItems: 0, maxItems: 35, items: {
      type: "object", additionalProperties: false,
      required: ["level", "title", "core", "easyExplanation", "impact", "checkPoint", "action", "original", "page"],
      properties: itemProperties,
    } },
    glossary: { type: "array", maxItems: 16, items: {
      type: "object", additionalProperties: false, required: ["term", "definition"],
      properties: { term: { type: "string" }, definition: { type: "string" } },
    } },
  },
} as const;

const mergeSchema = {
  type: "object", additionalProperties: false,
  required: ["documentType", "summary", "duplicateGroups"],
  properties: {
    documentType: { type: "string" }, summary: { type: "string" },
    duplicateGroups: { type: "array", maxItems: 100, items: {
      type: "array", minItems: 2, maxItems: 12, items: { type: "integer" },
    } },
  },
} as const;

type Item = { level: "danger" | "caution" | "important" | "general"; title: string; core: string; easyExplanation: string; impact: string; checkPoint: string; action: string; original: string; page: number | null };
type GlossaryTerm = { term: string; definition: string };
type ChunkResult = { documentType: string; summary: string; items: Item[]; glossary: GlossaryTerm[] };

function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }); }
function toDataUrl(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:application/pdf;base64,${btoa(binary)}`;
}
function outputText(payload: { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
}
async function createResponse(apiKey: string, body: Record<string, unknown>) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text(); console.error("OpenAI analysis error", response.status, detail.slice(0, 500));
    throw new Error(response.status === 429 ? "분석 요청이 많습니다. 잠시 후 다시 시도해 주세요." : "문서를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const text = outputText(payload);
  if (!text) throw new Error("분석 결과를 읽지 못했습니다.");
  return JSON.parse(text) as unknown;
}
async function splitPdf(bytes: Uint8Array) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const chunks: Array<{ bytes: Uint8Array; startPage: number; endPage: number }> = [];
  for (let start = 0; start < source.getPageCount(); start += PAGES_PER_CHUNK) {
    const end = Math.min(start + PAGES_PER_CHUNK, source.getPageCount());
    const part = await PDFDocument.create();
    const pages = await part.copyPages(source, Array.from({ length: end - start }, (_, index) => start + index));
    pages.forEach((page) => part.addPage(page));
    chunks.push({ bytes: await part.save({ useObjectStreams: false }), startPage: start + 1, endPage: end });
  }
  return chunks;
}
async function analyzeChunk(apiKey: string, filename: string, chunk: { bytes: Uint8Array; startPage: number; endPage: number }) {
  const result = await createResponse(apiKey, {
    model: "gpt-5.4", store: false,
    instructions: `${CONTRACT_ANALYSIS_PROMPT}\n\n${CONTRACT_COVERAGE_PROMPT}\n\n이 PDF는 전체 계약서 중 원본 ${chunk.startPage}~${chunk.endPage}쪽 구간입니다. 이 구간 안에서 확인되는 의미 있는 계약 조건을 빠짐없이 정리하세요. page에는 이 분할 PDF 안에서의 페이지 번호(첫 장은 1)를 적으세요. 다른 구간의 내용을 추측하지 마세요.`,
    input: [{ role: "user", content: [
      { type: "input_text", text: `원본 계약서 ${chunk.startPage}~${chunk.endPage}쪽 구간의 조항을 분석하세요.` },
      { type: "input_file", filename: `${filename}-${chunk.startPage}-${chunk.endPage}.pdf`, file_data: toDataUrl(chunk.bytes), detail: "auto" },
    ] }],
    text: { format: { type: "json_schema", name: "contract_chunk_analysis", strict: true, schema: chunkSchema } },
  }) as ChunkResult;
  result.items = result.items.map((item) => ({ ...item, page: item.page === null ? null : chunk.startPage + item.page - 1 }));
  return result;
}
async function analyzeChunkWithRetry(apiKey: string, filename: string, chunk: { bytes: Uint8Array; startPage: number; endPage: number }) {
  try { return await analyzeChunk(apiKey, filename, chunk); }
  catch { return analyzeChunk(apiKey, filename, chunk); }
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
  const formData = await request.formData();
  const uploaded = formData.get("file");
  if (!(uploaded instanceof File)) return jsonError("PDF 파일을 선택해 주세요.", 400);
  if (uploaded.type !== "application/pdf" && !uploaded.name.toLowerCase().endsWith(".pdf")) return jsonError("PDF 파일만 분석할 수 있습니다.", 415);
  if (uploaded.size === 0) return jsonError("빈 파일은 분석할 수 없습니다.", 400);
  if (uploaded.size > MAX_FILE_SIZE) return jsonError("파일은 10MB 이하로 올려 주세요.", 413);
  try {
    const chunks = await splitPdf(new Uint8Array(await uploaded.arrayBuffer()));
    const results: ChunkResult[] = [];
    for (let index = 0; index < chunks.length; index += CONCURRENCY) {
      results.push(...await Promise.all(chunks.slice(index, index + CONCURRENCY).map((chunk) => analyzeChunkWithRetry(apiKey, uploaded.name, chunk))));
    }
    let items = removeExactDuplicates(results.flatMap((result) => result.items));
    const compactItems = items.map((item, index) => ({ index, title: item.title, original: item.original, page: item.page, level: item.level }));
    const merged = await createResponse(apiKey, {
      model: "gpt-5.4", store: false,
      instructions: "여러 구간에서 추출한 금융 계약서 조항 목록을 최종 정리하세요. 제공된 내용만 사용하세요. 같은 계약 조건을 표현만 달리해 반복한 항목은 duplicateGroups에 해당 index들을 묶으세요. 서로 다른 조건은 합치지 마세요. documentType과 summary는 전체 목록을 바탕으로 짧고 쉬운 한국어로 작성하세요.",
      input: JSON.stringify(compactItems),
      text: { format: { type: "json_schema", name: "contract_analysis_merge", strict: true, schema: mergeSchema } },
    }) as { documentType: string; summary: string; duplicateGroups: number[][] };
    const remove = new Set<number>();
    for (const group of merged.duplicateGroups) group.slice(1).forEach((index) => { if (index >= 0 && index < items.length) remove.add(index); });
    items = items.filter((_, index) => !remove.has(index));
    const order = { danger: 0, caution: 1, important: 2, general: 3 };
    items.sort((a, b) => order[a.level] - order[b.level] || (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER));
    const glossary = [...new Map(results.flatMap((result) => result.glossary).map((entry) => [entry.term, entry])).values()];
    return Response.json({ documentType: merged.documentType, summary: merged.summary, items, glossary });
  } catch (reason) {
    console.error("Chunked contract analysis failed", reason);
    return jsonError(reason instanceof Error ? reason.message : "문서를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
  }
}
