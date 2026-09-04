import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";

export const ANALYSIS_VERSION = "parser-16_spacing-1_body-regions-1_column-layout-1_article-boundaries-2_no-cross-clause-merge-1_semantic-coverage-2_source-lineage-3_effects-2_prompt-23_korean-only-1_ocr-4_gemini-2.5-flash";

export type RiskSignals = { immediateRepayment: boolean; terminationOrExclusion: boolean; additionalCost: boolean; creditImpact: boolean; rightRestriction: boolean; deadline: boolean; consumerDuty: boolean };
export type EffectCode = "CONTRACT_TERMINATION" | "TERMINATION_RIGHT" | "ACCELERATION" | "IMMEDIATE_REPAYMENT" | "LOAN_SUSPENSION" | "LOAN_RESTRICTION" | "DEFAULT_INTEREST" | "DIRECT_FINANCIAL_LOSS" | "DIRECT_DAMAGE_LIABILITY" | "CANCELLATION_RESTRICTION" | "CANCELLATION_DEADLINE" | "CANCELLATION_EXCEPTION" | "MODIFICATION_RESTRICTION" | "DEADLINE_TO_NOTIFY" | "RIGHT_TO_CLAIM_RESTRICTED" | "CONSENT_REQUIRED" | "CORRECTION_RESTRICTION" | "OPERATION_SUSPENSION" | "OBLIGATION_SURVIVES_TERMINATION" | "PAYMENT_OBLIGATION_CONTINUES" | "CONTRACT_CONTINUATION" | "PAYMENT_ALLOCATION" | "PAYMENT_OBLIGATION" | "NOTICE_OBLIGATION" | "ASSIGNMENT_PROCEDURE" | "REPRESENTATION" | "CORE_OPERATIONAL_PROCEDURE" | "DEFINITION" | "PURPOSE" | "CONFIDENTIALITY" | "JURISDICTION" | "GENERAL_COOPERATION" | "REFERENCE_TERMS" | "GENERAL_TERM";
export type RawClause = { id: string; page: number; pageEnd: number; order: number; marker: string; sourceArticle: string | null; text: string; original: string; sourceBlockIds: string[]; sourceClauseIds: string[]; effects: EffectCode[]; signals: RiskSignals; level: "danger" | "caution" | "important" | "general" };
export type BasicInfo = { label: string; value: string; explanation: string; page: number };
export type DocumentNotice = { text: string; page: number };
type Line = { page: number; x: number; xEnd: number; y: number; height: number; text: string; region: "body" | "margin" };
type PositionedText = { text: string; x: number; xEnd: number; y: number; height: number };

