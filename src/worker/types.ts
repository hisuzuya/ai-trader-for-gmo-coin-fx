export type ServiceState = "starting" | "ready" | "stopped" | "degraded";

export type ServiceHealth = {
  name: string;
  state: ServiceState;
  details?: Record<string, unknown>;
};

export interface WorkerService {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<ServiceHealth>;
}

export type WorkerStatus = {
  startedAt: string;
  services: ServiceHealth[];
  latestTickerTimestamp: string | null;
  latestCandleOpenedAt: string | null;
  websocketConnected: boolean;
  lastReconnectReason: string | null;
  lastAiInvocationStatus: string | null;
};
