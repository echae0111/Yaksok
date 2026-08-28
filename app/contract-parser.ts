import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";

export const ANALYSIS_VERSION = "parser-2_prompt-8_risk-1_gemini-2.5-flash";

export type RiskSignals = { immediateRepayment: boolean; terminationOrExclusion: boolean; additionalCost: boolean; creditImpact: boolean; rightRestriction: boolean; deadline: boolean; consumerDuty: boolean };
export type RawClause = { id: string; page: number; order: number; marker: string; text: string; original: string; signals: RiskSignals; level: "danger" | "caution" | "important" | "general" };
export type BasicInfo = { label: string; value: string; explanation: string; page: number };
export type DocumentNotice = { text: string; page: number };
type Line = { page: number; y: number; height: number; text: string };

const boundaryPattern = /^(?:제\s*\d+\s*조(?:의\s*\d+)?|제\s*\d+\s*항|[①-⑳]|\(?\d+\)|\d+[.)]|[가-힣][.)])(?:\s|$)/;
const markerPattern = /^(제\s*\d+\s*조(?:의\s*\d+)?|제\s*\d+\s*항|[①-⑳]|\(?\d+\)|\d+[.)]|[가-힣][.)])/;
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
const compact = (text: string) => normalize(text).replace(/[\s\p{P}]/gu, "").toLowerCase();
const infoDefinitions = [
  ["계약 종류", ["계약 종류", "계약서 종류"], "어떤 종류의 금융 계약인지 보여주는 정보입니다."],
  ["상품명", ["상품명", "금융상품명"], "가입하거나 이용하는 금융상품의 이름입니다."],
  ["금융회사", ["금융회사", "금융기관", "회사명", "채권자", "대주"], "이 계약을 제공하거나 돈을 빌려주는 회사입니다."],
  ["채무자", ["채무자", "차주", "대출받는 사람", "계약자"], "계약에 따라 돈을 갚거나 의무를 지는 사람입니다."],
  ["대출금액", ["대출금액", "대출 원금", "대출원금", "약정금액"], "이 계약에 따라 빌리는 원금입니다."],
  ["계약일", ["계약일", "계약 체결일", "약정일", "작성일"], "계약을 체결하거나 작성한 날짜입니다."],
  ["계약기간", ["계약기간", "대출기간", "약정기간"], "계약의 효력이 유지되는 기간입니다."],
  ["적용기간", ["적용기간", "보장기간"], "이 계약의 조건이 적용되는 기간입니다."],
  ["계약번호", ["계약번호", "계약 번호", "문서번호", "약정번호", "계좌번호"], "이 계약을 다른 계약과 구분하기 위한 식별번호입니다."],
] as const;
const infoAliases = infoDefinitions.flatMap(([label, aliases, explanation]) => aliases.map((alias) => ({ alias, label, explanation })));
const aliasPattern = infoAliases.map(({ alias }) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|");
const noticePattern = /(테스트용|시험용|가상(?:의)?\s*문서|실제\s*계약(?:으로)?\s*(?:사용|이용)할\s*수\s*없|서비스\s*검증용|분석\s*기능을\s*(?:시험|검증)|참고용|법적\s*효력(?:이)?\s*없)/i;

function extractNonClauses(pages: Line[][]) {
  const basicInfo: BasicInfo[] = [];
  const notices: DocumentNotice[] = [];
  const excluded = new Set<string>();
  const usedLabels = new Set<string>();
  for (const lines of pages) for (const line of lines) {
    const key = `${line.page}:${compact(line.text)}`;
    const matches = [...line.text.matchAll(new RegExp(`(?:^|\\s)(${aliasPattern})\\s*[:：]\\s*(.+?)(?=\\s+(?:${aliasPattern})\\s*[:：]|$)`, "g"))];
    for (const match of matches) {
      const definition = infoAliases.find(({ alias }) => alias === match[1]);
      const value = normalize(match[2]);
      if (definition && value && !usedLabels.has(definition.label)) {
        basicInfo.push({ label: definition.label, value, explanation: definition.explanation, page: line.page });
        usedLabels.add(definition.label);
        excluded.add(key);
      }
    }
    if (noticePattern.test(line.text)) {
      notices.push({ text: line.text, page: line.page });
      excluded.add(key);
    }
  }
  if (!usedLabels.has("계약 종류")) {
    const title = pages[0]?.slice(0, 8).find((line) => line.text.length <= 80 && /(계약서|약정서|약관|신청서)/.test(line.text));
    if (title) {
      basicInfo.unshift({ label: "계약 종류", value: title.text, explanation: "문서 제목에 표시된 계약의 종류입니다.", page: title.page });
      excluded.add(`${title.page}:${compact(title.text)}`);
    }
  }
  return { basicInfo, notices: [...new Map(notices.map((notice) => [`${notice.page}:${compact(notice.text)}`, notice])).values()], excluded };
}

async function sha256(value: ArrayBuffer | string) {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function classify(text: string): { signals: RiskSignals; level: RawClause["level"] } {
  const signals: RiskSignals = {
    immediateRepayment: /(기한이익.{0,12}상실|즉시.{0,12}(전액|모두).{0,12}(상환|변제)|남은.{0,16}(전액|모두).{0,12}(갚|상환))/s.test(text),
    terminationOrExclusion: /(계약.{0,10}(해지|해제|종료)|보장하지 아니|보장하지 않|면책|지급하지 아니|지급하지 않)/s.test(text),
    additionalCost: /(수수료|위약금|연체금|연체이자|가산이자|추가.{0,8}(비용|부담)|손해배상)/s.test(text),
    creditImpact: /(신용정보|신용도|신용점수|연체정보.{0,8}(등록|제공))/s.test(text),
    rightRestriction: /(권리.{0,8}(제한|상실)|담보권.{0,8}(실행|처분)|강제집행|채권.{0,8}(회수|추심)|압류)/s.test(text),
    deadline: /(까지.{0,12}(신청|통지|제출|납입|지급)|기한|기간.{0,8}내|\d+일\s*이내)/s.test(text),
    consumerDuty: /(하여야 한다|해야 한다|의무|반드시|지체 없이|통지하여야|제출하여야)/s.test(text),
  };
  const weights = [signals.immediateRepayment ? 5 : 0, signals.terminationOrExclusion ? 5 : 0, signals.rightRestriction ? 4 : 0, signals.additionalCost ? 4 : 0, signals.creditImpact ? 4 : 0, signals.deadline ? 3 : 0, signals.consumerDuty ? 2 : 0];
  const score = Math.max(...weights);
  return { signals, level: score >= 5 ? "danger" : score >= 3 ? "caution" : score >= 1 ? "important" : "general" };
}

function groupLines(items: Array<{ str?: string; transform?: number[]; height?: number; hasEOL?: boolean }>, page: number) {
  const groups: Line[] = [];
  for (const item of items) {
    const text = normalize(item.str ?? "");
    if (!text) continue;
    const y = item.transform?.[5] ?? 0;
    const height = Math.max(item.height ?? Math.abs(item.transform?.[3] ?? 10), 1);
    const existing = groups.find((line) => Math.abs(line.y - y) <= Math.max(2, height * .28));
    if (existing) existing.text = normalize(`${existing.text} ${text}`);
    else groups.push({ page, y, height, text });
  }
  return groups.sort((a, b) => b.y - a.y);
}

function pageBlocks(lines: Line[]) {
  if (!lines.length) return [] as Array<{ page: number; lines: string[]; marked: boolean }>;
  const heights = lines.map((line) => line.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 10;
  const blocks: Array<{ page: number; lines: string[]; marked: boolean }> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\d{1,4}$/.test(line.text)) continue;
    const previous = lines[index - 1];
    const gap = previous ? previous.y - line.y : 0;
    const marked = boundaryPattern.test(line.text);
    const looksLikeHeading = line.text.length <= 45 && !/[.!?。]$/.test(line.text) && gap > median * 1.4;
    if (!blocks.length || marked || looksLikeHeading || gap > median * 2.2) blocks.push({ page: line.page, lines: [line.text], marked });
    else blocks[blocks.length - 1].lines.push(line.text);
  }
  return blocks;
}

export async function parseContract(file: File, onPageProgress?: (currentPage: number, totalPages: number) => void): Promise<{ documentHash: string; clauses: RawClause[]; basicInfo: BasicInfo[]; notices: DocumentNotice[] }> {
  const data = await file.arrayBuffer();
  const documentHash = await sha256(data);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: Line[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(groupLines(content.items as Array<{ str?: string; transform?: number[]; height?: number; hasEOL?: boolean }>, pageNumber));
    onPageProgress?.(pageNumber, pdf.numPages);
  }
  const textLength = pages.flat().reduce((sum, line) => sum + line.text.length, 0);
  if (textLength < Math.max(80, pdf.numPages * 20)) throw new Error("이 PDF는 스캔 이미지 중심이라 글자를 충분히 읽지 못했어요. 텍스트 검색이 가능한 PDF로 다시 시도해 주세요.");

  const edgeCounts = new Map<string, number>();
  for (const lines of pages) for (const line of [...lines.slice(0, 2), ...lines.slice(-2)]) edgeCounts.set(compact(line.text), (edgeCounts.get(compact(line.text)) ?? 0) + 1);
  const repeated = new Set([...edgeCounts].filter(([key, count]) => key.length > 2 && count >= Math.max(3, Math.ceil(pdf.numPages * .45))).map(([key]) => key));
  const separated = extractNonClauses(pages);
  const blocks = pages.flatMap((lines) => pageBlocks(lines.filter((line) => !repeated.has(compact(line.text)) && !separated.excluded.has(`${line.page}:${compact(line.text)}`))));

  const merged: Array<{ page: number; text: string }> = [];
  for (const block of blocks) {
    const text = normalize(block.lines.join(" "));
    if (!text || text.length < 4) continue;
    if (!block.marked && merged.length && block === blocks.find((candidate) => candidate.page === block.page)) merged[merged.length - 1].text = normalize(`${merged[merged.length - 1].text} ${text}`);
    else merged.push({ page: block.page, text });
  }

  const unique = new Set<string>();
  const clauses: RawClause[] = [];
  for (let index = 0; index < merged.length; index++) {
    const block = merged[index];
    const sourceKey = `${block.page}:${compact(block.text)}`;
    if (unique.has(sourceKey)) continue;
    unique.add(sourceKey);
    const textHash = await sha256(block.text);
    const marker = block.text.match(markerPattern)?.[1]?.replace(/\s+/g, "") ?? `BLOCK${index + 1}`;
    const id = `${documentHash.slice(0, 8).toUpperCase()}_P${String(block.page).padStart(3, "0")}_${marker.replace(/[^0-9A-Za-z가-힣①-⑳]/g, "")}_${textHash.slice(0, 8).toUpperCase()}`;
    const risk = classify(block.text);
    clauses.push({ id, page: block.page, order: clauses.length, marker, text: block.text, original: block.text.slice(0, 700), ...risk });
  }
  if (!clauses.length) throw new Error("계약서에서 구분할 수 있는 조항을 찾지 못했어요.");
  return { documentHash, clauses, basicInfo: separated.basicInfo, notices: separated.notices };
}

const DB_NAME = "yaksok-analysis-cache";
const STORE_NAME = "results";
function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function getCachedAnalysis<T>(key: string): Promise<T | null> {
  try {
    const db = await openCache();
    return await new Promise<T | null>((resolve, reject) => { const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key); request.onsuccess = () => resolve((request.result as T) ?? null); request.onerror = () => reject(request.error); });
  } catch { return null; }
}
export async function setCachedAnalysis<T>(key: string, value: T) {
  try {
    const db = await openCache();
    await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  } catch { /* 분석 성공은 캐시 저장 실패보다 우선합니다. */ }
}
