"use client";

import { useMemo, useState } from "react";
import type { BasicInfo } from "./contract-parser";

type CalculatorKind = "cancel" | "prepay" | "overdue" | "rate";
type Values = Record<string, string>;

const calculators: { id: CalculatorKind; label: string; description: string }[] = [
  { id: "cancel", label: "중도해지", description: "지금까지 낸 돈과 돌려받을 돈의 차이" },
  { id: "prepay", label: "조기상환", description: "대출을 일찍 갚을 때 예상 수수료" },
  { id: "overdue", label: "연체", description: "납부가 늦어졌을 때 예상 연체이자" },
  { id: "rate", label: "금리 변경", description: "금리가 바뀔 때 늘거나 줄어드는 이자" },
];

const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const number = (value: string) => Number(value.replaceAll(",", "")) || 0;
const money = (value: number) => `${won.format(Math.max(0, Math.round(value)))}원`;

function numericHint(info: BasicInfo[], pattern: RegExp) {
  const match = info.find((entry) => pattern.test(entry.label));
  if (!match) return "";
  const digits = match.value.replace(/[^0-9]/g, "");
  return digits || "";
}

function Field({ label, suffix, value, onChange, hint, min = 0, step = "any" }: { label: string; suffix: string; value: string; onChange: (value: string) => void; hint?: string; min?: number; step?: string }) {
  return <label className="costField"><span>{label}</span><div><input type="number" inputMode="decimal" min={min} step={step} value={value} placeholder="0" onChange={(event) => onChange(event.target.value)} /><b>{suffix}</b></div>{hint && <small>{hint}</small>}</label>;
}

