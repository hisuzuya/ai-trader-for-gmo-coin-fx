import { env } from "@ai-trade/config";
import {
  type GmoFxTicker,
  type MarketSymbol,
  parseGmoWebSocketTickerMessage,
} from "@ai-trade/domain/market-data";

import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

type WebSocketListener = (event: unknown) => void;

export interface TickerWebSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: WebSocketListener): void;
  removeEventListener(type: string, listener: WebSocketListener): void;
}

export type TickerWebSocketFactory = (url: string) => TickerWebSocket;

export interface CollectorServiceOptions {
  symbol?: MarketSymbol;
  url?: string;
  webSocketFactory?: TickerWebSocketFactory;
  reconnectBackoffMs?: number;
  autoReconnect?: boolean;
}

export class CollectorService implements WorkerService {
  readonly name = "collector";

  private state: ServiceState = "stopped";
  private socket: TickerWebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private connected = false;
  private latestTicker: GmoFxTicker | null = null;
  private lastReconnectReason: string | null = null;

  private readonly symbol: MarketSymbol;
  private readonly url: string;
  private readonly webSocketFactory: TickerWebSocketFactory;
  private readonly reconnectBackoffMs: number;
  private readonly autoReconnect: boolean;

  constructor(options: CollectorServiceOptions = {}) {
    this.symbol = options.symbol ?? "USD_JPY";
    this.url = options.url ?? env.GMO_FX_PUBLIC_WEBSOCKET_URL;
    this.webSocketFactory = options.webSocketFactory ?? createDefaultWebSocket;
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? 5_000;
    this.autoReconnect = options.autoReconnect ?? true;
  }

  async start(): Promise<void> {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.state = "starting";
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    this.state = "stopped";
    this.clearReconnectTimer();
    this.socket?.close();
    this.socket = null;
  }

  async health(): Promise<ServiceHealth> {
    return {
      name: this.name,
      state: this.state,
      details: {
        websocketConnected: this.connected,
        latestTickerTimestamp: this.latestTicker?.timestamp ?? null,
        lastReconnectReason: this.lastReconnectReason,
      },
    };
  }

  private connect(): void {
    this.clearReconnectTimer();
    const socket = this.webSocketFactory(this.url);
    this.socket = socket;

    socket.addEventListener("open", this.handleOpen);
    socket.addEventListener("message", this.handleMessage);
    socket.addEventListener("close", this.handleClose);
    socket.addEventListener("error", this.handleError);
  }

  private readonly handleOpen = () => {
    this.connected = true;
    this.state = "ready";
    this.lastReconnectReason = null;
    this.socket?.send(
      JSON.stringify({
        command: "subscribe",
        channel: "ticker",
        symbol: this.symbol,
      }),
    );
  };

  private readonly handleMessage = (event: unknown) => {
    const message = parseMessageEventData(event);
    this.latestTicker = parseGmoWebSocketTickerMessage(message);
  };

  private readonly handleClose = (event: unknown) => {
    this.connected = false;
    this.state = this.stopped ? "stopped" : "degraded";
    this.lastReconnectReason = closeReason(event);
    this.scheduleReconnect();
  };

  private readonly handleError = () => {
    this.connected = false;
    this.state = this.stopped ? "stopped" : "degraded";
    this.lastReconnectReason = "websocket error";
    this.scheduleReconnect();
  };

  private scheduleReconnect(): void {
    if (this.stopped || !this.autoReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectBackoffMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

function createDefaultWebSocket(url: string): TickerWebSocket {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is not available in this runtime.");
  }

  return new WebSocket(url);
}

function parseMessageEventData(event: unknown): unknown {
  const data =
    typeof event === "object" && event !== null && "data" in event
      ? (event as { data: unknown }).data
      : event;

  if (typeof data === "string") {
    return JSON.parse(data);
  }

  return data;
}

function closeReason(event: unknown): string {
  if (typeof event !== "object" || event === null) {
    return "websocket closed";
  }

  const code = "code" in event ? String(event.code) : "";
  const reason = "reason" in event ? String(event.reason) : "";
  const suffix = [code, reason].filter(Boolean).join(" ");

  return suffix ? `websocket closed: ${suffix}` : "websocket closed";
}
