"use client";

import { useRef, useState } from "react";

type Status = "idle" | "analyzing" | "done";

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState("");

  const analyze = (file?: File) => {
    setFileName(file?.name || "보험약관_샘플.pdf");
    setStatus("analyzing");
    window.setTimeout(() => setStatus("done"), 1100);
  };

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#top" aria-label="약속 홈">
          <span className="brandMark">약</span>
          <span>약속</span>
        </a>
        <span className="navNote">AI 금융 계약서 번역</span>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow"><span>AI</span> 어려운 약관, 이제 읽지 말고 이해하세요</div>
        <h1>금융 계약서,<br /><em>쉬운 말</em>로 바꿔드려요.</h1>
        <p className="lead">보험·대출·카드 약관 PDF를 올리면<br className="mobileBreak" /> 중요한 내용만 골라 쉽게 설명해 드립니다.</p>

        <div
          className={`upload ${status !== "idle" ? "active" : ""}`}
          onClick={() => status === "idle" && inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) analyze(file); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          aria-label="PDF 파일 업로드"
        >
          <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={(e) => analyze(e.target.files?.[0])} />
          {status === "idle" && <>
            <div className="uploadIcon">↑</div>
            <strong>계약서 PDF를 여기에 놓으세요</strong>
            <span>또는 클릭해서 파일 선택 · 최대 20MB</span>
            <button>PDF 선택하기</button>
          </>}
          {status === "analyzing" && <div className="loadingBlock">
            <div className="spinner" />
            <strong>{fileName}</strong>
            <span>AI가 중요한 조항을 읽고 있어요…</span>
          </div>}
          {status === "done" && <div className="fileDone">
            <span className="check">✓</span>
            <div><strong>{fileName}</strong><span>분석이 완료되었습니다</span></div>
            <button onClick={(e) => { e.stopPropagation(); setStatus("idle"); }}>다른 파일</button>
          </div>}
        </div>

        <div className="trust"><span>✓ 업로드 파일은 분석 후 바로 삭제</span><span>✓ 회원가입 없이 무료 체험</span></div>
      </section>

      <section className="resultSection" aria-live="polite">
        <div className="sectionHead">
          <div><span className="miniLabel">미리보기</span><h2>{status === "done" ? "AI 분석 결과" : "이렇게 설명해 드려요"}</h2></div>
          <div className="legend"><span><i className="dot red" />위험</span><span><i className="dot yellow" />주의</span></div>
        </div>

        <div className={`analysisCard ${status === "done" ? "revealed" : ""}`}>
          <div className="document">
            <div className="docTop"><span className="pdfBadge">PDF</span><div><b>{status === "done" ? fileName : "보험약관.pdf"}</b><small>제12조 보험료 연체 및 계약의 효력</small></div></div>
            <p>② 보험료 납입이 연체된 경우 회사는 <mark>연체일로부터 5일이 경과한 날</mark>부터 약정된 연체이율을 적용합니다.</p>
            <p>③ 계약자는 별도의 의사표시가 없는 경우 계약 만료일에 <mark className="yellowMark">동일한 조건으로 계약이 자동 연장</mark>되는 것에 동의합니다.</p>
            <span className="page">3 / 24</span>
          </div>

          <div className="arrow" aria-hidden="true">→</div>

          <div className="explanation">
            <div className="explainTitle"><span>✦</span><div><small>AI가 쉽게 풀었어요</small><b>핵심 내용 2가지</b></div></div>
            <article className="alert danger">
              <div className="alertLabel"><span>!</span> 위험</div>
              <h3>5일 이상 연체하면<br />연체이자가 붙어요.</h3>
              <p>납입일을 놓쳤다면 5일 안에 내야 추가 이자를 피할 수 있습니다.</p>
            </article>
            <article className="alert caution">
              <div className="alertLabel"><span>i</span> 주의</div>
              <h3>가만히 두면 계약이<br />자동으로 연장돼요.</h3>
              <p>계속 이용하지 않으려면 만료일 전에 직접 해지해야 합니다.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="features">
        <div><span>01</span><b>어려운 말은 쉽게</b><p>법률·금융 용어를 누구나 이해할 수 있는 일상어로 바꿔요.</p></div>
        <div><span>02</span><b>위험 조항은 선명하게</b><p>놓치면 손해 볼 수 있는 내용에 위험도와 이유를 표시해요.</p></div>
        <div><span>03</span><b>행동 방법까지</b><p>언제까지 무엇을 해야 하는지 바로 실행할 수 있게 알려드려요.</p></div>
      </section>

      <footer><a className="brand" href="#top"><span className="brandMark">약</span><span>약속</span></a><p>AI 분석은 참고용이며, 중요한 계약은 전문가의 확인을 권장합니다.</p></footer>
    </main>
  );
}