const boundaryPattern = /^(?:제\s*\d+\s*조(?:의\s*\d+)?|제\s*\d+\s*항|[①-⑳]|\(?\d+\)|\d+[.)]|[가-힣][.)])(?:\s|$)/;
const markerPattern = /^(제\s*\d+\s*조(?:의\s*\d+)?|제\s*\d+\s*항|[①-⑳]|\(?\d+\)|\d+[.)]|[가-힣][.)])/;
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
const explicitArticlePattern = /제\s*\d+\s*조(?:의\s*\d+)?/g;
const brokenGlyphPattern = /[□■�\u0000]/g;
function cleanExtractedText(text: string) {
  const normalized = normalize(text);
  const brokenCount = normalized.match(brokenGlyphPattern)?.length ?? 0;
  if (!brokenCount) return normalized;
  // 글꼴의 ToUnicode 정보가 없는 PDF는 읽지 못한 글자를 네모로 반환합니다.
  // 깨진 조각을 AI 입력에 남겨 허위 설명이 만들어지는 것보다 확인 가능한 글자만 보존합니다.
  const cleaned = normalize(normalized.replace(brokenGlyphPattern, " "));
  return cleaned.length >= 4 ? cleaned : "";
}
function repairPdfWordSpacing(text: string) {
  return normalize(text)
    .replace(/통\s+지/g, "통지")
    .replace(/내\s+용/g, "내용")
    .replace(/동\s+의/g, "동의")
    .replace(/확\s+인/g, "확인")
    .replace(/제\s+기/g, "제기")
    .replace(/개\s+별/g, "개별")
    .replace(/불\s+리한/g, "불리한")
    .replace(/정해\s+진/g, "정해진")
    .replace(/받\s+은/g, "받은")
    .replace(/있으\s+므\s+로/g, "있으므로");
}
function isDecorativeOrLayoutOnly(text: string) {
  const value = normalize(text);
  if (!value) return true;
  const compactValue = value.replace(/\s/g, "");
  const meaningful = compactValue.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  // 선, 점선, 네모, 체크박스, 빈칸용 밑줄처럼 문자 정보가 없는 시각 요소
  if (compactValue.length >= 4 && meaningful === 0) return true;
  if (/^(?:[-‐‑‒–—―_=~·.ㆍ•●○□■▢▪▫◆◇※*|│┃┄┅┈┉┊┋┌-╿]\s*){4,}$/u.test(value)) return true;
  // 글꼴 매핑 오류로 서로 다른 기호가 섞인 긴 장식선도 제외
  if (compactValue.length >= 8 && meaningful / compactValue.length < .2) return true;
  return false;
}
const compact = (text: string) => normalize(text).replace(/[\s\p{P}]/gu, "").toLowerCase();
const infoDefinitions = [
  ["계약 종류", ["계약 종류", "계약서 종류"], "어떤 종류의 금융 계약인지 보여주는 정보입니다."],
  ["상품명", ["상품명", "금융상품명"], "가입하거나 이용하는 금융상품의 이름입니다."],
  ["금융회사", ["금융회사", "금융기관", "회사명", "채권자", "대주"], "이 계약을 제공하거나 돈을 빌려주는 회사입니다."],
  ["채무자", ["채무자", "차주", "대출받는 사람", "계약자"], "계약에 따라 돈을 갚거나 의무를 지는 사람입니다."],
  ["대출금액", ["대출금액", "대출 원금", "대출원금", "약정금액"], "이 계약에 따라 빌리는 원금입니다."],
  ["사채 발행금액", ["사채의 권면총액", "사채 권면총액", "권면총액", "사채 발행금액", "총 발행금액", "발행총액"], "이 계약으로 발행하는 사채의 전체 금액입니다."],
  ["지급금액", ["지급금액", "납입금액", "인수대금", "납입총액"], "이 계약에 따라 실제로 지급하거나 납입하는 금액입니다."],
  ["표면이율", ["표면이율", "표면금리", "사채이율", "약정이율", "이자율"], "계약서에 적힌 기본 이율입니다."],
  ["발행일", ["사채 발행일", "발행일"], "사채가 발행되는 날짜입니다."],
  ["납입기일", ["사채 납입기일", "납입기일", "납입일"], "돈을 납입하기로 한 날짜입니다."],
  ["이자 계산 시작일", ["사채 이자 기산일", "이자 기산일", "이자계산개시일"], "이자를 계산하기 시작하는 날짜입니다."],
  ["만기일", ["사채 만기일", "만기일", "상환기일"], "원금 상환이 예정된 날짜입니다."],
  ["계약일", ["계약일", "계약 체결일", "약정일", "작성일"], "계약을 체결하거나 작성한 날짜입니다."],
  ["계약기간", ["계약기간", "대출기간", "약정기간"], "계약의 효력이 유지되는 기간입니다."],
  ["적용기간", ["적용기간", "보장기간"], "이 계약의 조건이 적용되는 기간입니다."],
  ["계약번호", ["계약번호", "계약 번호", "문서번호", "약정번호", "계좌번호"], "이 계약을 다른 계약과 구분하기 위한 식별번호입니다."],
] as const;
const infoAliases = infoDefinitions.flatMap(([label, aliases, explanation]) => aliases.map((alias) => ({ alias, label, explanation })));
const aliasPattern = infoAliases.map(({ alias }) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|");
const noticePattern = /(테스트용|시험용|가상(?:의)?\s*문서|실제\s*계약(?:으로)?\s*(?:사용|이용)할\s*수\s*없|서비스\s*검증용|분석\s*기능을\s*(?:시험|검증)|참고용|법적\s*효력(?:이)?\s*없)/i;
const administrativePattern = /(심의필|문서\s*(?:관리|식별)\s*(?:번호|정보)|내부\s*(?:관리|식별)\s*(?:번호|정보)|공문\s*번호|버전\s*번호|개정\s*번호|작성\s*부서|담당\s*부서|문서의\s*제목|수입\s*인지\s*부착\s*(?:공간|위치)|사채권?의\s*발행\s*장소|사채의\s*(?:공식\s*)?명칭|[갑을]의\s*명칭|보증\s*서명\s*날짜\s*표시|계약\s*내용\s*설명\s*담당자\s*정보\s*기록|명칭은\s*[‘'"“][^’'"”]+[’'"”](?:로\s*한다|입니다))/i;
const conditionPreamblePattern = /^(?:제\s*\d+\s*조(?:의\s*\d+)?\s*)?(?:사채의\s*)?(?:발행\s*)?조건(?:\s*안내)?\s*(?:이\s*계약에\s*따라|이\s*계약에\s*의하여|이\s*계약에\s*의해)?[^.!?。]{0,80}(?:다음\s*(?:각\s*)?조항|다음과\s*같(?:다|습니다)|명시됩니다)[.!?。]?$/i;

function isNonClauseBoilerplate(text: string) {
  const value = normalize(text);
  return noticePattern.test(value) || administrativePattern.test(value) || conditionPreamblePattern.test(value);
}

function basicInfoExplanation(label: string, value: string, fallback: string) {
  if (label === "사채 발행금액") return `이 계약으로 사채 총 ${value}을 발행해요.`;
  if (label === "지급금액") return `${value}을 지급하거나 납입해야 해요.`;
  if (label === "표면이율") return `계약서에 적힌 기본 이율은 ${value}예요.`;
  if (label === "발행일") return `사채 발행일은 ${value}예요.`;
  if (label === "만기일") return `원금을 갚기로 한 날짜는 ${value}예요.`;
  return fallback;
}

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
      const isSimpleFact = !!definition && value.length <= 100 && !/(하여야|해야|할\s*수|경우|다만|단,|위반|아니한다|않는다|책임|의무)/.test(value);
      if (definition && isSimpleFact && !usedLabels.has(definition.label)) {
        basicInfo.push({ label: definition.label, value, explanation: basicInfoExplanation(definition.label, value, definition.explanation), page: line.page });
        usedLabels.add(definition.label);
        if (compact(match[0]).length >= compact(line.text).length * .85) excluded.add(key);
      }
    }
    if (noticePattern.test(line.text)) {
      notices.push({ text: line.text, page: line.page });
      excluded.add(key);
    }
  }
  if (!usedLabels.has("계약 종류")) {
    const documentTitlePattern = /^.{1,35}(?:계약서|약정서|약관|신청서)(?:\s*\([^)]{1,30}\))?$/;
    const title = pages[0]?.slice(0, 12).find((line) => documentTitlePattern.test(line.text) && !/(하여야|해야|합니다|됩니다|있습니다|없습니다)/.test(line.text));
    if (title) {
      basicInfo.unshift({ label: "계약 종류", value: title.text, explanation: "문서 제목에 표시된 계약의 종류입니다.", page: title.page });
      excluded.add(`${title.page}:${compact(title.text)}`);
    }
  }
  return { basicInfo, notices: [], excluded };
}

