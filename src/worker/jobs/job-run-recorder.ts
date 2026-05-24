import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { jobRuns } from "@/shared/db/schema";

export type JobRunStatus = "running" | "succeeded" | "failed";

export type JobRunMetadata = Record<string, unknown>;

export type StartedJobRun = {
  id: string;
};

export interface JobRunRecorder {
  start(jobName: string, metadata?: JobRunMetadata): Promise<StartedJobRun>;
  succeed(jobRunId: string, metadata?: JobRunMetadata): Promise<void>;
  fail(jobRunId: string, errorSummary: string, metadata?: JobRunMetadata): Promise<void>;
}

export class DbJobRunRecorder implements JobRunRecorder {
  async start(jobName: string, metadata?: JobRunMetadata): Promise<StartedJobRun> {
    const [jobRun] = await db
      .insert(jobRuns)
      .values({
        jobName,
        status: "running",
        metadata,
      })
      .returning({ id: jobRuns.id });

    if (!jobRun) {
      throw new Error("Failed to create job run");
    }

    return jobRun;
  }

  async succeed(jobRunId: string, metadata?: JobRunMetadata): Promise<void> {
    await db
      .update(jobRuns)
      .set({
        finishedAt: new Date(),
        status: "succeeded",
        metadata,
      })
      .where(eq(jobRuns.id, jobRunId));
  }

  async fail(jobRunId: string, errorSummary: string, metadata?: JobRunMetadata): Promise<void> {
    await db
      .update(jobRuns)
      .set({
        errorSummary,
        finishedAt: new Date(),
        status: "failed",
        metadata,
      })
      .where(eq(jobRuns.id, jobRunId));
  }
}

export async function runRecordedJob<TResult>(
  recorder: JobRunRecorder,
  jobName: string,
  metadata: JobRunMetadata,
  run: (jobRun: StartedJobRun) => Promise<TResult>,
): Promise<{ jobRunId: string; result: TResult }> {
  const jobRun = await recorder.start(jobName, metadata);

  try {
    const result = await run(jobRun);
    await recorder.succeed(jobRun.id, {
      ...metadata,
      result,
    });
    return { jobRunId: jobRun.id, result };
  } catch (error) {
    await recorder.fail(jobRun.id, summarizeError(error), metadata);
    throw error;
  }
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return String(error).slice(0, 500);
}
