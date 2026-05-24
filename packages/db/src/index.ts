export { checkDbConnection, db, pgPool } from "./client.js";
export * from "./schema/index.js";
export {
  CandleRepository,
  toCandleInsertRows,
} from "./repositories/candle-repository.js";
export {
  DbJobRunRecorder,
  runRecordedJob,
  summarizeError,
  type JobRunMetadata,
  type JobRunRecorder,
  type JobRunStatus,
  type StartedJobRun,
} from "./repositories/job-run-recorder.js";
