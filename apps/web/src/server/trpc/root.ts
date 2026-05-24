import { publicProcedure, router } from "@/server/trpc/init";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    service: "next-web",
    timestamp: new Date().toISOString(),
  })),
});

export type AppRouter = typeof appRouter;
