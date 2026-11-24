import { GatewayOverview } from "@/components/flow/gateway-overview";

export const metadata = { title: "Live visualization · MCP Gateway", robots: { index: false, follow: false } };
export default function VisualizationPage() { return <GatewayOverview viewer />; }
