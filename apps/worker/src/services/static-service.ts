import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

export class StaticWorkerService implements WorkerService {
  private state: ServiceState = "stopped";

  constructor(public readonly name: string) {}

  async start(): Promise<void> {
    this.state = "ready";
  }

  async stop(): Promise<void> {
    this.state = "stopped";
  }

  async health(): Promise<ServiceHealth> {
    return {
      name: this.name,
      state: this.state,
      details: {
        phase: "phase0-scaffold",
      },
    };
  }
}
