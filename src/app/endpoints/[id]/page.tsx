import { EndpointDetailClient } from "./endpoint-detail-client";

export default async function EndpointDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EndpointDetailClient id={id} />;
}
