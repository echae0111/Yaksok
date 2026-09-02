"use client";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { BasicInfo, DocumentNotice, RawClause } from "./contract-parser";
import CostCalculator from "./cost-calculator";

type Status = "idle" | "analyzing" | "done" | "error";
type GlossaryTerm = { term: string; definition: string };
type Item = { id: string; marker: string; level: "danger" | "caution" | "important" | "general"; title: string; core: string; easyExplanation: string; impact: string; checkPoint: string; action: string; original: string; page: number | null; sourceBlockIds: string[]; sourceClauseIds: string[]; effects: RawClause["effects"] };
type Analysis = { documentType: string; summary: string; items: Item[]; glossary: GlossaryTerm[]; basicInfo: BasicInfo[]; notices: DocumentNotice[] };
type ClauseExplanation = { clauseId: string; relevant: boolean; title: string; core: string; easyExplanation: string; impact: string; checkPoint: string; action: string };
type Citation = { original: string; page: number | null; relevance: string };
type Message = { role: "user" | "assistant"; text: string; citations?: Citation[]; notFound?: boolean; glossary?: GlossaryTerm[] };

const suggestions = ["해지하면 손해인가요?", "자동 연장은 언제 막나요?", "보장 안 되는 경우는?", "가장 불리한 조건은?"];
const financeQuizzes = [
  { question: "대출 만기일은 어떤 날일까요?", choices: ["대출 신청일", "남은 대출금을 모두 갚기로 한 마지막 날", "이자를 처음 내는 날"], answer: 1, explanation: "대출 만기일은 원칙적으로 남은 원금을 모두 갚아야 하는 마지막 날이에요." },
  { question: "변동금리 대출의 특징은 무엇일까요?", choices: ["금리가 계약 내내 같아요", "정해진 기준에 따라 금리가 바뀔 수 있어요", "이자를 내지 않아도 돼요"], answer: 1, explanation: "변동금리는 기준금리 등이 달라지면 내가 내는 이자도 오르거나 내릴 수 있어요." },
  { question: "중도상환수수료는 언제 생길 수 있을까요?", choices: ["대출금을 약속보다 일찍 갚을 때", "대출금을 늦게 갚을 때", "계좌를 새로 만들 때"], answer: 0, explanation: "대출금을 계약 기간보다 일찍 갚을 때 생길 수 있는 비용이에요. 적용 기간과 계산 방법을 확인해야 해요." },
  { question: "연체이자는 무엇일까요?", choices: ["돈을 늦게 갚을 때 추가로 붙는 이자", "예금에 붙는 이자", "대출 신청 수수료"], answer: 0, explanation: "정해진 날까지 돈을 내지 못하면 원래 이자 외에 추가 부담이 생길 수 있어요." },
  { question: "고정금리의 뜻으로 맞는 것은?", choices: ["계약에서 정한 기간 동안 금리가 고정돼요", "매달 금리가 무조건 내려가요", "원금을 갚지 않아도 돼요"], answer: 0, explanation: "고정금리는 약속한 기간 동안 적용 금리가 바뀌지 않아 이자 부담을 예상하기 쉬워요." },
  { question: "자동 연장을 막고 싶다면 가장 먼저 볼 것은?", choices: ["계약서의 연장 거절 통지 기한", "금융회사 광고", "계약서의 글자 크기"], answer: 0, explanation: "자동 연장 조항에는 언제까지 거절 의사를 알려야 하는지가 적혀 있으므로 그 기한이 중요해요." },
  { question: "대출의 원금은 무엇일까요?", choices: ["처음 빌린 돈 자체", "연체할 때 붙는 비용", "매년 내는 카드 연회비"], answer: 0, explanation: "원금은 이자나 수수료를 제외하고 금융회사에서 실제로 빌린 돈이에요." },
  { question: "거치기간에는 보통 무엇을 확인해야 할까요?", choices: ["원금을 갚지 않고 이자만 내는 기간인지", "신용카드를 못 쓰는 기간인지", "계약서를 보관하는 기간인지"], answer: 0, explanation: "거치기간에는 원금 상환을 미루고 이자만 내는 경우가 많아요. 종료 뒤 상환액이 커질 수 있어 조건을 확인해야 해요." },
  { question: "만기일시상환 방식은 무엇일까요?", choices: ["원금을 매달 똑같이 나눠 갚는 방식", "만기까지 이자를 내다가 원금을 마지막에 한꺼번에 갚는 방식", "이자를 전혀 내지 않는 방식"], answer: 1, explanation: "만기일시상환은 대출 기간 중 주로 이자를 내고, 만기일에 원금을 한꺼번에 갚는 방식이에요." },
  { question: "우대금리는 어떤 의미일까요?", choices: ["조건을 충족하면 금리를 낮춰주는 혜택", "연체하면 추가되는 금리", "모든 고객에게 똑같이 적용되는 세금"], answer: 0, explanation: "급여 이체나 카드 사용 같은 조건을 충족하면 대출금리를 낮춰주는 혜택이에요. 유지 조건도 함께 확인해야 해요." },
  { question: "가산금리는 무엇일까요?", choices: ["기준금리에 금융회사가 위험·비용 등을 반영해 더하는 금리", "예금자에게 주는 선물", "대출 원금을 깎아주는 비율"], answer: 0, explanation: "대출금리는 보통 기준금리에 가산금리를 더하고 우대금리를 빼는 식으로 정해져요." },
  { question: "기한이익 상실의 의미로 알맞은 것은?", choices: ["상환기한이 자동으로 늘어나는 것", "남은 돈을 약속한 만기보다 일찍 한꺼번에 갚으라는 요구를 받을 수 있는 것", "이자가 모두 면제되는 것"], answer: 1, explanation: "연체 등 계약에서 정한 사유가 생기면 원래 만기까지 기다리지 않고 남은 채무 전액을 요구받을 수 있다는 뜻이에요." },
  { question: "담보는 왜 제공할까요?", choices: ["빚을 갚지 못할 때 채권 회수에 쓰기 위해", "대출 계약을 자동 취소하기 위해", "이자를 무조건 없애기 위해"], answer: 0, explanation: "담보는 돈을 갚지 못하는 상황에 대비해 채권자가 처분하거나 권리를 행사할 수 있게 제공하는 재산이에요." },
  { question: "근저당권을 볼 때 특히 확인할 것은?", choices: ["담보 범위와 채권최고액", "계약서 종이 색상", "은행 영업점의 크기"], answer: 0, explanation: "근저당권은 어떤 채무를 어디까지 담보하는지, 채권최고액이 얼마인지 확인하는 것이 중요해요." },
  { question: "채권최고액은 무엇을 뜻할까요?", choices: ["실제로 빌린 원금과 언제나 같은 금액", "근저당권으로 담보되는 채권의 최대 한도", "매달 갚아야 하는 최소 금액"], answer: 1, explanation: "채권최고액은 담보로 보장하는 최대 범위예요. 실제 대출 원금보다 크게 정해질 수도 있어요." },
  { question: "보증인이 있는 계약에서 꼭 확인할 것은?", choices: ["보증 책임의 범위와 한도", "보증인의 직업만", "계약서의 페이지 수"], answer: 0, explanation: "보증인은 채무자가 갚지 못할 때 대신 책임질 수 있으므로 어떤 채무를 얼마까지 책임지는지 확인해야 해요." },
  { question: "보험의 면책사항은 무엇일까요?", choices: ["보험회사가 보험금을 지급하지 않을 수 있는 경우", "보험료를 할인해 주는 조건", "보험 계약자의 주소"], answer: 0, explanation: "면책사항은 사고가 나도 계약에서 정한 이유로 보험금이 지급되지 않을 수 있는 경우를 말해요." },
  { question: "갱신형 보험의 특징은 무엇일까요?", choices: ["갱신할 때 보험료나 조건이 달라질 수 있어요", "한 번 가입하면 보험료가 절대 바뀌지 않아요", "보험료를 한 번만 내면 돼요"], answer: 0, explanation: "갱신형 보험은 정해진 주기마다 계약이 갱신되며 나이와 위험률 등에 따라 보험료가 달라질 수 있어요." },
  { question: "자기부담금은 무엇일까요?", choices: ["손해 중 가입자가 직접 부담하는 금액", "보험회사가 대신 내는 세금", "가입하면 돌려받는 축하금"], answer: 0, explanation: "보험금을 청구해도 손해액 전부가 아니라 계약에서 정한 일부는 가입자가 직접 부담할 수 있어요." },
  { question: "보험료를 오래 내지 않으면 생길 수 있는 일은?", choices: ["계약 효력이 정지되거나 해지될 수 있어요", "보장금액이 자동으로 늘어요", "모든 보험료가 환급돼요"], answer: 0, explanation: "납입 유예기간이 지난 뒤에도 보험료를 내지 않으면 계약이 실효되거나 해지될 수 있어요. 정확한 조건은 약관을 확인해야 해요." },
  { question: "청약철회 기간을 확인해야 하는 이유는?", choices: ["정해진 기간 안에 계약을 철회할 권리가 있을 수 있어서", "대출금리가 자동으로 오르기 때문에", "계약번호가 바뀌기 때문에"], answer: 0, explanation: "청약철회는 정해진 기간과 조건을 지켜야 하므로 계약서에 적힌 가능 기간과 방법을 확인해야 해요." },
  { question: "카드 리볼빙을 이용하면 어떻게 될까요?", choices: ["이번 달 결제액 일부를 다음 달로 넘기고 수수료가 붙을 수 있어요", "카드 대금이 모두 면제돼요", "예금 이자가 늘어요"], answer: 0, explanation: "리볼빙은 일부 결제금액을 다음 달로 미루는 서비스예요. 남은 금액에 수수료가 붙고 빚이 계속 쌓일 수 있어요." },
  { question: "할부수수료를 비교할 때 무엇을 봐야 할까요?", choices: ["할부 기간과 적용 수수료율", "카드 디자인", "영수증 글꼴"], answer: 0, explanation: "할부 기간이 길어질수록 전체 수수료 부담이 커질 수 있으므로 기간과 수수료율을 함께 확인해야 해요." },
  { question: "현금서비스의 성격으로 알맞은 것은?", choices: ["신용카드로 받는 단기 대출", "내 예금을 찾는 것", "무료 포인트를 받는 것"], answer: 0, explanation: "현금서비스는 카드사에서 단기간 돈을 빌리는 금융서비스라서 이자율과 신용 영향 여부를 확인해야 해요." },
  { question: "자동이체가 실패했을 때 가장 먼저 할 일은?", choices: ["납부 여부와 계좌 잔액을 확인하고 필요한 금액을 납부하기", "다음 달까지 아무것도 하지 않기", "계약서를 버리기"], answer: 0, explanation: "잔액 부족 등으로 자동이체가 실패하면 연체로 이어질 수 있으므로 납부 상태와 재출금 일정을 바로 확인하는 것이 좋아요." },
  { question: "신용점수에 영향을 줄 수 있는 행동은?", choices: ["대출금을 장기간 연체하는 것", "계약서를 읽는 것", "통장 비밀번호를 바꾸는 것"], answer: 0, explanation: "장기 연체 등은 신용정보에 반영될 수 있어 이후 대출이나 카드 이용에 영향을 줄 수 있어요." },
  { question: "중도해지 전에 확인할 내용으로 가장 알맞은 것은?", choices: ["해지 비용, 환급금, 제한 조건", "회사 로고 색상", "상담원의 이름만"], answer: 0, explanation: "계약을 중간에 끝내면 수수료가 생기거나 돌려받는 금액이 적을 수 있으므로 관련 조건을 먼저 확인해야 해요." },
  { question: "변제충당순서는 무엇을 정한 내용일까요?", choices: ["낸 돈을 비용·이자·원금 등에 어떤 순서로 처리할지", "대출 신청자를 부르는 순서", "보험 가입 순서"], answer: 0, explanation: "상환한 돈이 비용, 이자, 원금 중 어디부터 갚은 것으로 처리되는지를 정한 순서예요." },
  { question: "개인정보 제3자 제공 동의에서 확인할 것은?", choices: ["누구에게 어떤 정보를 왜, 얼마나 오래 제공하는지", "문서의 여백 크기", "금융회사 건물 주소만"], answer: 0, explanation: "제공받는 곳, 제공 목적, 정보 항목, 보유 기간을 확인해야 내 정보가 어떻게 쓰이는지 알 수 있어요." },
  { question: "대출 상환일을 놓치지 않으려면 가장 유용한 정보는?", choices: ["정확한 납부일과 자동이체 계좌", "계약서 표지 사진", "은행 광고 문구"], answer: 0, explanation: "납부일과 출금 계좌를 확인하고 미리 잔액을 준비하면 의도하지 않은 연체를 줄일 수 있어요." },
];
const QUIZ_SET_SIZE = 10;
const CLAUSES_PER_BATCH = 8;
const BATCH_CONCURRENCY = 1;
type CachedClauseExplanation = { explanation: ClauseExplanation; glossary: GlossaryTerm[] };
type AnalysisProgress = { phase: string; completed: number; total: number; percent: number };
type DuplicateCandidate = { id: string; source: string; title: string; summary: string; effect: string };
type DuplicateDecision = { keepId: string; mergeIds: string[] };
class RateLimitError extends Error {
  constructor(message: string, public retryAfterSeconds: number, public quotaExhausted: boolean) { super(message); }
}
const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
function formatProgressCount(progress: AnalysisProgress) {
  if (!progress.total) return "문서 확인 중";
  return progress.phase.startsWith("PDF ") ? `${progress.completed} / ${progress.total}쪽` : `${progress.completed} / ${progress.total}개 조항`;
}