async function sha256(value: ArrayBuffer | string) {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const riskEffects = new Set<EffectCode>(["CONTRACT_TERMINATION", "ACCELERATION", "IMMEDIATE_REPAYMENT", "LOAN_SUSPENSION", "LOAN_RESTRICTION", "DEFAULT_INTEREST", "DIRECT_FINANCIAL_LOSS", "DIRECT_DAMAGE_LIABILITY"]);
const cautionEffects = new Set<EffectCode>(["CANCELLATION_RESTRICTION", "CANCELLATION_DEADLINE", "MODIFICATION_RESTRICTION", "DEADLINE_TO_NOTIFY", "RIGHT_TO_CLAIM_RESTRICTED", "CONSENT_REQUIRED", "CORRECTION_RESTRICTION", "OPERATION_SUSPENSION", "OBLIGATION_SURVIVES_TERMINATION", "PAYMENT_OBLIGATION_CONTINUES", "CONTRACT_CONTINUATION"]);
const importantEffects = new Set<EffectCode>(["PAYMENT_OBLIGATION", "NOTICE_OBLIGATION", "ASSIGNMENT_PROCEDURE", "REPRESENTATION", "CORE_OPERATIONAL_PROCEDURE", "PAYMENT_ALLOCATION"]);

function extractEffects(text: string): EffectCode[] {
  const effects = new Set<EffectCode>();
  const add = (effect: EffectCode, pattern: RegExp) => { if (pattern.test(text)) effects.add(effect); };
  add("CONTRACT_TERMINATION", /(?:신용|재무|등급|연체|허위|부도|파산)[\s\S]{0,160}계약.{0,14}(해지|해제|종료)|계약.{0,14}(해지|해제|종료)[\s\S]{0,160}(?:대출.{0,12}(제한|중단))/s);
  add("TERMINATION_RIGHT", /(?:부득이한|합리적인)\s*사정.{0,40}(?:서면.{0,20})?계약.{0,12}(해지|종료)/s);
  add("ACCELERATION", /기한이익.{0,12}상실|기한전.{0,10}(채무변제|상환)/s);
  add("IMMEDIATE_REPAYMENT", /즉시.{0,12}(전액|모두|금액|채무).{0,12}(상환|변제|지급)|곧.{0,8}(상환|변제)/s);
  add("LOAN_SUSPENSION", /대출.{0,12}(중단|정지)/s);
  add("LOAN_RESTRICTION", /대출.{0,12}(제한|거절)/s);
  add("DEFAULT_INTEREST", /연체이자|지연배상금|지체.{0,8}(이자|배상)/s);
  add("DIRECT_DAMAGE_LIABILITY", /손해배상.{0,8}(책임|의무|하여야|한다)|손해를.{0,8}배상|(?:전산|시스템)[\s\S]{0,80}손해.{0,12}부담/s);
  add("DIRECT_FINANCIAL_LOSS", /위약금|몰취|환급하지\s*않|반환하지\s*않/s);
  add("CANCELLATION_RESTRICTION", /취소할\s*수\s*없|취소.{0,10}(제한|불가)/s);
  add("CANCELLATION_DEADLINE", /(?:만기|지급기일).{0,30}(?:전|까지).{0,30}취소|취소.{0,30}(?:만기|지급기일).{0,20}(?:전|까지)/s);
  add("CANCELLATION_EXCEPTION", /(?:동의.{0,10}(?:생략|없이)|발행\s*당일|압류|가압류)[\s\S]{0,100}취소/s);
  add("MODIFICATION_RESTRICTION", /변경할\s*수\s*없|변경.{0,10}(제한|불가)/s);
  add("RIGHT_TO_CLAIM_RESTRICTED", /책임을\s*물을\s*수\s*없|대항할\s*수\s*없|주장할\s*수\s*없|이의를.{0,8}(제기할\s*수\s*없|주장할\s*수\s*없)/s);
  add("CONSENT_REQUIRED", /동의를.{0,8}(받아야|얻어야|받아야\s*한다)|동의가.{0,8}필요/s);
  add("CORRECTION_RESTRICTION", /정정할\s*수\s*없|정정.{0,8}(제한|불가)/s);
  add("OPERATION_SUSPENSION", /업무.{0,10}(중단|정지)|거래.{0,10}(중단|정지)/s);
  add("CONTRACT_CONTINUATION", /자동.{0,4}(연장|갱신)|\d+년씩.{0,6}연장/s);
  add("OBLIGATION_SURVIVES_TERMINATION", /계약.{0,12}(?:종료|해지)[\s\S]{0,80}(?:계속\s*적용|효력.{0,8}(?:유지|존속))/s);
  add("PAYMENT_OBLIGATION_CONTINUES", /(?:회사정리|회생|파산|기한.{0,6}이익.{0,6}상실)[\s\S]{0,120}(?:지급|변제)채무.{0,20}(?:영향을\s*받지|유지|존속)/s);
  add("PAYMENT_ALLOCATION", /충당.{0,20}(?:순서|방법)|(?:순서|방법).{0,20}충당/s);
  add("DEADLINE_TO_NOTIFY", /(당일|\d+일\s*(?:전|이내)|까지|기간\s*내).{0,24}(통지|알려|이의|신고|제출|의사표시)|(?:통지|알려|이의|신고|제출|의사표시).{0,24}(당일|\d+일\s*(?:전|이내)|까지|기간\s*내)/s);
  add("PAYMENT_OBLIGATION", /(지급|납입|상환|변제).{0,12}(하여야\s*한다|해야\s*한다|하기로\s*한다|의무)/s);
  add("NOTICE_OBLIGATION", /(통지|통보|신고|알려야|제출).{0,12}(하여야\s*한다|해야\s*한다|하기로\s*한다|의무)/s);
  add("ASSIGNMENT_PROCEDURE", /채권양도|양도승낙|양도.{0,8}(통지|통보)/s);
  add("REPRESENTATION", /(확인|보증).{0,10}(한다|하기로\s*한다)/s);
  add("CORE_OPERATIONAL_PROCEDURE", /(절차|방법|방식|계좌).{0,16}(따라|의하여|한다|하여야)/s);
  add("DEFINITION", /제\s*2\s*조.{0,20}(?:정의|용어)|(?:이라\s*함은|이라\s*한다)/s);
  add("PURPOSE", /제\s*1\s*조.{0,20}목적|이\s*계약.{0,30}목적/s);
  add("CONFIDENTIALITY", /비밀.{0,12}(유지|누설|유출)|비밀정보/s);
  add("JURISDICTION", /관할.{0,8}(법원|합의)|소송.{0,12}법원/s);
  add("GENERAL_COOPERATION", /상호.{0,12}(협력|지원)|자료.{0,12}제출.{0,20}협력/s);
  add("REFERENCE_TERMS", /(?:약관|기본약관).{0,20}(?:적용|따른다)/s);
  if (!effects.size) effects.add("GENERAL_TERM");
  return [...effects];
}

function levelFromEffects(effects: EffectCode[]): RawClause["level"] {
  if (effects.some((effect) => riskEffects.has(effect))) return "danger";
  if (effects.some((effect) => cautionEffects.has(effect))) return "caution";
  if (effects.some((effect) => importantEffects.has(effect))) return "important";
  return "general";
}

function classify(text: string): { signals: RiskSignals; effects: EffectCode[]; level: RawClause["level"] } {
  const signals: RiskSignals = {
    immediateRepayment: /(기한이익.{0,12}상실|즉시.{0,12}(전액|모두).{0,12}(상환|변제)|남은.{0,16}(전액|모두).{0,12}(갚|상환))/s.test(text),
    terminationOrExclusion: /(계약.{0,14}(해지|해제|종료)|대출.{0,12}(중단|제한|거절)|보장하지 아니|보장하지 않|면책|지급하지 아니|지급하지 않)/s.test(text),
    additionalCost: /(수수료|위약금|연체금|연체이자|가산이자|추가.{0,8}(비용|부담)|손해배상)/s.test(text),
    creditImpact: /(신용정보|신용도|신용점수|연체정보.{0,8}(등록|제공))/s.test(text),
    rightRestriction: /(권리.{0,8}(제한|상실)|책임을\s*물을\s*수\s*없|취소할\s*수\s*없|변경.{0,8}(주장|효력).{0,8}(없|제한)|담보권.{0,8}(실행|처분)|강제집행|채권.{0,8}(회수|추심)|압류)/s.test(text),
    deadline: /(당일|까지.{0,12}(신청|통지|제출|납입|지급|확인)|기한|기간.{0,8}내|\d+일\s*이내)/s.test(text),
    consumerDuty: /(하여야 한다|해야 한다|의무|반드시|지체 없이|통지하여야|제출하여야)/s.test(text),
  };
  const effects = extractEffects(text);
  return { signals, effects, level: levelFromEffects(effects) };
}

function groupPositionedLines(items: PositionedText[], page: number) {
  const groups: Array<Line & { fragments: PositionedText[] }> = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const existing = groups.find((line) => Math.abs(line.y - item.y) <= Math.max(2, Math.max(line.height, item.height) * .28));
    if (existing) {
      existing.fragments.push(item);
      existing.x = Math.min(existing.x, item.x);
      existing.xEnd = Math.max(existing.xEnd, item.xEnd);
      existing.height = Math.max(existing.height, item.height);
    } else groups.push({ page, x: item.x, xEnd: item.xEnd, y: item.y, height: item.height, text: "", region: "body", fragments: [item] });
  }
  return groups.map(({ fragments, ...line }) => {
    const ordered = fragments.sort((a, b) => a.x - b.x);
    let text = ordered[0]?.text ?? "";
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const gap = current.x - previous.xEnd;
      const naturalWordGap = Math.max(.8, Math.min(previous.height, current.height) * .16);
      const separator = gap > naturalWordGap && !/^[,.;:!?%)\]}>〉》」』]/.test(current.text) ? " " : "";
      text += `${separator}${current.text}`;
    }
    return { ...line, text: repairPdfWordSpacing(text) };
  }).sort((a, b) => b.y - a.y || a.x - b.x);
}

