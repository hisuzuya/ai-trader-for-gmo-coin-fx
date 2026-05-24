export { checkDbConnection, db, pgPool } from "./client.js";
export {
  CandleRepository,
  toCandleInsertRows,
} from "./repositories/candle-repository.js";
export {
  DbJobRunRecorder,
  type JobRunMetadata,
  type JobRunRecorder,
  type JobRunStatus,
  runRecordedJob,
  type StartedJobRun,
  summarizeError,
} from "./repositories/job-run-recorder.js";
export {
  toPaperAccountInsertRow,
  toPaperOrderInsertRow,
  toPaperPositionInsertRow,
  toPaperTradeInsertRow,
} from "./repositories/paper-trading-repository.js";
export * from "./schema/index.js";