async function readApiJson<T>(response: Response): Promise<T & { error?: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!contentType.includes("application/json")) throw new Error("분석 연결이 중간에 끊겼어요. 잠시 후 다시 시도해 주세요.");
  try { return JSON.parse(text) as T & { error?: string }; }
  catch { throw new Error("분석 결과를 읽지 못했어요. 잠시 후 다시 시도해 주세요."); }
}

async function requestClauseBatch(clauses: RawClause[]) {
  const input = clauses.map(({ id, page, marker, text }) => ({ id, page, marker, text }));
  const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clauses: input }) });
  const data = await readApiJson<{ explanations: ClauseExplanation[]; glossary: GlossaryTerm[]; errorCode?: string; retryAfterSeconds?: number }>(response);
  if (response.status === 429) throw new RateLimitError(data.error || "분석 요청이 잠시 제한됐습니다.", data.retryAfterSeconds ?? 0, data.errorCode === "quota_exhausted");
  if (!response.ok) throw new Error(data.error || "계약서 조항을 설명하지 못했어요.");
  if (data.explanations.length !== clauses.length) throw new Error("일부 조항 설명이 누락됐어요.");
  return data;
}

async function requestWithRateLimitRetry(clauses: RawClause[], onPause: (seconds: number) => void) {
  const fallbackDelays = [10, 30, 60];
  for (let attempt = 0; ; attempt++) {
    try { return await requestClauseBatch(clauses); }
    catch (reason) {
      if (!(reason instanceof RateLimitError) || reason.quotaExhausted || attempt >= fallbackDelays.length) throw reason;
      const seconds = Math.max(reason.retryAfterSeconds, fallbackDelays[attempt]);
      onPause(seconds);
      await sleep(seconds * 1000);
    }
  }
}

