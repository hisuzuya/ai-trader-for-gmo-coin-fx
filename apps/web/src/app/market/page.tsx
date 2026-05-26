import type { UTCTimestamp } from "lightweight-charts";
import Link from "next/link";
import { MarketCandleChart, type MarketCandlePoint } from "@/components/MarketCandleChart";

export const dynamic = "force-dynamic";

type PublicMarketSnapshot = {
  ticker: {
    bid: number;
    ask: number;
    mid: number;
    spreadPips: number;
    timestamp: string;
    status: string;
  } | null;
  candles: MarketCandlePoint[];
  sourceDate: string | null;
  marketStatus: string | null;
  symbolRule: {
    tickSize: number;
    minOpenOrderSize: number;
    maxOrderSize: number;
  } | null;
  error: string | null;
};

type GmoApiResponse<T> = {
  status: number;
  data: T;
  responsetime?: string;
};

type GmoTicker = {
  symbol: "USD_JPY";
  ask: string;
  bid: string;
  timestamp: string;
  status: string;
};

type GmoSymbolRule = {
  symbol: "USD_JPY";
  tickSize: string;
  minOpenOrderSize: string;
  maxOrderSize: string;
};

type GmoStatus = {
  status: string;
};

type GmoKline = {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
};

type MarketSearchParams = Promise<{
  interval?: string;
  priceType?: string;
}>;

const TIMEFRAMES = [
  { value: "1min", label: "1m" },
  { value: "5min", label: "5m" },
  { value: "10min", label: "10m" },
  { value: "15min", label: "15m" },
  { value: "30min", label: "30m" },
  { value: "1hour", label: "1H" },
] as const;

type TimeframeValue = (typeof TIMEFRAMES)[number]["value"];
type PriceType = "BID" | "ASK";

const KICKER_CLS =
  "inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted before:inline-block before:h-px before:w-[18px] before:bg-accent-strong before:content-['']";
const CARD_CLS =
  "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-bg-elevated";
const CARD_HEAD_CLS =
  "flex items-center justify-between gap-2 border-b border-line bg-linear-to-b from-surface to-bg-elevated px-4 py-3";
const CARD_HEAD_TITLE_CLS =
  "inline-flex items-center gap-2 text-xs font-bold tracking-wide text-text-strong before:h-3.5 before:w-[3px] before:rounded-sm before:bg-accent before:content-['']";
const CARD_HEAD_META_CLS =
  "inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-wide text-muted";
const META_CHIP_CLS = "rounded-full bg-surface px-2 py-0.5 text-text";
const KPI_LABEL_CLS = "text-[10px] font-bold uppercase tracking-[0.1em] text-muted";
const KPI_SUB_CLS = "text-[10px] text-subtle";
const KPI_VALUE_CLS =
  "font-mono text-[22px] font-semibold tracking-tight text-text-strong tabular-nums";

