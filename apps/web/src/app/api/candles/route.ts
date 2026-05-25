import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787";
  const upstreamUrl = new URL("/candles", baseUrl);

  for (const [key, value] of request.nextUrl.searchParams) {
    upstreamUrl.searchParams.append(key, value);
  }

  const response = await fetch(upstreamUrl, { cache: "no-store" }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Candle lookup failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  });

  if (response instanceof NextResponse) {
    return response;
  }

  const body = await response.json().catch(() => null);

  return NextResponse.json(body ?? { ok: false, error: "Candle lookup failed." }, {
    status: response.status,
  });
}
