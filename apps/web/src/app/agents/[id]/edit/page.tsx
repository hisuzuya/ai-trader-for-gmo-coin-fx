import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditAgentRedirectPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/agents/${id}?tab=settings`);
}
