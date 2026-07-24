import { ServerDetailClient } from "./server-detail-client";

export default async function ServerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ServerDetailClient id={id} />;
}