function detectColumnSplit(items: PositionedText[], pageWidth: number) {
  if (items.length < 24 || pageWidth <= 0) return null;
  const yTolerance = Math.max(2, items.map((item) => item.height).sort((a, b) => a - b)[Math.floor(items.length / 2)] * .35);
  const rows: number[] = [];
  for (const item of items) if (!rows.some((y) => Math.abs(y - item.y) <= yTolerance)) rows.push(item.y);
  let best: { split: number; score: number } | null = null;
  for (let ratio = .42; ratio <= .58; ratio += .01) {
    const split = pageWidth * ratio;
    // Measure the stable vertical whitespace itself. A wide band incorrectly
    // treats text ending at either column edge as crossing the gutter.
    const gutterHalfWidth = Math.max(1, pageWidth * .002);
    const leftChars = items.filter((item) => item.xEnd < split - gutterHalfWidth).reduce((sum, item) => sum + item.text.length, 0);
    const rightChars = items.filter((item) => item.x > split + gutterHalfWidth).reduce((sum, item) => sum + item.text.length, 0);
    const crossedRows = rows.filter((y) => items.some((item) => Math.abs(item.y - y) <= yTolerance && item.x < split + gutterHalfWidth && item.xEnd > split - gutterHalfWidth)).length;
    const crossingRatio = crossedRows / Math.max(rows.length, 1);
    const wideGapRows = rows.filter((y) => {
      const row = items.filter((item) => Math.abs(item.y - y) <= yTolerance);
      const leftEdges = row.filter((item) => item.xEnd <= split).map((item) => item.xEnd);
      const rightEdges = row.filter((item) => item.x >= split).map((item) => item.x);
      if (!leftEdges.length || !rightEdges.length) return false;
      return Math.min(...rightEdges) - Math.max(...leftEdges) >= Math.max(8, pageWidth * .015);
    }).length;
    const wideGapRatio = wideGapRows / Math.max(rows.length, 1);
    const balance = Math.min(leftChars, rightChars) / Math.max(leftChars, rightChars, 1);
    if (leftChars < 120 || rightChars < 120 || balance < .28 || crossingRatio > .12 || wideGapRatio < .1) continue;
    const score = balance + wideGapRatio - crossingRatio * 2;
    if (!best || score > best.score) best = { split, score };
  }
  return best?.split ?? null;
}

