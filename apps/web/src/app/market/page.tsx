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

export default async function MarketPage({ searchParams }: { searchParams?: MarketSearchParams }) {
  const params = (await searchParams) ?? {};
  const interval = parseTimeframe(params.interval);
  const priceType = parsePriceType(params.priceType);
  const market = await getPublicMarketSnapshot(interval, priceType);
  const summary = summarizeMarket(market.candles, market.ticker?.mid ?? null);
  const intervalLabel = getTimeframeLabel(interval);

  return (
    <main className="tv-shell tv-market-shell">
      <aside className="tv-sidebar" aria-label="マーケットナビゲーション">
        <Link
          className="tv-sidebar-btn"
          href="/"
          title="ダッシュボード"
          aria-label="ダッシュボード"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12 L12 3 L21 12" />
            <path d="M5 10 L5 21 L19 21 L19 10" />
          </svg>
        </Link>
        <Link
          className="tv-sidebar-btn active"
          href="/market"
          title="チャート"
          aria-label="チャート"
          aria-current="page"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19 L4 5" />
            <path d="M8 17 L8 8" />
            <path d="M12 20 L12 4" />
            <path d="M16 16 L16 9" />
            <path d="M20 18 L20 6" />
          </svg>
        </Link>
      </aside>

      <header className="tv-topbar">
        <div className="tv-topbar-left">
          <div className="tv-brand">
            <span className="tv-brand-logo">AT</span>
            <span className="tv-brand-name">AI Trade</span>
            <span className="tv-brand-sub">USD/JPY · Public Market</span>
          </div>
        </div>
        <div className="tv-topbar-right">
          <span className="tv-system-pill">
            <span className={`tv-status-dot ${market.ticker ? "live" : "danger"}`} />
            {market.ticker ? "公開API接続" : "取得失敗"}
          </span>
          <span className="tv-clock">
            {market.ticker ? formatDateTime(market.ticker.timestamp) : "—"}
          </span>
        </div>
      </header>

      <div className="tv-market-ticker">
        <MarketTile
          label="USD/JPY MID"
          sub="GMO FX Public"
          value={market.ticker ? formatFx(market.ticker.mid) : "—"}
          accent
        />
        <MarketTile
          label="BID / ASK"
          sub="Live quote"
          value={
            market.ticker ? `${formatFx(market.ticker.bid)} / ${formatFx(market.ticker.ask)}` : "—"
          }
        />
        <MarketTile
          label="Spread"
          sub="Execution cost"
          value={market.ticker ? `${market.ticker.spreadPips.toFixed(1)} pips` : "—"}
        />
        <MarketTile
          label="Session Bias"
          sub={`${intervalLabel} ${priceType}`}
          value={summary.label}
          tone={summary.directionClass}
        />
      </div>

      <div className="tv-market-main">
        <section
          className="tv-panel tv-chart-panel tv-market-chart"
          aria-label="USD/JPY ローソク足"
        >
          <PanelHeader
            title={`USD/JPY ${intervalLabel} / Public ${priceType} Candles`}
            meta={market.sourceDate ? `${formatDateKey(market.sourceDate)} GMO FX` : "public API"}
          />
          <div className="tv-panel-body">
            <div className="tv-chart-toolbar">
              <nav className="tv-segment" aria-label="時間足">
                {TIMEFRAMES.map((timeframe) => (
                  <Link
                    className={`tv-segment-btn ${timeframe.value === interval ? "active" : ""}`}
                    href={buildMarketHref(timeframe.value, priceType)}
                    key={timeframe.value}
                    aria-current={timeframe.value === interval ? "page" : undefined}
                  >
                    {timeframe.label}
                  </Link>
                ))}
              </nav>
              <nav className="tv-segment compact" aria-label="価格種別">
                {(["BID", "ASK"] as const).map((item) => (
                  <Link
                    className={`tv-segment-btn ${item === priceType ? "active" : ""}`}
                    href={buildMarketHref(interval, item)}
                    key={item}
                    aria-current={item === priceType ? "page" : undefined}
                  >
                    {item}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="tv-chart-summary">
              <div className="tv-chart-headline">
                <span className="tv-chart-headline-label">MID / Live Rate</span>
                <span className={`tv-chart-headline-value ${summary.directionClass}`}>
                  {market.ticker ? formatFx(market.ticker.mid) : "—"}
                  <span className="tv-chart-headline-delta">
                    {summary.directionMark} {formatPipsSigned(summary.movePips)}
                  </span>
                </span>
              </div>
              <div className="tv-chart-stats">
                <div className="tv-chart-stat">
                  <span className="tv-chart-stat-label">Bid / Ask</span>
                  <span className="tv-chart-stat-value">
                    {market.ticker
                      ? `${formatFx(market.ticker.bid)} / ${formatFx(market.ticker.ask)}`
                      : "—"}
                  </span>
                </div>
                <div className="tv-chart-stat">
                  <span className="tv-chart-stat-label">Spread</span>
                  <span className="tv-chart-stat-value">
                    {market.ticker ? `${market.ticker.spreadPips.toFixed(1)} pips` : "—"}
                  </span>
                </div>
                <div className="tv-chart-stat">
                  <span className="tv-chart-stat-label">Range</span>
                  <span className="tv-chart-stat-value">{formatPips(summary.rangePips)}</span>
                </div>
              </div>
            </div>

            {market.candles.length > 0 ? (
              <MarketCandleChart data={market.candles} interval={interval} />
            ) : (
              <div className="tv-chart-empty">
                {market.error ?? "公開 API のローソク足が取得できませんでした"}
              </div>
            )}
          </div>
        </section>

        <aside className="tv-panel" aria-label="AI レート判断">
          <PanelHeader title="AI レート判断 / Rate Lens" meta={summary.label} />
          <div className="tv-panel-body">
            <div className="tv-rate-lens">
              <div className="tv-rate-lens-main">
                <span className="tv-rate-lens-label">現在レート</span>
                <strong>{market.ticker ? formatFx(market.ticker.mid) : "—"}</strong>
                <span className={`tv-rate-lens-bias ${summary.directionClass}`}>
                  {summary.label}
                </span>
              </div>
              <div className="tv-rate-grid">
                <RateCell label="BID" value={market.ticker ? formatFx(market.ticker.bid) : "—"} />
                <RateCell label="ASK" value={market.ticker ? formatFx(market.ticker.ask) : "—"} />
                <RateCell
                  label="Spread"
                  value={market.ticker ? `${market.ticker.spreadPips.toFixed(1)} pips` : "—"}
                />
                <RateCell label="Volatility" value={formatPips(summary.rangePips)} />
              </div>
              <div className="tv-ai-note">
                <span className="tv-ai-note-title">AIメモ</span>
                <p>{buildRateMemo(summary)}</p>
              </div>
              <div className="tv-rate-meta">
                <span>API: GMO FX Public</span>
                <span>Market: {market.marketStatus ?? "—"}</span>
                <span>Tick: {market.symbolRule ? market.symbolRule.tickSize : "—"}</span>
                <span>
                  Updated: {market.ticker ? formatDateTime(market.ticker.timestamp) : "—"}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <footer className="tv-statusbar" role="contentinfo" aria-label="ステータス">
        <span className="tv-statusbar-item">
          <span className={`tv-status-dot sm ${market.ticker ? "live" : "danger"}`} />
          <strong>{market.ticker ? "CONNECTED" : "DEGRADED"}</strong>
        </span>
        <span className="tv-statusbar-sep" />
        <span className="tv-statusbar-item">
          Source <strong>GMO FX PUBLIC</strong>
        </span>
        <span className="tv-statusbar-sep" />
        <span className="tv-statusbar-item optional">
          Symbol <strong>USD/JPY</strong>
        </span>
        <span className="tv-statusbar-spacer" />
        <span className="tv-statusbar-item">
          Bias <strong>{summary.label}</strong>
        </span>
      </footer>
    </main>
  );
}

function MarketTile({
  label,
  sub,
  value,
  accent = false,
  tone,
}: {
  label: string;
  sub: string;
  value: string;
  accent?: boolean;
  tone?: MarketSummary["directionClass"];
}) {
  return (
    <div className="tv-ticker-tile">
      <span className="tv-ticker-label">
        <span>{label}</span>
        <span>{sub}</span>
      </span>
      <span className={`tv-ticker-value compact ${accent ? "accent" : ""} ${tone ?? ""}`}>
        {value}
      </span>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="tv-panel-header">
      <div className="tv-panel-title">
        <span className="tv-panel-title-bar" />
        {title}
      </div>
      <span className="tv-panel-meta">{meta}</span>
    </div>
  );
}

function RateCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="tv-rate-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
