"use client";
import { FormEvent, useRef, useState } from "react";

type Status = "idle" | "analyzing" | "done" | "error";
type GlossaryTerm = { term: string; definition: string };
type Item = { level: "danger" | "caution" | "important" | "general"; title: string; core: string; easyExplanation: string; impact: string; checkPoint: string; action: string; original: string; page: number | null };
type Analysis = { documentType: string; summary: string; items: Item[]; glossary: GlossaryTerm[] };
type Citation = { original: string; page: number | null; relevance: string };
type Message = { role: "user" | "assistant"; text: string; citations?: Citation[]; notFound?: boolean; glossary?: GlossaryTerm[] };

const suggestions = ["해지하면 손해인가요?", "자동 연장은 언제 막나요?", "보장 안 되는 경우는?", "가장 불리한 조건은?"];

function TermHelp({ term, definition }: GlossaryTerm) {
  const [open, setOpen] = useState(false);
  return <span className={`termHelp ${open ? "open" : ""}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="termWord" aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((value) => !value)}>{term}</button>
    <span className="termDefinition" role="tooltip"><b>{term}</b><span>{definition}</span></span>
  </span>;
}

function FinancialText({ text, glossary = [] }: { text: string; glossary?: GlossaryTerm[] }) {
  const definitions = new Map(glossary.filter(({ term, definition }) => term.trim() && definition.trim()).map((entry) => [entry.term.trim(), entry.definition.trim()]));
  const terms = [...definitions.keys()].sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return <>{text.split(pattern).map((part, index) => definitions.has(part) ? <TermHelp key={`${part}-${index}`} term={part} definition={definitions.get(part)!} /> : <span key={index}>{part}</span>)}</>;
}

function ExplanationSections({ item, glossary }: { item: Item; glossary: GlossaryTerm[] }) {
  const sections = [["핵심 내용", item.core], ["쉽게 설명하면", item.easyExplanation], ["나에게 어떤 영향이 있나요?", item.impact], ["확인할 점", item.checkPoint]].filter(([, value]) => value.trim());
  return <div className="explanationSections">{sections.map(([label, value]) => <div className="explanationRow" key={label}><b>{label}</b><p><FinancialText text={value} glossary={glossary} /></p></div>)}</div>;
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

  const reset = () => { setStatus("idle"); setFile(null); setAnalysis(null); setError(""); setMessages([]); setShowAll(false); if (inputRef.current) inputRef.current.value = ""; };
  const analyze = async (selected?: File) => {
    if (!selected) return;
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) { setError("PDF 파일만 분석할 수 있어요."); setStatus("error"); return; }
    if (selected.size > 10 * 1024 * 1024) { setError("파일은 10MB 이하로 올려 주세요."); setStatus("error"); return; }
    setFile(selected); setError(""); setAnalysis(null); setMessages([]); setStatus("analyzing");
    const body = new FormData(); body.append("file", selected);
    try {
      const response = await fetch("/api/analyze", { method: "POST", body });
      const data = await response.json() as Analysis & { error?: string };
      if (!response.ok) throw new Error(data.error || "문서를 분석하지 못했습니다.");
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
      const data = await response.json() as { answer?: string; citations?: Citation[]; notFound?: boolean; glossary?: GlossaryTerm[]; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || "답변을 만들지 못했습니다.");
      setMessages((current) => [...current, { role: "assistant", text: data.answer!, citations: data.citations, notFound: data.notFound, glossary: data.glossary }]);
    } catch (reason) { setChatError(reason instanceof Error ? reason.message : "답변을 만들지 못했습니다."); }
    finally { setAsking(false); window.setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }
  };

  const submitQuestion = (event: FormEvent) => { event.preventDefault(); ask(); };
  const levelLabel = (level: Item["level"]) => level === "danger" ? "위험" : level === "caution" ? "주의" : level === "important" ? "중요" : "일반";
  const levelIcon = (level: Item["level"]) => level === "danger" ? "!" : level === "caution" ? "!" : level === "important" ? "★" : "·";
  const priorityItems = analysis?.items.filter((item) => item.level !== "general") ?? [];
  const featuredItems = priorityItems.length ? priorityItems.slice(0, 8) : analysis?.items.slice(0, 8) ?? [];
  const counts = analysis?.items.reduce((result, item) => ({ ...result, [item.level]: result[item.level] + 1 }), { danger: 0, caution: 0, important: 0, general: 0 }) ?? { danger: 0, caution: 0, important: 0, general: 0 };
  return <main>
    <nav className="nav"><a className="brand" href="#top" aria-label="약속 홈"><span className="brandMark">약</span><span>약속</span></a><span className="navNote">AI 금융 계약서 번역</span></nav>
    <section className="hero" id="top">
      <div className="eyebrow"><span>AI</span> 어려운 약관, 이제 읽지 말고 이해하세요</div>
      <h1>금융 계약서,<br /><em>쉬운 말</em>로 바꿔드려요.</h1>
      <p className="lead">PDF를 분석하고, 궁금한 내용을 물어보고,<br className="mobileBreak" /> 놓치면 안 되는 날짜까지 챙겨보세요.</p>
      <div className={`upload ${status !== "idle" ? "active" : ""}`} onClick={() => status === "idle" && inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); analyze(event.dataTransfer.files[0]); }} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && status === "idle" && inputRef.current?.click()} aria-label="PDF 파일 업로드">
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => analyze(event.target.files?.[0])} />
        {status === "idle" && <><div className="uploadIcon">↑</div><strong>계약서 PDF를 여기에 놓으세요</strong><span>또는 클릭해서 파일 선택 · 최대 10MB</span><button type="button">PDF 선택하기</button></>}
        {status === "analyzing" && <div className="loadingBlock"><div className="spinner" /><strong>{file?.name}</strong><span>핵심 조항과 중요한 날짜를 함께 찾고 있어요…</span></div>}
        {status === "done" && <div className="fileDone"><span className="check">✓</span><div><strong>{file?.name}</strong><span>문서 분석이 완료되었습니다</span></div><button type="button" onClick={(event) => { event.stopPropagation(); reset(); }}>다른 파일</button></div>}
        {status === "error" && <div className="errorBlock"><span className="errorIcon">!</span><strong>분석하지 못했어요</strong><span>{error}</span><button type="button" onClick={(event) => { event.stopPropagation(); reset(); }}>다시 선택하기</button></div>}
      </div>
      <div className="trust"><span>✓ 파일을 따로 저장하지 않음</span><span>✓ 회원가입 없이 이용</span></div>
    </section>

    {analysis && <>
      <section className="resultSection" id="results" aria-live="polite">
        <div className="sectionHead"><div><span className="miniLabel">실제 분석 결과</span><h2>{analysis.documentType}</h2></div></div>
        <div className="coverageBox"><div className="coverageCheck">✓</div><div><b>계약서 전체 구간 확인 완료</b><p>총 <strong>{analysis.items.length}개 항목</strong>을 확인했습니다.</p><div className="coverageCounts"><span className="danger">🔴 위험 {counts.danger}개</span><span className="caution">🟠 주의 {counts.caution}개</span><span className="important">🟡 중요 {counts.important}개</span><span className="general">⚪ 일반 {counts.general}개</span></div></div></div>
        <div className="summaryBox"><span>한눈에 보기</span><p><FinancialText text={analysis.summary} glossary={analysis.glossary} /></p></div>
        <div className="featuredHead"><span>⚠️</span><div><h3>꼭 확인하세요</h3><p>돈이나 권리에 큰 영향을 줄 수 있는 내용을 먼저 보여드려요.</p></div></div>
        <div className="resultList">{featuredItems.map((item, index) => <article className={`resultItem ${item.level}`} key={`${item.title}-${index}`}>
          <div className="riskCol"><span className="resultNumber">{String(index + 1).padStart(2, "0")}</span><div className="alertLabel"><span>{levelIcon(item.level)}</span>{levelLabel(item.level)}</div></div>
          <div className="easyCol"><h3><FinancialText text={item.title} glossary={analysis.glossary} /></h3><ExplanationSections item={item} glossary={analysis.glossary} />{item.action && <div className="action"><b>이렇게 하세요</b><span><FinancialText text={item.action} glossary={analysis.glossary} /></span></div>}</div>
          <blockquote><span>근거 원문{item.page ? ` · ${item.page}쪽` : ""}</span><p>{item.original}</p></blockquote>
        </article>)}</div>
        <button className="allClausesButton" type="button" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? "전체 조항 접기" : `전체 ${analysis.items.length}개 조항 보기`}<span>{showAll ? "↑" : "↓"}</span></button>
        {showAll && <div className="allClauses"><div className="allClausesHead"><h3>전체 조항</h3><p>처음 화면에서 숨긴 일반 내용까지 모두 확인할 수 있어요.</p></div>{analysis.items.map((item, index) => <details className={`clauseRow ${item.level}`} key={`all-${item.title}-${index}`}><summary><span className="clauseNumber">{String(index + 1).padStart(2, "0")}</span><span className="clauseLevel">{levelLabel(item.level)}</span><b><FinancialText text={item.title} glossary={analysis.glossary} /></b><i>＋</i></summary><div className="clauseBody"><ExplanationSections item={item} glossary={analysis.glossary} /><small>근거{item.page ? ` · ${item.page}쪽` : ""}: “{item.original}”</small></div></details>)}</div>}
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
            {message.citations?.map((citation, citationIndex) => <blockquote key={citationIndex}><span>근거 원문{citation.page ? ` · ${citation.page}쪽` : ""}</span><p>“{citation.original}”</p><small>{citation.relevance}</small></blockquote>)}
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