export default async function MarketPage({ searchParams }: { searchParams?: MarketSearchParams }) {
  const params = (await searchParams) ?? {};
  const interval = parseTimeframe(params.interval);
  const priceType = parsePriceType(params.priceType);
  const market = await getPublicMarketSnapshot(interval, priceType);
  const summary = summarizeMarket(market.candles, market.ticker?.mid ?? null);
  const intervalLabel = getTimeframeLabel(interval);

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-6 lg:px-9">
      {/* === Header ======================================================= */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className={KICKER_CLS}>Market · USD/JPY</p>
          <h1 className="text-[clamp(20px,2vw,26px)] font-semibold tracking-tight text-text-strong">
            マーケット & プライス
          </h1>
          <p className="max-w-[64ch] text-xs leading-relaxed text-muted">
            GMO FX の公開 API から取得した USD/JPY のローソク足とライブレート。 時間足と BID/ASK
            を切替えて分析できます。
          </p>
        </div>
        <div className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-muted px-2.5 py-1 text-[11px] text-muted">
            <span className={`tv-status-dot ${market.ticker ? "live" : "danger"}`} />
            <span>{market.ticker ? "PUBLIC API" : "DISCONNECTED"}</span>
            <strong className={market.ticker ? "text-profit-strong" : "text-loss-strong"}>
              {market.ticker ? "CONNECTED" : "DEGRADED"}
            </strong>
          </span>
          <span className="font-mono text-[11px] text-muted">
            {market.ticker ? formatDateTime(market.ticker.timestamp) : "—"}
          </span>
        </div>
      </header>

      {/* === KPI row ====================================================== */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <KpiCell
          label="USD/JPY MID"
          sub="GMO FX Public"
          value={market.ticker ? formatFx(market.ticker.mid) : "—"}
          tone="accent"
        />
        <KpiCell
          label="BID / ASK"
          sub="Live quote"
          value={
            market.ticker ? `${formatFx(market.ticker.bid)} / ${formatFx(market.ticker.ask)}` : "—"
          }
        />
        <KpiCell
          label="Spread"
          sub="Execution cost"
          value={market.ticker ? `${market.ticker.spreadPips.toFixed(1)} pips` : "—"}
        />
        <KpiCell
          label="Session Bias"
          sub={`${intervalLabel} ${priceType}`}
          value={summary.label}
          tone={summary.directionClass}
        />
      </dl>

      {/* === Chart + Rate Lens =========================================== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Chart */}
        <section className={CARD_CLS} aria-label="USD/JPY ローソク足">
          <div className={CARD_HEAD_CLS}>
            <span className={CARD_HEAD_TITLE_CLS}>
              USD/JPY · {intervalLabel} · Public {priceType} Candles
            </span>
            <span className={CARD_HEAD_META_CLS}>
              <span className={META_CHIP_CLS}>
                {market.sourceDate ? `${formatDateKey(market.sourceDate)} GMO FX` : "public API"}
              </span>
            </span>
          </div>
          <div className="flex min-h-0 flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft pb-3">
              <nav
                className="inline-flex items-center gap-px overflow-x-auto rounded-md border border-line bg-bg p-0.5"
                aria-label="時間足"
              >
                {TIMEFRAMES.map((timeframe) => (
                  <Link
                    className={`inline-flex h-7 min-w-9 items-center justify-center rounded font-mono text-[11px] font-bold leading-none ${
                      timeframe.value === interval
                        ? "bg-accent text-text-strong"
                        : "text-muted hover:bg-surface hover:text-text-strong"
                    }`}
                    href={buildMarketHref(timeframe.value, priceType)}
                    key={timeframe.value}
                    aria-current={timeframe.value === interval ? "page" : undefined}
                  >
                    {timeframe.label}
                  </Link>
                ))}
              </nav>
              <nav
                className="inline-flex items-center gap-px overflow-x-auto rounded-md border border-line bg-bg p-0.5"
                aria-label="価格種別"
              >
                {(["BID", "ASK"] as const).map((item) => (
                  <Link
                    className={`inline-flex h-7 min-w-10 items-center justify-center rounded font-mono text-[11px] font-bold leading-none ${
                      item === priceType
                        ? "bg-accent text-text-strong"
                        : "text-muted hover:bg-surface hover:text-text-strong"
                    }`}
                    href={buildMarketHref(interval, item)}
                    key={item}
                    aria-current={item === priceType ? "page" : undefined}
                  >
                    {item}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-line-soft pb-3">
              <div className="flex flex-col gap-0.5">
                <span className={KPI_LABEL_CLS}>MID / Live Rate</span>
                <span className="flex items-baseline gap-2.5">
                  <span
                    className={`font-mono text-[26px] font-semibold tracking-tight tabular-nums ${toneClass(summary.directionClass)}`}
                  >
                    {market.ticker ? formatFx(market.ticker.mid) : "—"}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${toneChipClass(summary.directionClass)}`}
                  >
                    {summary.directionMark} {formatPipsSigned(summary.movePips)}
                  </span>
                </span>
              </div>
              <div className="ml-auto flex gap-5">
                <StatBlock
                  label="Bid / Ask"
                  value={
                    market.ticker
                      ? `${formatFx(market.ticker.bid)} / ${formatFx(market.ticker.ask)}`
                      : "—"
                  }
                />
                <StatBlock
                  label="Spread"
                  value={market.ticker ? `${market.ticker.spreadPips.toFixed(1)} pips` : "—"}
                />
                <StatBlock label="Range" value={formatPips(summary.rangePips)} />
              </div>
            </div>

            {market.candles.length > 0 ? (
              <MarketCandleChart data={market.candles} interval={interval} />
            ) : (
              <div className="grid min-h-[280px] place-items-center rounded-xl border border-dashed border-line p-6 text-center text-xs leading-relaxed text-muted">
                {market.error ?? "公開 API のローソク足が取得できませんでした"}
              </div>
            )}
          </div>
        </section>

        {/* Rate Lens */}
        <aside className={CARD_CLS} aria-label="AI レート判断">
          <div className={CARD_HEAD_CLS}>
            <span className={CARD_HEAD_TITLE_CLS}>AI レート判断 / Rate Lens</span>
            <span className={CARD_HEAD_META_CLS}>
              <span className={`${META_CHIP_CLS} ${toneClass(summary.directionClass)}`}>
                {summary.label}
              </span>
            </span>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div className="rounded-xl border border-line-soft bg-surface-muted p-4">
              <span className={KPI_LABEL_CLS}>現在レート</span>
              <strong
                className={`mt-1 block font-mono text-[28px] font-semibold tracking-tight tabular-nums ${toneClass(summary.directionClass)}`}
              >
                {market.ticker ? formatFx(market.ticker.mid) : "—"}
              </strong>
              <span
                className={`mt-1 inline-flex w-max items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold tracking-wide ${toneChipClass(summary.directionClass)}`}
              >
                {summary.label}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line-soft bg-line-soft">
              <RateCell label="BID" value={market.ticker ? formatFx(market.ticker.bid) : "—"} />
              <RateCell label="ASK" value={market.ticker ? formatFx(market.ticker.ask) : "—"} />
              <RateCell
                label="Spread"
                value={market.ticker ? `${market.ticker.spreadPips.toFixed(1)} pips` : "—"}
              />
              <RateCell label="Volatility" value={formatPips(summary.rangePips)} />
            </div>

            <div className="rounded-xl border-l-2 border-accent bg-surface-muted px-3 py-2.5">
              <span className={KPI_LABEL_CLS}>AIメモ</span>
              <p className="mt-1.5 text-xs leading-relaxed text-text">{buildRateMemo(summary)}</p>
            </div>

            <dl className="grid grid-cols-2 gap-y-1 font-mono text-[10px] text-muted">
              <dt>API</dt>
              <dd className="text-right text-text">GMO FX Public</dd>
              <dt>Market</dt>
              <dd className="text-right text-text">{market.marketStatus ?? "—"}</dd>
              <dt>Tick</dt>
              <dd className="text-right text-text">
                {market.symbolRule ? market.symbolRule.tickSize : "—"}
              </dd>
              <dt>Updated</dt>
              <dd className="text-right text-text">
                {market.ticker ? formatDateTime(market.ticker.timestamp) : "—"}
              </dd>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function KpiCell({
  label,
  sub,
  value,
  tone,
}: {
  label: string;
  sub: string;
  value: string;
  tone?: "profit" | "loss" | "flat" | "accent";
}) {
  return (
    <div className="relative flex min-w-0 flex-col gap-1 bg-bg-elevated p-4">
      <span className={KPI_LABEL_CLS}>{label}</span>
      <span className={KPI_SUB_CLS}>{sub}</span>
      <span className={`mt-1 truncate ${KPI_VALUE_CLS} ${toneClass(tone)}`}>{value}</span>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-text-strong">{value}</span>
    </div>
  );
}

function RateCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[58px] flex-col gap-1 bg-bg-elevated px-3 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
      <strong className="font-mono text-[13px] font-bold tabular-nums text-text-strong">
        {value}
      </strong>
    </div>
  );
}

function toneClass(tone: "profit" | "loss" | "flat" | "accent" | undefined) {
  switch (tone) {
    case "profit":
      return "text-profit-strong";
    case "loss":
      return "text-loss-strong";
    case "flat":
      return "text-accent-strong";
    case "accent":
      return "text-accent-strong";
    default:
      return "text-text-strong";
  }
}

function toneChipClass(tone: "profit" | "loss" | "flat" | undefined) {
  switch (tone) {
    case "profit":
      return "bg-profit-soft text-profit-strong";
    case "loss":
      return "bg-loss-soft text-loss-strong";
    case "flat":
      return "bg-accent-soft text-accent-strong";
    default:
      return "bg-surface text-muted";
  }
}

async function getPublicMarketSnapshot(
  interval: TimeframeValue,
  priceType: PriceType,
): Promise<PublicMarketSnapshot> {
  try {
    const [tickerResponse, statusResponse, symbolsResponse] = await Promise.all([
      fetchGmoPublic<GmoTicker[]>("/ticker"),
      fetchGmoPublic<GmoStatus>("/status"),
      fetchGmoPublic<GmoSymbolRule[]>("/symbols"),
    ]);
    const ticker = tickerResponse.data.find((item) => item.symbol === "USD_JPY") ?? null;
    const symbolRule = symbolsResponse.data.find((item) => item.symbol === "USD_JPY") ?? null;
    const candleResult = await getRecentCandles(interval, priceType);

    const bid = ticker ? Number(ticker.bid) : Number.NaN;
    const ask = ticker ? Number(ticker.ask) : Number.NaN;
    const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number.NaN;

    return {
      ticker:
        ticker && Number.isFinite(bid) && Number.isFinite(ask)
          ? {
              bid,
              ask,
              mid,
              spreadPips: Number(((ask - bid) / 0.01).toFixed(2)),
              timestamp: ticker.timestamp,
              status: ticker.status,
            }
          : null,
      candles: candleResult.candles,
      sourceDate: candleResult.sourceDate,
      marketStatus: statusResponse.data.status,
      symbolRule: symbolRule
        ? {
            tickSize: Number(symbolRule.tickSize),
            minOpenOrderSize: Number(symbolRule.minOpenOrderSize),
            maxOrderSize: Number(symbolRule.maxOrderSize),
          }
        : null,
      error: null,
    };
  } catch (error) {
    return {
      ticker: null,
      candles: [],
      sourceDate: null,
      marketStatus: null,
      symbolRule: null,
      error: error instanceof Error ? error.message : "Public market API failed.",
    };
  }
}

async function getRecentCandles(interval: TimeframeValue, priceType: PriceType) {
  for (const date of getRecentTokyoDates(7)) {
    const response = await fetchGmoPublic<GmoKline[]>("/klines", {
      symbol: "USD_JPY",
      priceType,
      interval,
      date,
    }).catch(() => null);

    const candles =
      response?.data
        .map((item) => ({
          time: Math.floor(Number(item.openTime) / 1000) as UTCTimestamp,
          open: Number(item.open),
          high: Number(item.high),
          low: Number(item.low),
          close: Number(item.close),
        }))
        .filter(
          (item) =>
            Number.isFinite(item.time) &&
            Number.isFinite(item.open) &&
            Number.isFinite(item.high) &&
            Number.isFinite(item.low) &&
            Number.isFinite(item.close),
        ) ?? [];

    if (candles.length > 0) {
      return { sourceDate: date, candles };
    }
  }

  return { sourceDate: null, candles: [] };
}

function parseTimeframe(value: string | undefined): TimeframeValue {
  const match = TIMEFRAMES.find((timeframe) => timeframe.value === value);
  return match?.value ?? "5min";
}

function parsePriceType(value: string | undefined): PriceType {
  return value === "ASK" ? "ASK" : "BID";
}

function getTimeframeLabel(value: TimeframeValue) {
  return TIMEFRAMES.find((timeframe) => timeframe.value === value)?.label ?? value;
}

function buildMarketHref(interval: TimeframeValue, priceType: PriceType) {
  return `/market?interval=${interval}&priceType=${priceType}`;
}

async function fetchGmoPublic<T>(
  path: string,
  query?: Record<string, string>,
): Promise<GmoApiResponse<T>> {
  const baseUrl =
    process.env.GMO_FX_PUBLIC_REST_BASE_URL ?? "https://forex-api.coin.z.com/public/v1";
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GMO FX public REST ${path} failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as GmoApiResponse<T>;
}

type MarketSummary = {
  directionClass: "profit" | "loss" | "flat";
  directionMark: "▲" | "▼" | "◆";
  movePips: number;
  rangePips: number;
  label: string;
};

function summarizeMarket(candles: MarketCandlePoint[], mid: number | null): MarketSummary {
  if (candles.length === 0) {
    return {
      directionClass: "flat",
      directionMark: "◆",
      movePips: 0,
      rangePips: 0,
      label: "NO DATA",
    };
  }

  const first = candles[0];
  const last = candles.at(-1);
  const latest = mid ?? last?.close ?? first.close;
  const movePips = Number(((latest - first.open) / 0.01).toFixed(1));
  const high = Math.max(...candles.map((item) => item.high));
  const low = Math.min(...candles.map((item) => item.low));
  const rangePips = Number(((high - low) / 0.01).toFixed(1));

  if (movePips > 1) {
    return {
      directionClass: "profit",
      directionMark: "▲",
      movePips,
      rangePips,
      label: "BULLISH",
    };
  }

  if (movePips < -1) {
    return {
      directionClass: "loss",
      directionMark: "▼",
      movePips,
      rangePips,
      label: "BEARISH",
    };
  }

  return {
    directionClass: "flat",
    directionMark: "◆",
    movePips,
    rangePips,
    label: "RANGE",
  };
}

function buildRateMemo(summary: MarketSummary) {
  if (summary.label === "BULLISH") {
    return `公開レートは始値比で ${formatPipsSigned(summary.movePips)}。短期は買い優勢です。`;
  }

  if (summary.label === "BEARISH") {
    return `公開レートは始値比で ${formatPipsSigned(summary.movePips)}。短期は売り優勢です。`;
  }

  return `公開レートは始値比で ${formatPipsSigned(summary.movePips)}。短期は方向感が薄い状態です。`;
}

function getRecentTokyoDates(days: number) {
  const dates: string[] = [];
  const now = new Date();

  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - offset);
    dates.push(formatTokyoDateKey(date));
  }

  return dates;
}

function formatTokyoDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}${month}${day}`;
}

function formatFx(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatPips(value: number) {
  return `${Math.abs(value).toFixed(1)} pips`;
}

function formatPipsSigned(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)} pips`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDateKey(value: string) {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }

  return `${value.slice(0, 4)}/${value.slice(4, 6)}/${value.slice(6, 8)}`;
}
