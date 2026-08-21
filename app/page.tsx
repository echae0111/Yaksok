"use client";
import { useRef, useState } from "react";

type Status = "idle" | "analyzing" | "done" | "error";
type Item = { level: "danger" | "caution" | "info"; title: string; explanation: string; action: string; original: string; page: number | null };
type Analysis = { documentType: string; summary: string; items: Item[] };

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const reset = () => { setStatus("idle"); setAnalysis(null); setError(""); setFileName(""); if (inputRef.current) inputRef.current.value = ""; };
  const analyze = async (file?: File) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setError("PDF 파일만 분석할 수 있어요."); setStatus("error"); return; }
    if (file.size > 10 * 1024 * 1024) { setError("파일은 10MB 이하로 올려 주세요."); setStatus("error"); return; }
    setFileName(file.name); setError(""); setAnalysis(null); setStatus("analyzing");
    const body = new FormData(); body.append("file", file);
    try {
      const response = await fetch("/api/analyze", { method: "POST", body });
      const data = await response.json() as Analysis & { error?: string };
      if (!response.ok) throw new Error(data.error || "문서를 분석하지 못했습니다.");
      setAnalysis(data); setStatus("done");
      window.setTimeout(() => document.querySelector("#results")?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서를 분석하지 못했습니다."); setStatus("error"); }
  };
  return <main>
    <nav className="nav"><a className="brand" href="#top" aria-label="약속 홈"><span className="brandMark">약</span><span>약속</span></a><span className="navNote">AI 금융 계약서 번역</span></nav>
    <section className="hero" id="top">
      <div className="eyebrow"><span>AI</span> 어려운 약관, 이제 읽지 말고 이해하세요</div>
      <h1>금융 계약서,<br /><em>쉬운 말</em>로 바꿔드려요.</h1>
      <p className="lead">보험·대출·카드 약관 PDF를 올리면 중요한 내용만 골라<br className="mobileBreak" /> 실제 문서 내용을 바탕으로 설명해 드립니다.</p>
      <div className={`upload ${status !== "idle" ? "active" : ""}`} onClick={() => status === "idle" && inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); analyze(e.dataTransfer.files[0]); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && status === "idle" && inputRef.current?.click()} aria-label="PDF 파일 업로드">
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => analyze(e.target.files?.[0])} />
        {status === "idle" && <><div className="uploadIcon">↑</div><strong>계약서 PDF를 여기에 놓으세요</strong><span>또는 클릭해서 파일 선택 · 최대 10MB</span><button type="button">PDF 선택하기</button></>}
        {status === "analyzing" && <div className="loadingBlock"><div className="spinner" /><strong>{fileName}</strong><span>AI가 문서 전체에서 중요한 조항을 찾고 있어요…</span></div>}
        {status === "done" && <div className="fileDone"><span className="check">✓</span><div><strong>{fileName}</strong><span>실제 문서 분석이 완료되었습니다</span></div><button type="button" onClick={(e) => { e.stopPropagation(); reset(); }}>다른 파일</button></div>}
        {status === "error" && <div className="errorBlock"><span className="errorIcon">!</span><strong>분석하지 못했어요</strong><span>{error}</span><button type="button" onClick={(e) => { e.stopPropagation(); reset(); }}>다시 선택하기</button></div>}
      </div>
      <div className="trust"><span>✓ 파일을 따로 저장하지 않음</span><span>✓ 회원가입 없이 이용</span></div>
    </section>
    {analysis && <section className="resultSection" id="results" aria-live="polite">
      <div className="sectionHead"><div><span className="miniLabel">실제 분석 결과</span><h2>{analysis.documentType}</h2></div><div className="legend"><span><i className="dot red" />위험</span><span><i className="dot yellow" />주의</span><span><i className="dot green" />참고</span></div></div>
      <div className="summaryBox"><span>한눈에 보기</span><p>{analysis.summary}</p></div>
      <div className="resultList">{analysis.items.map((item, index) => <article className={`resultItem ${item.level}`} key={`${item.title}-${index}`}>
        <div className="riskCol"><span className="resultNumber">{String(index + 1).padStart(2, "0")}</span><div className="alertLabel"><span>{item.level === "danger" ? "!" : item.level === "caution" ? "i" : "✓"}</span>{item.level === "danger" ? "위험" : item.level === "caution" ? "주의" : "참고"}</div></div>
        <div className="easyCol"><h3>{item.title}</h3><p>{item.explanation}</p><div className="action"><b>이렇게 하세요</b><span>{item.action}</span></div></div>
        <blockquote><span>근거 원문{item.page ? ` · ${item.page}쪽` : ""}</span><p>{item.original}</p></blockquote>
      </article>)}</div>
    </section>}
    {!analysis && <section className="features"><div><span>01</span><b>실제 PDF 전체 분석</b><p>업로드한 문서의 본문을 AI가 직접 읽고 핵심 내용을 찾아요.</p></div><div><span>02</span><b>위험 조항은 선명하게</b><p>놓치면 손해 볼 수 있는 내용에 위험도와 근거 원문을 표시해요.</p></div><div><span>03</span><b>행동 방법까지</b><p>언제까지 무엇을 해야 하는지 바로 실행할 수 있게 알려드려요.</p></div></section>}
    <footer><a className="brand" href="#top"><span className="brandMark">약</span><span>약속</span></a><p>AI 분석은 참고용이며, 중요한 계약은 금융회사 또는 전문가에게 확인하세요.</p></footer>
  </main>;
}
