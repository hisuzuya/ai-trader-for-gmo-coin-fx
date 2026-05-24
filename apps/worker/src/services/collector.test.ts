import { describe, expect, it } from "vitest";

import { CollectorService, type TickerWebSocket } from "./collector.js";

describe("CollectorService", () => {
  it("subscribes to GMO ticker channel and exposes latest ticker status", async () => {
    const socket = new FakeTickerWebSocket();
    const service = new CollectorService({
      url: "wss://example.test/ws",
      webSocketFactory: () => socket,
      autoReconnect: false,
    });

    await service.start();
    socket.emit("open");
    socket.emit("message", {
      data: JSON.stringify({
        symbol: "USD_JPY",
        bid: "156.100",
        ask: "156.103",
        timestamp: "2026-05-24T08:51:51.000Z",
        status: "OPEN",
      }),
    });

    await expect(service.health()).resolves.toEqual({
      name: "collector",
      state: "ready",
      details: {
        websocketConnected: true,
        latestTickerTimestamp: "2026-05-24T08:51:51.000Z",
        lastReconnectReason: null,
      },
    });
    expect(socket.sent).toEqual([
      JSON.stringify({
        command: "subscribe",
        channel: "ticker",
        symbol: "USD_JPY",
      }),
    ]);
  });

  it("marks websocket as degraded when the stream closes", async () => {
    const socket = new FakeTickerWebSocket();
    const service = new CollectorService({
      url: "wss://example.test/ws",
      webSocketFactory: () => socket,
      autoReconnect: false,
    });

    await service.start();
    socket.emit("open");
    socket.emit("close", { code: 1006, reason: "abnormal closure" });

    await expect(service.health()).resolves.toMatchObject({
      name: "collector",
      state: "degraded",
      details: {
        websocketConnected: false,
        lastReconnectReason: "websocket closed: 1006 abnormal closure",
      },
    });
  });
});

class FakeTickerWebSocket implements TickerWebSocket {
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", { code: 1000, reason: "normal closure" });
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}