async function explainClauseBatch(clauses: RawClause[], onPause: (seconds: number) => void) {
  try { return await requestWithRateLimitRetry(clauses, onPause); }
  catch (reason) {
    if (reason instanceof RateLimitError) throw reason;
    try { return await requestWithRateLimitRetry(clauses, onPause); }
    catch (reason) {
      if (reason instanceof RateLimitError) throw reason;
      const individual: Array<Awaited<ReturnType<typeof requestClauseBatch>>> = [];
      for (const clause of clauses) {
        try { individual.push(await requestWithRateLimitRetry([clause], onPause)); }
        catch (reason) {
          if (reason instanceof RateLimitError) throw reason;
          individual.push(await requestWithRateLimitRetry([clause], onPause));
        }
      }
      return {
        explanations: individual.flatMap((result) => result.explanations),
        glossary: individual.flatMap((result) => result.glossary),
      };
    }
  }
}

function TermHelp({ term, definition }: GlossaryTerm) {
  const [open, setOpen] = useState(false);
  return <span className={`termHelp ${open ? "open" : ""}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="termWord" aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((value) => !value)}>{term}</button>
    <span className="termDefinition" role="tooltip"><b>{term}</b><span>{definition}</span></span>
  </span>;
}

function FinancialText({ text, glossary = [], highlightOnly, firstOccurrenceOnly = false }: { text: string; glossary?: GlossaryTerm[]; highlightOnly?: Set<string>; firstOccurrenceOnly?: boolean }) {
  const everydayTerms = new Set(["금융회사", "금융기관", "은행", "회사", "채무자", "계약자", "대출받는 사람"]);
  const definitions = new Map(glossary
    .filter(({ term, definition }) => {
      const normalized = term.trim();
      return definition.trim() && !everydayTerms.has(normalized) && normalized.length >= 2 && (!highlightOnly || highlightOnly.has(normalized));
    })
    .map((entry) => [entry.term.trim(), entry.definition.trim()]));
  const terms = [...definitions.keys()].sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const parts: ReactNode[] = [];
  const highlighted = new Set<string>();
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const term = match[0];
    const start = match.index;
    if (start > cursor) parts.push(<span key={`text-${cursor}`}>{text.slice(cursor, start)}</span>);
    if (!firstOccurrenceOnly || !highlighted.has(term)) {
      parts.push(<TermHelp key={`term-${start}`} term={term} definition={definitions.get(term)!} />);
      highlighted.add(term);
    } else parts.push(<span key={`text-term-${start}`}>{term}</span>);
    cursor = start + term.length;
  }
  if (cursor < text.length) parts.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  return <>{parts}</>;
}

type ClauseTextField = "core" | "easyExplanation" | "impact" | "checkPoint" | "action";
function getClauseHighlightPlan(item: Item, glossary: GlossaryTerm[]) {
  const fields: ClauseTextField[] = ["core", "easyExplanation", "impact", "checkPoint", "action"];
  const plan: Record<ClauseTextField | "title", Set<string>> = {
    title: new Set(), core: new Set(), easyExplanation: new Set(), impact: new Set(), checkPoint: new Set(), action: new Set(),
  };
  for (const { term } of glossary) {
    const normalized = term.trim();
    if (!normalized) continue;
    const firstBodyField = fields.find((field) => item[field].includes(normalized));
    if (firstBodyField) plan[firstBodyField].add(normalized);
    else if (item.title.includes(normalized)) plan.title.add(normalized);
  }
  return plan;
}

function ReadableOriginal({ text }: { text: string }) {
  const cleaned = text.replace(/[□■�\u0000]+/g, " ").replace(/\s+/g, " ").trim();
  const hadBrokenGlyphs = cleaned !== text.replace(/\s+/g, " ").trim();
  if (!cleaned) return <span className="unreadableOriginal">PDF 글꼴 문제로 이 원문은 글자를 읽을 수 없어요.</span>;
  return <>{cleaned}{hadBrokenGlyphs && <span className="originalWarning"> · 일부 글자는 PDF에서 읽히지 않아 제외했어요.</span>}</>;
}

function ExplanationSections({ item, glossary }: { item: Item; glossary: GlossaryTerm[] }) {
  const plan = getClauseHighlightPlan(item, glossary);
  const sections: Array<[string, string, ClauseTextField]> = [["핵심 내용", item.core, "core"], ["쉽게 설명하면", item.easyExplanation, "easyExplanation"], ["나에게 어떤 영향이 있나요?", item.impact, "impact"], ["확인할 점", item.checkPoint, "checkPoint"]].filter(([, value]) => value.trim());
  return <div className="explanationSections">{sections.map(([label, value, field]) => <div className="explanationRow" key={label}><b>{label}</b><p><FinancialText text={value} glossary={glossary} highlightOnly={plan[field]} firstOccurrenceOnly /></p></div>)}</div>;
}

function WaitingQuiz() {
  const [quizSet, setQuizSet] = useState(0);
  const [quizIndex, setQuizIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const setCount = Math.ceil(financeQuizzes.length / QUIZ_SET_SIZE);
  const quiz = financeQuizzes[(quizSet * QUIZ_SET_SIZE + quizIndex) % financeQuizzes.length];
  const resultComment = correctCount === QUIZ_SET_SIZE
    ? "완벽해요! 계약서 핵심 용어를 아주 탄탄하게 알고 있어요."
    : correctCount >= 8
      ? "훌륭해요! 중요한 금융 개념을 대부분 정확히 이해하고 있어요."
      : correctCount >= 6
        ? "좋아요! 헷갈린 내용만 한 번 더 보면 훨씬 든든해질 거예요."
        : "괜찮아요. 지금 확인한 개념부터 하나씩 익혀가면 됩니다.";
  const choose = (index: number) => {
    if (selected !== null) return;
    setSelected(index);
    if (index === quiz.answer) setCorrectCount((count) => count + 1);
  };
  const next = () => {
    if (quizIndex === QUIZ_SET_SIZE - 1) setFinished(true);
    else setQuizIndex((current) => current + 1);
    setSelected(null);
  };
  const restart = () => {
    setQuizSet((current) => (current + 1) % setCount);
    setQuizIndex(0); setSelected(null); setCorrectCount(0); setFinished(false);
  };
  return <section className="waitingQuiz" aria-label="기다리는 동안 푸는 금융 상식 퀴즈">
    <div className="quizHead"><span>기다리는 동안</span><b>금융 상식 퀴즈</b><small>{finished ? "10 / 10" : `${quizIndex + 1} / ${QUIZ_SET_SIZE}`}</small></div>
    {finished ? <div className="quizScore">
      <span>10문제 완료</span><strong>{correctCount * 10}점</strong>
      <div><b>✓ 맞음 {correctCount}개</b><b>× 틀림 {QUIZ_SET_SIZE - correctCount}개</b></div>
      <p>{resultComment}</p>
      <button type="button" onClick={(event) => { event.stopPropagation(); restart(); }}>새로운 10문제 풀기 →</button>
    </div> : <>
      <p>{quiz.question}</p>
      <div className="quizChoices">{quiz.choices.map((choice, index) => <button type="button" key={choice} disabled={selected !== null} className={selected === null ? "" : index === quiz.answer ? "correct" : selected === index ? "wrong" : ""} onClick={(event) => { event.stopPropagation(); choose(index); }}>{choice}</button>)}</div>
      {selected !== null && <div className={`quizResult ${selected === quiz.answer ? "correct" : "wrong"}`}><b>{selected === quiz.answer ? "정답이에요!" : "아쉬워요. 정답을 확인해 보세요."}</b><span>{quiz.explanation}</span><button type="button" onClick={(event) => { event.stopPropagation(); next(); }}>{quizIndex === QUIZ_SET_SIZE - 1 ? "결과 보기 →" : "다음 문제 →"}</button></div>}
    </>}
  </section>;
}

function similarityText(value: string) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/바뀌(?:는|어|었|ㄹ|게|다|ㅂ니다)?|변경(?:되는|되어|됐다|됩니다)?/g, "변경")
    .replace(/갚(?:는|아야|으면|습니다)?|상환(?:하는|해야|합니다)?/g, "상환")
    .replace(/받(?:는|았|습니다)?|교부(?:받|하는|합니다)?/g, "교부")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function bigrams(value: string) {
  const compact = similarityText(value).replace(/\s/g, "");
  return new Set(Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2)));
}

function diceSimilarity(left: string, right: string) {
  const a = bigrams(left); const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((gram) => b.has(gram)).length;
  return (2 * overlap) / (a.size + b.size);
}

function buildDuplicateCandidateGroups(items: Item[]) {
  const parent = items.map((_, index) => index);
  const explicitCounts = items.map((item) => item.marker.startsWith("BLOCK") ? 0 : 1);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const unite = (left: number, right: number) => {
    const a = find(left); const b = find(right);
    if (a === b || explicitCounts[a] + explicitCounts[b] > 1) return;
    parent[b] = a; explicitCounts[a] += explicitCounts[b];
  };
  const compact = items.map((item) => ({ title: similarityText(`${item.title} ${item.core}`), effect: similarityText(item.impact) }));
  for (let left = 0; left < items.length; left++) for (let right = left + 1; right < items.length; right++) {
    if (!items[left].marker.startsWith("BLOCK") && !items[right].marker.startsWith("BLOCK")) continue;
    const titleScore = diceSimilarity(compact[left].title, compact[right].title);
    const effectScore = diceSimilarity(compact[left].effect, compact[right].effect);
    const leftTokens = new Set(compact[left].title.split(" ").filter((token) => token.length >= 3));
    const sharedTopic = compact[right].title.split(" ").some((token) => token.length >= 3 && leftTokens.has(token));
    if (titleScore >= .38 || (sharedTopic && titleScore >= .22 && effectScore >= .18)) unite(left, right);
  }
  const groups = new Map<number, number[]>();
  items.forEach((_, index) => { const root = find(index); groups.set(root, [...(groups.get(root) ?? []), index]); });
  return [...groups.values()].filter((indexes) => indexes.length >= 2).flatMap((indexes) => {
    const chunks: DuplicateCandidate[][] = [];
    for (let offset = 0; offset < indexes.length; offset += 10) chunks.push(indexes.slice(offset, offset + 10).map((index) => ({ id: items[index].id, source: items[index].marker, title: items[index].title, summary: items[index].core, effect: items[index].impact })));
    return chunks.filter((group) => group.length >= 2);
  });
}

function mergeSimilarItems(items: Item[], decisions: DuplicateDecision[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const removed = new Set<string>();
  for (const decision of decisions) {
    const members = [decision.keepId, ...decision.mergeIds].map((id) => byId.get(id)).filter((item): item is Item => !!item && !removed.has(item.id));
    if (members.length < 2 || members.filter((item) => !item.marker.startsWith("BLOCK")).length > 1) continue;
    const effectKeys = members.map((item) => [...item.effects].sort().join("|"));
    if (new Set(effectKeys).size !== 1) continue;
    const normalizedSources = members.map((item) => similarityText(item.original));
    const longestSource = normalizedSources.reduce((longest, value) => value.length > longest.length ? value : longest, "");
    if (normalizedSources.some((value) => !longestSource.includes(value))) continue;
    const keep = members.find((item) => !item.marker.startsWith("BLOCK")) ?? byId.get(decision.keepId);
    if (!keep) continue;
    const originals = [...new Set(members.map((item) => item.original.trim()).filter(Boolean))];
    const sourceBlockIds = [...new Set(members.flatMap((item) => item.sourceBlockIds))];
    const sourceClauseIds = [...new Set(members.flatMap((item) => item.sourceClauseIds))];
    const effects = [...new Set(members.flatMap((item) => item.effects))];
    const pages = [...new Set(members.map((item) => item.page).filter((page): page is number => page !== null))];
    byId.set(keep.id, { ...keep, original: originals.join("\n\n"), sourceBlockIds, sourceClauseIds, effects, page: pages.length === 1 ? pages[0] : null });
    members.filter((item) => item.id !== keep.id).forEach((item) => removed.add(item.id));
  }
  return items.filter((item) => !removed.has(item.id)).map((item) => byId.get(item.id) ?? item);
}

function auditCoverage(expectedSourceClauseIds: Set<string>, items: Item[]) {
  const covered = new Set(items.flatMap((item) => item.sourceClauseIds));
  return [...expectedSourceClauseIds].filter((id) => !covered.has(id));
}

function hasUnsupportedInference(explanation: ClauseExplanation, original: string) {
  const generated = `${explanation.title} ${explanation.core} ${explanation.easyExplanation} ${explanation.impact} ${explanation.checkPoint} ${explanation.action}`;
  const checks: Array<[RegExp, RegExp]> = [
    [/손해배상|배상\s*책임/, /손해배상|손해를.{0,8}배상/],
    [/즉시.{0,10}(상환|갚|변제)/, /즉시|곧.{0,8}(상환|변제)/],
    [/추가\s*담보/, /추가\s*담보|담보.{0,8}(추가|보충)/],
    [/계약\s*위반/, /계약\s*위반|위반한\s*경우/],
    [/신용.{0,6}불이익/, /신용정보|신용도|신용점수|신용.{0,6}불이익/],
    [/대출.{0,6}(회수|회수당)/, /대출.{0,6}회수|채권.{0,6}회수/],
    [/권리.{0,6}(상실|잃)/, /권리.{0,6}(상실|잃)/],
  ];
  return checks.some(([claim, support]) => claim.test(generated) && !support.test(original));
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progress, setProgress] = useState<AnalysisProgress>({ phase: "PDF 내용을 읽고 있어요", completed: 0, total: 0, percent: 4 });

  useEffect(() => {
    if (status !== "analyzing") return;
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const reset = () => { setStatus("idle"); setFile(null); setAnalysis(null); setError(""); setMessages([]); setShowAll(false); setElapsedSeconds(0); setProgress({ phase: "PDF 내용을 읽고 있어요", completed: 0, total: 0, percent: 4 }); if (inputRef.current) inputRef.current.value = ""; };
  const analyze = async (selected?: File) => {
    if (!selected) return;
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) { setError("PDF 파일만 분석할 수 있어요."); setStatus("error"); return; }
    if (selected.size > 10 * 1024 * 1024) { setError("파일은 10MB 이하로 올려 주세요."); setStatus("error"); return; }
    setFile(selected); setError(""); setAnalysis(null); setMessages([]); setElapsedSeconds(0); setProgress({ phase: "PDF 내용을 읽고 있어요", completed: 0, total: 0, percent: 4 }); setStatus("analyzing");
    try {
      // PDF 처리 코드는 파일을 선택한 뒤에만 불러와 첫 화면을 가볍게 유지합니다.
      const { ANALYSIS_VERSION, getCachedAnalysis, parseContract, setCachedAnalysis } = await import("./contract-parser");
      const parsed = await parseContract(selected, (currentPage, totalPages) => setProgress({ phase: `PDF ${currentPage} / ${totalPages}쪽을 읽고 있어요`, completed: currentPage, total: totalPages, percent: 5 + Math.round((currentPage / totalPages) * 12) }), (currentPage, totalPages) => setProgress({ phase: `스캔된 페이지의 글자를 인식하고 있어요 (${currentPage} / ${totalPages}쪽)`, completed: currentPage, total: totalPages, percent: 14 + Math.round((currentPage / totalPages) * 4) }));
      setProgress({ phase: "조항을 나누고 저장된 결과를 확인하고 있어요", completed: 0, total: parsed.clauses.length, percent: 18 });
      const cacheKey = `${parsed.documentHash}:${ANALYSIS_VERSION}`;
      const cached = await getCachedAnalysis<Analysis>(cacheKey);
      if (cached) { setAnalysis(cached); setStatus("done"); window.setTimeout(() => document.querySelector("#results")?.scrollIntoView({ behavior: "smooth" }), 100); return; }
      const saved = await Promise.all(parsed.clauses.map(async (clause) => ({ clause, cached: await getCachedAnalysis<CachedClauseExplanation>(`${cacheKey}:clause:${clause.id}`) })));
      const explanationMap = new Map(saved.filter((entry) => entry.cached).map((entry) => [entry.clause.id, entry.cached!.explanation]));
      const glossaryParts = saved.flatMap((entry) => entry.cached?.glossary ?? []);
      const pending = saved.filter((entry) => !entry.cached).map((entry) => entry.clause);
      let completedCount = explanationMap.size;
      setProgress({ phase: "조항을 쉬운 말로 설명하고 있어요", completed: completedCount, total: parsed.clauses.length, percent: 18 + Math.round((completedCount / parsed.clauses.length) * 72) });
      const batches = Array.from({ length: Math.ceil(pending.length / CLAUSES_PER_BATCH) }, (_, index) => pending.slice(index * CLAUSES_PER_BATCH, (index + 1) * CLAUSES_PER_BATCH));
      for (let index = 0; index < batches.length; index += BATCH_CONCURRENCY) {
        const group = batches.slice(index, index + BATCH_CONCURRENCY);
        const results = await Promise.all(group.map((batch) => explainClauseBatch(batch, (seconds) => setProgress((current) => ({ ...current, phase: `요청 제한이 풀릴 때까지 ${seconds}초 기다리는 중이에요` })))));
        for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
          const result = results[resultIndex];
          const batch = group[resultIndex];
          for (const clause of batch) {
            const explanation = result.explanations.find((entry) => entry.clauseId === clause.id);
            if (!explanation) throw new Error("일부 조항 설명이 누락됐어요.");
            explanationMap.set(clause.id, explanation);
            await setCachedAnalysis<CachedClauseExplanation>(`${cacheKey}:clause:${clause.id}`, { explanation, glossary: result.glossary });
            completedCount += 1;
            setProgress({ phase: "조항을 쉬운 말로 설명하고 있어요", completed: completedCount, total: parsed.clauses.length, percent: 18 + Math.round((completedCount / parsed.clauses.length) * 72) });
          }
          glossaryParts.push(...result.glossary);
        }
      }
      const levelOrder = { danger: 0, caution: 1, important: 2, general: 3 };
      let items = [...parsed.clauses].sort((a, b) => levelOrder[a.level] - levelOrder[b.level] || a.order - b.order).flatMap((clause) => {
        const explanation = explanationMap.get(clause.id);
        if (!explanation) throw new Error("일부 조항 설명이 누락됐어요. 다시 시도해 주세요.");
        // AI가 문서 안내·서식·상식으로 판정한 항목은 정상적으로 제외합니다.
        // 정규식 판정과 다르다는 이유만으로 전체 분석을 중단하지 않습니다.
        if (!explanation.relevant) return [];
        if (hasUnsupportedInference(explanation, clause.original)) return [];
        return [{ id: clause.id, marker: clause.marker, level: clause.level, title: explanation.title, core: explanation.core, easyExplanation: explanation.easyExplanation, impact: explanation.impact, checkPoint: explanation.checkPoint, action: explanation.action, original: clause.original, page: clause.page, sourceBlockIds: clause.sourceBlockIds, sourceClauseIds: clause.sourceClauseIds, effects: clause.effects } satisfies Item];
      });
      // coverage 검사는 '실제 카드로 채택된 의미'를 기준선으로 잡고,
      // 이후 중복 병합 과정에서 그 의미가 사라지는지만 확인합니다.
      const expectedSourceClauseIds = new Set(items.flatMap((item) => item.sourceClauseIds));
      setProgress({ phase: "분석 결과를 마지막으로 정리하고 있어요", completed: parsed.clauses.length, total: parsed.clauses.length, percent: 94 });
      const documentType = parsed.basicInfo.find((info) => info.label === "계약 종류")?.value ?? "금융 계약서 분석 결과";
      const priorityCount = items.filter((item) => item.level === "danger" || item.level === "caution").length;
      const summary = priorityCount ? `계약서에서 확인한 ${items.length}개 항목 중 먼저 확인할 위험·주의 내용은 ${priorityCount}개입니다.` : `계약서에서 확인한 ${items.length}개 항목을 위험도와 중요도에 따라 정리했습니다.`;
      const candidateGroups = buildDuplicateCandidateGroups(items);
      if (candidateGroups.length) {
        setProgress({ phase: "비슷한 설명만 골라 중복 여부를 확인하고 있어요", completed: parsed.clauses.length, total: parsed.clauses.length, percent: 97 });
        try {
          const response = await fetch("/api/deduplicate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateGroups }) });
          const result = await readApiJson<{ duplicateGroups?: DuplicateDecision[] }>(response);
          if (response.ok) items = mergeSimilarItems(items, result.duplicateGroups ?? []);
        } catch { /* 부가적인 중복 검사 실패 시 원본 분석 항목을 그대로 사용합니다. */ }
      }
      const uncovered = auditCoverage(expectedSourceClauseIds, items);
      if (uncovered.length) throw new Error("분석 결과를 정리하는 과정에서 일부 근거가 누락됐어요. 다시 분석해 주세요.");
      const glossary = [...new Map(glossaryParts.map((entry) => [entry.term, entry])).values()];
      const data: Analysis = { documentType, summary, items, glossary, basicInfo: parsed.basicInfo, notices: parsed.notices };
      await setCachedAnalysis(cacheKey, data);
      setAnalysis(data); setStatus("done");
      window.setTimeout(() => document.querySelector("#results")?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서를 분석하지 못했습니다."); setStatus("error"); }
  };

  const ask = async (text?: string) => {
    const query = (text ?? question).trim();
    if (!query || !file || asking) return;
    const userMessage: Message = { role: "user", text: query };
    const previous = messages;
    setMessages([...previous, userMessage]); setQuestion(""); setAsking(true); setChatError("");
    const body = new FormData(); body.append("file", file); body.append("question", query);
    body.append("history", JSON.stringify(previous.map((message) => ({ role: message.role, text: message.text }))));
    try {
      const response = await fetch("/api/ask", { method: "POST", body });
      const data = await readApiJson<{ answer?: string; citations?: Citation[]; notFound?: boolean; glossary?: GlossaryTerm[] }>(response);
      if (!response.ok || !data.answer) throw new Error(data.error || "답변을 만들지 못했습니다.");
      setMessages((current) => [...current, { role: "assistant", text: data.answer!, citations: data.citations, notFound: data.notFound, glossary: data.glossary }]);
    } catch (reason) { setChatError(reason instanceof Error ? reason.message : "답변을 만들지 못했습니다."); }
    finally { setAsking(false); window.setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }
  };

  const submitQuestion = (event: FormEvent) => { event.preventDefault(); ask(); };
  const levelLabel = (level: Item["level"]) => level === "danger" ? "위험" : level === "caution" ? "주의" : level === "important" ? "중요" : "일반";
  const levelIcon = (level: Item["level"]) => level === "danger" ? "!" : level === "caution" ? "!" : level === "important" ? "★" : "·";
  const featuredItems = analysis?.items.filter((item) => item.level === "danger" || item.level === "caution") ?? [];
  const counts = analysis?.items.reduce((result, item) => ({ ...result, [item.level]: result[item.level] + 1 }), { danger: 0, caution: 0, important: 0, general: 0 }) ?? { danger: 0, caution: 0, important: 0, general: 0 };
  return <main>
    <nav className="nav"><a className="brand" href="#top" aria-label="약속 홈"><span className="brandMark">약</span><span>약속</span></a><span className="navNote">AI 금융 계약서 번역</span></nav>
    <section className="hero" id="top">
      <div className="eyebrow"><span>AI</span> 어려운 약관, 이제 읽지 말고 이해하세요</div>
      <h1>금융 계약서,<br /><em>쉬운 말</em>로 바꿔드려요.</h1>
      <p className="lead">PDF를 분석하고, 궁금한 내용을 물어보고,<br className="mobileBreak" /> 놓치면 안 되는 날짜까지 챙겨보세요.</p>
      <div className={`upload ${status !== "idle" ? "active" : ""}`} onClick={() => status === "idle" && inputRef.current?.click()} onDragOver={(event) => { if (status === "idle") event.preventDefault(); }} onDrop={(event) => { if (status !== "idle") return; event.preventDefault(); analyze(event.dataTransfer.files[0]); }} role={status === "idle" ? "button" : undefined} tabIndex={status === "idle" ? 0 : -1} onKeyDown={(event) => event.key === "Enter" && status === "idle" && inputRef.current?.click()} aria-label={status === "idle" ? "PDF 파일 업로드" : undefined}>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => analyze(event.target.files?.[0])} />
        {status === "idle" && <><div className="uploadIcon">↑</div><strong>계약서 PDF를 여기에 놓으세요</strong><span>또는 클릭해서 파일 선택 · 최대 10MB</span><button type="button">PDF 선택하기</button></>}
        {status === "analyzing" && <div className="loadingBlock"><div className="spinner" /><strong>{file?.name}</strong><span>{progress.phase}</span><div className="progressPanel" aria-live="polite"><div className="progressMeta"><b>{formatProgressCount(progress)}</b><time>{formatElapsed(elapsedSeconds)}</time></div><div className="progressTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label="계약서 분석 진행률"><i style={{ width: `${Math.min(progress.percent, 98)}%` }} /></div><div className="progressFoot"><span>{Math.min(progress.percent, 98)}%</span><small>긴 계약서는 몇 분 정도 걸릴 수 있어요. 창을 닫지 말아 주세요.</small></div></div><WaitingQuiz /></div>}
        {status === "done" && <div className="fileDone"><span className="check">✓</span><div><strong>{file?.name}</strong><span>문서 분석이 완료되었습니다</span></div><button type="button" onClick={(event) => { event.stopPropagation(); reset(); }}>다른 파일</button></div>}
        {status === "error" && <div className="errorBlock"><span className="errorIcon">!</span><strong>분석하지 못했어요</strong><span>{error}</span><button type="button" onClick={(event) => { event.stopPropagation(); reset(); }}>다시 선택하기</button></div>}
      </div>
      <div className="trust"><span>✓ 파일을 따로 저장하지 않음</span><span>✓ 회원가입 없이 이용</span></div>
    </section>

    {analysis && <>
      <section className="resultSection" id="results" aria-live="polite">
        <div className="sectionHead"><div><span className="miniLabel">실제 분석 결과</span><h2>{analysis.documentType}</h2></div></div>
        {!!analysis.basicInfo.length && <section className="basicInfoBox"><div className="infoTitle"><span>01</span><div><h3>계약 기본정보</h3><p>금액·이율·날짜 같은 핵심 사실만 모았어요. 전체 조항 수에는 포함하지 않았어요.</p></div></div><div className="infoGrid">{analysis.basicInfo.map((info) => <div className="infoItem" key={`${info.label}-${info.page}`}><b>{info.label}</b><strong>{info.value}</strong><p>{info.explanation}</p></div>)}</div></section>}
        {!!analysis.notices.length && <aside className="documentNotices"><div><b>문서 안내</b><span>계약 조건이 아니므로 조항 수에서 제외했어요.</span></div>{analysis.notices.map((notice, index) => <p key={`${notice.page}-${index}`}>{notice.text}<small>{notice.page}쪽</small></p>)}</aside>}
        <div className="coverageBox"><div className="coverageCheck">✓</div><div><b>계약서 전체 구간 확인 완료</b><p>총 <strong>{analysis.items.length}개 항목</strong>을 확인했습니다.</p><div className="coverageCounts"><span className="danger">🔴 위험 {counts.danger}개</span><span className="caution">🟠 주의 {counts.caution}개</span><span className="important">🟡 중요 {counts.important}개</span><span className="general">⚪ 일반 {counts.general}개</span></div></div></div>
        <div className="summaryBox"><span>한눈에 보기</span><p><FinancialText text={analysis.summary} glossary={analysis.glossary} /></p></div>
        <CostCalculator basicInfo={analysis.basicInfo} />
        <div className="featuredHead"><span>⚠️</span><div><h3>꼭 확인하세요</h3><p>위험 및 주의 조항 {featuredItems.length}개를 모두 보여드려요.</p></div></div>
        <div className="resultList">{featuredItems.map((item, index) => <article className={`resultItem ${item.level}`} key={`${item.title}-${index}`}>
          <div className="riskCol"><span className="resultNumber">{String(index + 1).padStart(2, "0")}</span><div className="alertLabel"><span>{levelIcon(item.level)}</span>{levelLabel(item.level)}</div></div>
          <div className="easyCol"><h3><FinancialText text={item.title} glossary={analysis.glossary} highlightOnly={getClauseHighlightPlan(item, analysis.glossary).title} firstOccurrenceOnly /></h3><ExplanationSections item={item} glossary={analysis.glossary} />{item.action && <div className="action"><b>이렇게 하세요</b><span><FinancialText text={item.action} glossary={analysis.glossary} highlightOnly={getClauseHighlightPlan(item, analysis.glossary).action} firstOccurrenceOnly /></span></div>}</div>
          <blockquote><span>근거 원문{item.page ? ` · ${item.page}쪽` : ""}</span><p><ReadableOriginal text={item.original} /></p></blockquote>
        </article>)}</div>
        <button className="allClausesButton" type="button" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? "전체 조항 접기" : `전체 ${analysis.items.length}개 조항 보기`}<span>{showAll ? "↑" : "↓"}</span></button>
        {showAll && <div className="allClauses"><div className="allClausesHead"><h3>전체 조항</h3><p>처음 화면에서 숨긴 일반 내용까지 모두 확인할 수 있어요.</p></div>{analysis.items.map((item, index) => <details className={`clauseRow ${item.level}`} key={`all-${item.title}-${index}`}><summary><span className="clauseNumber">{String(index + 1).padStart(2, "0")}</span><span className="clauseLevel">{levelLabel(item.level)}</span><b><FinancialText text={item.title} glossary={analysis.glossary} highlightOnly={getClauseHighlightPlan(item, analysis.glossary).title} firstOccurrenceOnly /></b><i>＋</i></summary><div className="clauseBody"><ExplanationSections item={item} glossary={analysis.glossary} /><small>근거{item.page ? ` · ${item.page}쪽` : ""}: “<ReadableOriginal text={item.original} />”</small></div></details>)}</div>}
      </section>

      <section className="chatSection">
        <div className="chatIntro"><span className="chatIcon">AI</span><div><h2>계약서 AI 상담</h2><p>어려운 말은 쓰지 않아도 돼요. 궁금한 점을 평소 말하듯 물어보세요.</p></div></div>
        <form className="chatForm easy" onSubmit={submitQuestion}><input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder="예: 이 계약 지금 해지해도 괜찮아?" aria-label="계약서 질문" disabled={asking} /><button type="submit" disabled={asking || !question.trim()}>{asking ? "확인 중…" : "물어보기"}</button></form>
        <p className="tryLabel">이렇게 물어볼 수 있어요</p>
        <div className="suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => ask(suggestion)} disabled={asking}>{suggestion}</button>)}</div>
        <div className="chatWindow">
          {!messages.length && <div className="chatWelcome"><span>✦</span><div><b>아직 대화가 없어요</b><p>위에 질문을 적거나 예시 질문을 눌러보세요. 답은 계약서에 적힌 내용만 보고 알려드려요.</p></div></div>}
          {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
            <div className="bubble">{message.role === "assistant" && <b>{message.notFound ? "문서에서 확인되지 않음" : "문서 기반 답변"}</b>}<p>{message.role === "assistant" ? <FinancialText text={message.text} glossary={message.glossary} /> : message.text}</p></div>
            {message.citations?.map((citation, citationIndex) => <blockquote key={citationIndex}><span>근거 원문{citation.page ? ` · ${citation.page}쪽` : ""}</span><p>“<ReadableOriginal text={citation.original} />”</p><small>{citation.relevance}</small></blockquote>)}
          </div>)}
          {asking && <div className="message assistant"><div className="bubble typing"><i /><i /><i /></div></div>}
          {chatError && <p className="chatError">{chatError}</p>}
          <div ref={chatEndRef} />
        </div>
        <p className="chatNotice">AI 답변은 참고용입니다. 중요한 결정 전에는 금융회사 또는 전문가에게 확인하세요.</p>
      </section>
    </>}

    {!analysis && <section className="features"><div><span>01</span><b>실제 PDF 전체 분석</b><p>업로드한 문서의 본문을 AI가 직접 읽고 핵심 내용을 찾아요.</p></div><div><span>02</span><b>쉽게 물어보는 AI 상담</b><p>평소 말하듯 질문하면 계약서 내용만 보고 쉽게 답해요.</p></div><div><span>03</span><b>근거 원문까지 확인</b><p>답변이 나온 이유를 원문과 페이지로 바로 확인할 수 있어요.</p></div></section>}
    <footer><a className="brand" href="#top"><span className="brandMark">약</span><span>약속</span></a><p>AI 분석은 참고용이며, 중요한 계약은 금융회사 또는 전문가에게 확인하세요.</p></footer>
  </main>;
}
