"use client";

import { useMemo, useState } from "react";

export type DailyPnlEntry = {
  date: string;
  pnlJpy: number;
  tradeCount: number;
  winCount: number;
};

type Props = {
  entries: DailyPnlEntry[];
};

const WEEK_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function DailyPnlCalendar({ entries }: Props) {
  const today = new Date();
  const initialMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [monthKey, setMonthKey] = useState(initialMonth);

  const entryByDate = useMemo(() => {
    const map = new Map<string, DailyPnlEntry>();
    for (const entry of entries) map.set(entry.date, entry);
    return map;
  }, [entries]);

  const [year, month] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: Array<{ day: number; date: string } | null> = [];
  for (let i = 0; i < leadingBlanks; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      day,
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const monthEntries = entries.filter((entry) =>
    entry.date.startsWith(`${year}-${String(month).padStart(2, "0")}`),
  );
  const monthTotalPnl = monthEntries.reduce((sum, e) => sum + e.pnlJpy, 0);
  const monthTradeCount = monthEntries.reduce((sum, e) => sum + e.tradeCount, 0);
  const monthWinCount = monthEntries.reduce((sum, e) => sum + e.winCount, 0);
  const monthWinRate = monthTradeCount > 0 ? (monthWinCount / monthTradeCount) * 100 : 0;

  const goPrev = () => {
    const prev = new Date(year, month - 2, 1);
    setMonthKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
  };
  const goNext = () => {
    const next = new Date(year, month, 1);
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };
  const goToday = () => setMonthKey(initialMonth);

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft pb-2.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-2xl font-semibold tabular-nums text-text-strong">
            {year}年{month}月
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-sm font-semibold ${
              monthTotalPnl > 0
                ? "bg-profit-soft text-profit-strong"
                : monthTotalPnl < 0
                  ? "bg-loss-soft text-loss-strong"
                  : "bg-surface-muted text-muted"
            }`}
          >
            月次 {formatJpySigned(monthTotalPnl)}
          </span>
          <span className="text-[11px] text-muted">
            {monthTradeCount} fills ·{" "}
            {monthTradeCount > 0 ? `${monthWinRate.toFixed(1)}% win` : "—"}
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button type="button" onClick={goPrev} className="btn-ghost" aria-label="前の月">
            ←
          </button>
          <button type="button" onClick={goToday} className="btn-ghost">
            今日
          </button>
          <button type="button" onClick={goNext} className="btn-ghost" aria-label="次の月">
            →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
        {WEEK_LABELS.map((label, idx) => (
          <div
            key={label}
            className={`bg-bg-elevated px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.08em] ${
              idx === 0 ? "text-loss-strong" : idx === 6 ? "text-accent-strong" : "text-muted"
            }`}
          >
            {label}
          </div>
        ))}
        {cells.map((cell, idx) => {
          if (!cell) {
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: 空白セル用
                key={`blank-${idx}`}
                className="aspect-square bg-bg-elevated"
              />
            );
          }
          const entry = entryByDate.get(cell.date);
          const isToday = cell.date === todayKey;
          const pnl = entry?.pnlJpy ?? 0;
          const tone =
            entry && entry.tradeCount > 0
              ? pnl > 0
                ? "profit"
                : pnl < 0
                  ? "loss"
                  : "flat"
              : "empty";
          const bgClass =
            tone === "profit"
              ? "bg-profit-soft"
              : tone === "loss"
                ? "bg-loss-soft"
                : "bg-bg-elevated";
          const fgClass =
            tone === "profit"
              ? "text-profit-strong"
              : tone === "loss"
                ? "text-loss-strong"
                : "text-muted";
          return (
            <div
              key={cell.date}
              className={`flex aspect-square flex-col justify-between p-1.5 transition-colors hover:brightness-110 ${bgClass} ${
                isToday ? "outline outline-1 outline-accent-strong outline-offset-[-1px]" : ""
              }`}
              title={
                entry && entry.tradeCount > 0
                  ? `${cell.date}: ${formatJpySigned(pnl)} / ${entry.tradeCount} fills`
                  : cell.date
              }
            >
              <span
                className={`text-[11px] font-bold tabular-nums ${isToday ? "text-accent-strong" : "text-text"}`}
              >
                {cell.day}
              </span>
              {entry && entry.tradeCount > 0 ? (
                <span className="flex flex-col items-end gap-0">
                  <span className={`font-mono text-[11px] font-semibold tabular-nums ${fgClass}`}>
                    {formatCompactJpySigned(pnl)}
                  </span>
                  <span className="text-[9px] text-muted">{entry.tradeCount}件</span>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatJpySigned(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Math.abs(value))}`;
}

function formatCompactJpySigned(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  if (abs >= 100_000_000) return `${sign}¥${(abs / 100_000_000).toFixed(2)}億`;
  if (abs >= 10_000) return `${sign}¥${(abs / 10_000).toFixed(1)}万`;
  return `${sign}¥${Math.round(abs).toLocaleString("ja-JP")}`;
}