function isMarginTemplate(line: Line, pageHeight: number) {
  const text = normalize(line.text);
  const templateText = /^(?:\d{1,2}-\d{2}-\d{3,5}(?:\([^)]*\))?|준법감시인|심의필|보존본|보관용|고객용)|(?:약관[-\s]*\d+호|\d{4}[./-]\d{1,2}\s*개정)/.test(text);
  if (templateText) return true;
  const inMargin = line.y <= pageHeight * .075 || line.y >= pageHeight * .94;
  return inMargin && !boundaryPattern.test(text);
}

function groupLines(items: Array<{ str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }>, page: number, pageWidth: number, pageHeight: number) {
  const positioned = items.flatMap((item) => {
    const text = cleanExtractedText(item.str ?? "");
    if (!text || isDecorativeOrLayoutOnly(text)) return [];
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const height = Math.max(item.height ?? Math.abs(item.transform?.[3] ?? 10), 1);
    const width = Math.max(item.width ?? text.length * height * .55, 1);
    return [{ text, x, xEnd: x + width, y, height }];
  });
  const split = detectColumnSplit(positioned, pageWidth);
  if (!split) return groupPositionedLines(positioned, page).map((line) => ({ ...line, region: isMarginTemplate(line, pageHeight) ? "margin" as const : "body" as const }));

  const gutterHalfWidth = Math.max(1, pageWidth * .002);
  const spanning = positioned.filter((item) => item.x < split + gutterHalfWidth && item.xEnd > split - gutterHalfWidth);
  const columnItems = positioned.filter((item) => !spanning.includes(item));
  const left = columnItems.filter((item) => (item.x + item.xEnd) / 2 < split);
  const right = columnItems.filter((item) => (item.x + item.xEnd) / 2 >= split);
  const bodyTop = Math.max(...columnItems.map((item) => item.y));
  const bodyBottom = Math.min(...columnItems.map((item) => item.y));
  const top = spanning.filter((item) => item.y >= bodyTop);
  const bottom = spanning.filter((item) => item.y <= bodyBottom);
  const middle = spanning.filter((item) => item.y < bodyTop && item.y > bodyBottom);
  return [
    ...groupPositionedLines(top, page),
    ...groupPositionedLines([...left, ...middle.filter((item) => (item.x + item.xEnd) / 2 < split)], page),
    ...groupPositionedLines([...right, ...middle.filter((item) => (item.x + item.xEnd) / 2 >= split)], page),
    ...groupPositionedLines(bottom, page),
  ].map((line) => ({ ...line, region: isMarginTemplate(line, pageHeight) ? "margin" as const : "body" as const }));
}

