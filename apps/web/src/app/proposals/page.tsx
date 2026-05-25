import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProposalsRedirectPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const params = new URLSearchParams({ kind: "proposals" });
  appendStringParam(params, "agentId", query.agentId);
  appendStringParam(params, "status", query.status);

  redirect(`/activity?${params.toString()}`);
}

function appendStringParam(
  params: URLSearchParams,
  key: string,
  value: string | string[] | undefined,
) {
  if (typeof value === "string" && value.length > 0) {
    params.set(key, value);
  }
}