export default function CostCalculator({ basicInfo }: { basicInfo: BasicInfo[] }) {
  const [kind, setKind] = useState<CalculatorKind>("cancel");
  const [values, setValues] = useState<Values>(() => ({
    paid: "", refund: "", extraFee: "",
    balance: numericHint(basicInfo, /대출금|원금|금액|발행금액/), feeRate: "", remainingMonths: "", contractMonths: "",
    overdueAmount: "", overdueRate: "", overdueDays: "",
    rateBalance: numericHint(basicInfo, /대출금|원금|금액|발행금액/), oldRate: "", newRate: "", rateMonths: "12",
  }));
  const set = (key: string) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  const result = useMemo(() => {
    if (kind === "cancel") {
      const paid = number(values.paid), refund = number(values.refund), fee = number(values.extraFee);
      return { amount: Math.max(0, paid - refund + fee), label: "예상 손실액", formula: `${money(paid)} − ${money(refund)} + ${money(fee)}`, check: "해지환급금, 별도 해지 비용, 세금 공제 여부" };
    }
    if (kind === "prepay") {
      const balance = number(values.balance), rate = number(values.feeRate), remain = number(values.remainingMonths), total = number(values.contractMonths);
      const ratio = total > 0 ? Math.min(remain / total, 1) : 0;
      return { amount: balance * rate / 100 * ratio, label: "예상 중도상환수수료", formula: `${money(balance)} × ${rate || 0}% × ${total ? `${remain || 0}개월 ÷ ${total}개월` : "잔존기간 비율"}`, check: "수수료율, 면제 시점, 잔존기간 계산법과 면제 한도" };
    }
    if (kind === "overdue") {
      const amount = number(values.overdueAmount), rate = number(values.overdueRate), days = number(values.overdueDays);
      return { amount: amount * rate / 100 * days / 365, label: "예상 연체이자", formula: `${money(amount)} × ${rate || 0}% × ${days || 0}일 ÷ 365일`, check: "연체이율, 적용 대상 금액, 일수 계산 기준과 최고 이율" };
    }
    const balance = number(values.rateBalance), oldRate = number(values.oldRate), newRate = number(values.newRate), months = number(values.rateMonths);
    const difference = balance * (newRate - oldRate) / 100 * months / 12;
    return { amount: Math.abs(difference), label: difference >= 0 ? "예상 추가 이자" : "예상 절감 이자", formula: `${money(balance)} × (${newRate || 0}% − ${oldRate || 0}%) × ${months || 0}개월 ÷ 12`, check: "변경 금리의 적용일, 금리 산정 주기, 실제 원금 상환 일정", direction: difference >= 0 ? "increase" : "decrease" };
  }, [kind, values]);

  const clear = () => setValues((current) => ({ ...current,
    ...(kind === "cancel" ? { paid: "", refund: "", extraFee: "" } : {}),
    ...(kind === "prepay" ? { balance: "", feeRate: "", remainingMonths: "", contractMonths: "" } : {}),
    ...(kind === "overdue" ? { overdueAmount: "", overdueRate: "", overdueDays: "" } : {}),
    ...(kind === "rate" ? { rateBalance: "", oldRate: "", newRate: "", rateMonths: "12" } : {}),
  }));

  return <section className="costCalculator" aria-labelledby="cost-title">
    <div className="costHeading"><span>₩</span><div><small>예상 비용 계산기</small><h3 id="cost-title">결정하기 전에, 얼마가 달라지는지 계산해 보세요</h3><p>계약서의 숫자를 직접 확인해 입력하면 예상 부담을 바로 비교할 수 있어요.</p></div></div>
    <div className="costTabs" role="tablist" aria-label="계산 종류">{calculators.map((calculator) => <button type="button" role="tab" aria-selected={kind === calculator.id} className={kind === calculator.id ? "active" : ""} key={calculator.id} onClick={() => setKind(calculator.id)}><b>{calculator.label}</b><span>{calculator.description}</span></button>)}</div>
    <div className="costWorkspace">
      <div className="costInputs">
        {kind === "cancel" && <><Field label="지금까지 낸 총금액" suffix="원" value={values.paid} onChange={set("paid")} /><Field label="예상 해지환급금" suffix="원" value={values.refund} onChange={set("refund")} /><Field label="추가 해지 비용" suffix="원" value={values.extraFee} onChange={set("extraFee")} hint="없다면 0으로 두세요." /></>}
        {kind === "prepay" && <><Field label="상환할 원금" suffix="원" value={values.balance} onChange={set("balance")} /><Field label="중도상환수수료율" suffix="%" value={values.feeRate} onChange={set("feeRate")} step="0.01" /><Field label="남은 기간" suffix="개월" value={values.remainingMonths} onChange={set("remainingMonths")} /><Field label="수수료 적용 전체 기간" suffix="개월" value={values.contractMonths} onChange={set("contractMonths")} /></>}
        {kind === "overdue" && <><Field label="연체된 금액" suffix="원" value={values.overdueAmount} onChange={set("overdueAmount")} /><Field label="연체이율(연)" suffix="%" value={values.overdueRate} onChange={set("overdueRate")} step="0.01" /><Field label="연체 일수" suffix="일" value={values.overdueDays} onChange={set("overdueDays")} /></>}
        {kind === "rate" && <><Field label="현재 남은 원금" suffix="원" value={values.rateBalance} onChange={set("rateBalance")} /><Field label="현재 금리(연)" suffix="%" value={values.oldRate} onChange={set("oldRate")} step="0.01" /><Field label="변경 금리(연)" suffix="%" value={values.newRate} onChange={set("newRate")} step="0.01" /><Field label="비교 기간" suffix="개월" value={values.rateMonths} onChange={set("rateMonths")} /></>}
        <button type="button" className="costClear" onClick={clear}>입력값 초기화</button>
      </div>
      <output className={`costResult ${result.direction ?? ""}`} aria-live="polite"><small>{result.label}</small><strong>{money(result.amount)}</strong><div><b>계산식</b><span>{result.formula}</span></div><div><b>계약서에서 확인</b><span>{result.check}</span></div></output>
    </div>
    <p className="costNotice">이 결과는 입력한 값에 따른 단순 예상치예요. 실제 금액은 계약서의 계산 방식, 일할 계산, 세금 및 면제 조건에 따라 달라질 수 있으니 금융회사에 최종 확인하세요.</p>
  </section>;
}