function splitExplicitArticleLines(pages: Line[][]) {
  return pages.map((lines) => lines.flatMap((line) => {
    const matches = [...line.text.matchAll(explicitArticlePattern)];
    if (matches.length <= 1 && (matches[0]?.index ?? 0) === 0) return [line];
    const boundaries = matches.map((match) => match.index ?? 0).filter((index) => {
      if (index === 0) return true;
      const before = line.text.slice(0, index).trimEnd();
      const after = line.text.slice(index + matchArticleLength(line.text, index)).trimStart();
      const hasHeading = /^[（(][^）)]{1,60}[）)]/.test(after);
      return hasHeading || /[.!?。]$/.test(before);
    });
    if (!boundaries.some((index) => index > 0)) return [line];
    const starts = [...new Set([0, ...boundaries])].sort((a, b) => a - b);
    return starts.map((start, index) => cleanExtractedText(line.text.slice(start, starts[index + 1] ?? line.text.length)))
      .filter(Boolean)
      .map((text, index) => ({ ...line, y: line.y - index * .01, text }));
  }));
}

function matchArticleLength(text: string, index: number) {
  return text.slice(index).match(/^제\s*\d+\s*조(?:의\s*\d+)?/)?.[0].length ?? 0;
}

function pageBlocks(lines: Line[]) {
  if (!lines.length) return [] as Array<{ page: number; lines: string[]; marked: boolean; heading: boolean }>;
  const heights = lines.map((line) => line.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 10;
  const blocks: Array<{ page: number; lines: string[]; marked: boolean; heading: boolean }> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\d{1,4}$/.test(line.text)) continue;
    const previous = lines[index - 1];
    const gap = previous ? previous.y - line.y : 0;
    const marked = boundaryPattern.test(line.text);
    const looksLikeHeading = line.text.length <= 45 && !/[.!?。]$/.test(line.text) && gap > median * 1.4;
    if (!blocks.length || marked || looksLikeHeading || gap > median * 2.2) blocks.push({ page: line.page, lines: [line.text], marked, heading: looksLikeHeading });
    else blocks[blocks.length - 1].lines.push(line.text);
  }
  return blocks;
}

const articleMarkerPattern = /^제\s*\d+\s*조(?:의\s*\d+)?/;
const childMarkerPattern = /^(?:제\s*\d+\s*항|[①-⑳]|\(?\d+\)|\d+[.)]|[가-힣][.)])/;
const listPreamblePattern = /(다음\s*(?:각\s*)?호|다음\s*(?:각\s*)?사유|다음의\s*경우|각\s*호\s*중\s*(?:하나|어느 하나)|어느\s*하나에\s*해당)/;
const predicatePattern = /(한다|된다|있다|없다|아니한다|않는다|하여야\s*한다|해야\s*한다|할\s*수\s*있다|할\s*수\s*없다|요구할\s*수\s*있다|부담한다|지급한다|상환한다|통지한다|제출한다|확인한다|제한한다|종료한다|해지한다|본다)[.!?。]?$/;

function markerDepth(marker: string) {
  if (articleMarkerPattern.test(marker)) return 0;
  if (/^(?:제\s*\d+\s*항|[①-⑳])/.test(marker)) return 1;
  if (/^(?:\(?\d+\)|\d+[.)])/.test(marker)) return 2;
  if (/^[가-힣][.)]/.test(marker)) return 3;
  return 99;
}

