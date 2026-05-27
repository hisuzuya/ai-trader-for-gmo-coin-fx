# AI observation is routed through the Research Tool Server

AI Agent / LLM tool loops read market data, Candidate Strategy performance, rejection history, memory, and skills only through the read-only Research Tool Server. The worker-side Deterministic Control Plane, Paper Trading, Adoption Gate, and Baseline Strategy lifecycle do not call MCP tools; they use `packages/db` repositories and `packages/domain` logic directly so transaction boundaries, replayability, and safety gates stay deterministic.

**Status**: accepted

**Consequences**:
MCP tools are an AI observation interface, not the system control plane. New data needed by AI Agents should be exposed as read-only Research Tool Server tools, while any state-changing workflow belongs in worker orchestration and domain validation.