function hasUnclosedDelimiter(text: string) {
  return [["(", ")"], ["[", "]"], ["（", "）"], ["「", "」"], ["『", "』"]].some(([open, close]) => text.split(open).length > text.split(close).length);
}

function isIncompleteText(text: string) {
  const value = normalize(text);
  if (!value) return true;
  if (hasUnclosedDelimiter(value)) return true;
  if (/[·,:;\-–—(（[〔]$/.test(value)) return true;
  if (/(?:경우|경우에는)[.!?。]?$/.test(value) && /(할\s*수\s*(?:있|없)|하여야\s*한다|해야\s*한다|하기로\s*한다|종료|제한|중단|해지|지급|상환|통지|책임을\s*물을\s*수\s*없)/.test(value)) return false;
  if (/(?:및|또는|거나|그리고|하거나|하는|하여|하며|하고|하되|한|때|경우에는\s*다음|부터|까지의|경우로서|위하여|따라|의하여|다음과\s*같다|다음\s*(?:각\s*)?호(?:의\s*경우)?)[.!?。]?$/.test(value)) return true;
  return value.length < 70 && !predicatePattern.test(value) && !/[.!?。]$/.test(value);
}

async function readScannedPdf(pdf: pdfjs.PDFDocumentProxy, onProgress?: (currentPage: number, totalPages: number) => void) {
  const pages: Line[][] = [];

  const encodeForOcr = (canvas: HTMLCanvasElement) => {
    const qualities = [.88, .8, .72];
    for (const quality of qualities) {
      const image = canvas.toDataURL("image/jpeg", quality).replace(/^data:image\/jpeg;base64,/, "");
      if (image.length <= 650_000) return image;
    }
    return null;
  };

  const ocrImage = async (image: string, pageNumber: number, part?: string) => {
    const response = await fetch("/api/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page: pageNumber, part, image }) });
    const result = await response.json() as { page?: number; text?: string; error?: string };
    if (!response.ok) throw new Error(result.error || `${pageNumber}쪽의 글자를 읽지 못했습니다.`);
    return result.text?.trim() ?? "";
  };

  const mergeOcrParts = (parts: string[]) => {
    const merged: string[] = [];
    for (const part of parts) {
      const next = part.split(/\r?\n/).map(cleanExtractedText).filter(Boolean);
      let duplicateCount = 0;
      for (let size = Math.min(12, merged.length, next.length); size > 0; size--) {
        if (merged.slice(-size).every((line, index) => compact(line) === compact(next[index]))) {
          duplicateCount = size;
          break;
        }
      }
      merged.push(...next.slice(duplicateCount));
    }
    return merged;
  };

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    // Dense scanned contracts need enough pixels for small Korean glyphs. If the
    // resulting JPEG is too large, retain that resolution and OCR overlapping tiles.
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("스캔 페이지 이미지를 만들지 못했습니다.");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const fullImage = encodeForOcr(canvas);
    const recognized: string[] = [];
    if (fullImage) {
      recognized.push(await ocrImage(fullImage, pageNumber));
    } else {
      let encodedTiles: string[] | null = null;
      for (const tileCount of [2, 4]) {
        const overlap = Math.min(80, Math.round(canvas.height * .04));
        const tileHeight = Math.ceil((canvas.height + overlap * (tileCount - 1)) / tileCount);
        const candidates: string[] = [];
        for (let part = 0; part < tileCount; part++) {
          const sourceY = Math.min(part * (tileHeight - overlap), canvas.height - tileHeight);
          const tile = document.createElement("canvas");
          tile.width = canvas.width; tile.height = tileHeight;
          const tileContext = tile.getContext("2d", { alpha: false });
          if (!tileContext) throw new Error("스캔 페이지 이미지를 나누지 못했습니다.");
          tileContext.fillStyle = "#fff"; tileContext.fillRect(0, 0, tile.width, tile.height);
          tileContext.drawImage(canvas, 0, sourceY, canvas.width, tileHeight, 0, 0, tile.width, tile.height);
          const tileImage = encodeForOcr(tile);
          tile.width = 1; tile.height = 1;
          if (!tileImage) { candidates.length = 0; break; }
          candidates.push(tileImage);
        }
        if (candidates.length === tileCount) { encodedTiles = candidates; break; }
      }
      if (!encodedTiles) throw new Error(`${pageNumber}쪽 이미지의 용량을 OCR 제한 안으로 줄이지 못했습니다.`);
      for (let part = 0; part < encodedTiles.length; part++) recognized.push(await ocrImage(encodedTiles[part], pageNumber, `${part + 1}/${encodedTiles.length}`));
    }
    const lines = mergeOcrParts(recognized);
    pages.push(lines.map((text, index) => ({ page: pageNumber, x: 0, xEnd: viewport.width, y: (lines.length - index) * 12, height: 10, text, region: "body" as const })));
    canvas.width = 1; canvas.height = 1; page.cleanup(); onProgress?.(pageNumber, pdf.numPages);
  }
  return pages;
}

export async function parseContract(file: File, onPageProgress?: (currentPage: number, totalPages: number) => void, onOcrProgress?: (currentPage: number, totalPages: number) => void): Promise<{ documentHash: string; clauses: RawClause[]; basicInfo: BasicInfo[]; notices: DocumentNotice[] }> {
  const data = await file.arrayBuffer();
  const documentHash = await sha256(data);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  let pages: Line[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(groupLines(content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }>, pageNumber, page.view[2] - page.view[0], page.view[3] - page.view[1]));
    onPageProgress?.(pageNumber, pdf.numPages);
  }
  let textLength = pages.flat().reduce((sum, line) => sum + line.text.length, 0);
  if (textLength < Math.max(80, pdf.numPages * 20)) {
    onOcrProgress?.(0, pdf.numPages);
    pages = await readScannedPdf(pdf, onOcrProgress);
    textLength = pages.flat().reduce((sum, line) => sum + line.text.length, 0);
    if (textLength < Math.max(80, pdf.numPages * 20)) throw new Error("OCR로도 글자를 충분히 읽지 못했어요. 더 선명한 PDF로 다시 시도해 주세요.");
  }
  pages = splitExplicitArticleLines(pages);

  const edgeCounts = new Map<string, number>();
  for (const lines of pages) for (const line of [...lines.slice(0, 2), ...lines.slice(-2)]) edgeCounts.set(compact(line.text), (edgeCounts.get(compact(line.text)) ?? 0) + 1);
  const repeated = new Set([...edgeCounts].filter(([key, count]) => key.length > 2 && count >= Math.max(3, Math.ceil(pdf.numPages * .45))).map(([key]) => key));
  const separated = extractNonClauses(pages);
  const blocks = pages.flatMap((lines) => pageBlocks(lines.filter((line) => line.region === "body" && !repeated.has(compact(line.text)) && !separated.excluded.has(`${line.page}:${compact(line.text)}`)))).map((block, index) => ({ ...block, id: `P${String(block.page).padStart(3, "0")}_B${String(index + 1).padStart(4, "0")}` }));
  const sourceBlockMap = new Map(blocks.map((block) => [block.id, normalize(block.lines.join(" "))]));

  const merged: Array<{ page: number; endPage: number; text: string; sourceBlockIds: string[]; sourceArticle: string | null; marked: boolean; heading: boolean }> = [];
  let activeListParent = -1;
  let activeListParentDepth = 99;
  let activeArticle: string | null = null;
  for (const block of blocks) {
    const text = normalize(block.lines.join(" "));
    if (!text || text.length < 4 || isDecorativeOrLayoutOnly(text) || isNonClauseBoilerplate(text)) continue;
    const marker = text.match(markerPattern)?.[1] ?? "";
    const beginsArticle = articleMarkerPattern.test(marker);
    if (beginsArticle) activeArticle = marker.replace(/\s+/g, "");
    const beginsChild = childMarkerPattern.test(marker) && !beginsArticle;
    if (activeListParent >= 0) {
      const parent = merged[activeListParent];
      const depth = markerDepth(marker);
      if (!beginsArticle && ((beginsChild && depth > activeListParentDepth) || (!beginsChild && !block.heading))) {
        parent.text = normalize(`${parent.text} ${text}`); parent.endPage = block.page; parent.sourceBlockIds.push(block.id);
        continue;
      }
      activeListParent = -1; activeListParentDepth = 99;
    }
    const previous = merged[merged.length - 1];
    const previousIsIncomplete = !!previous && isIncompleteText(previous.text);
    const crossesAdjacentPage = !!previous && block.page === previous.endPage + 1;
    const sameClause = !!previous && !beginsArticle && ((previousIsIncomplete && !block.heading) || (!block.marked && !block.heading && previous.endPage === block.page && (previous.marked || previous.heading)) || (crossesAdjacentPage && previousIsIncomplete));
    if (sameClause) {
      previous.text = normalize(`${previous.text} ${text}`); previous.endPage = block.page; previous.sourceBlockIds.push(block.id);
      if (listPreamblePattern.test(previous.text)) { activeListParent = merged.length - 1; activeListParentDepth = markerDepth(previous.text.match(markerPattern)?.[1] ?? ""); }
    } else {
      merged.push({ page: block.page, endPage: block.page, text, sourceBlockIds: [block.id], sourceArticle: activeArticle, marked: block.marked, heading: block.heading });
      if (listPreamblePattern.test(text)) { activeListParent = merged.length - 1; activeListParentDepth = markerDepth(marker); }
    }
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
    const sourceText = block.sourceBlockIds.map((blockId) => sourceBlockMap.get(blockId)).filter((value): value is string => !!value).join(" ");
    if (!sourceText || isIncompleteText(sourceText)) continue;
    const sourceClauseId = `${marker}_${textHash.slice(0, 12).toUpperCase()}`;
    clauses.push({ id, page: block.page, pageEnd: block.endPage, order: clauses.length, marker, sourceArticle: block.sourceArticle, text: sourceText, original: sourceText.slice(0, 1200), sourceBlockIds: block.sourceBlockIds, sourceClauseIds: [sourceClauseId], ...risk });
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
