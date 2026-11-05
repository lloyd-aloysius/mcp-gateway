"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CONFIG_SERVER_NAME = "mcp-gateway";

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function CopyConfigPanel({
  endpointId,
  slug,
  tokenPrefix,
  revealedToken,
  onTokenRegenerated,
  clientIdHeader,
  authMode = "bearer",
}: {
  endpointId: string;
  slug: string;
  tokenPrefix: string;
  revealedToken?: string | null;
  onTokenRegenerated: (token: string) => void;
  clientIdHeader?: string;
  authMode?: "bearer" | "oauth";
}) {
  const [origin, setOrigin] = useState("http://localhost:3000");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [tailscale, setTailscale] = useState<{ connected: boolean; hostname?: string; clientOrigin?: string } | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/settings/tailscale")
      .then((res) => (res.ok ? res.json() : null))
      .then(setTailscale)
      .catch(() => setTailscale(null));
  }, []);

  const tokenDisplay = revealedToken ?? `${tokenPrefix}${"•".repeat(32)}`;
  const url = `${tailscale?.clientOrigin ?? origin}/api/mcp/${slug}`;

  const headers: Record<string, string> = authMode === "bearer" ? { Authorization: `Bearer ${tokenDisplay}` } : {};
  if (clientIdHeader) headers["X-MCP-Client-Id"] = clientIdHeader;

  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        [CONFIG_SERVER_NAME]: {
          type: "http",
          url,
          headers,
        },
      },
    },
    null,
    2
  );

  const cliConfig = [
    `claude mcp add --transport http ${CONFIG_SERVER_NAME} ${shellQuote(url)}`,
    ...Object.entries(headers).map(([key, value]) => `--header ${shellQuote(key + ": " + value)}`),
  ]
    .filter(Boolean)
    .join(" ");

  const tailscaleUrl =
    authMode === "bearer" && !tailscale?.clientOrigin && tailscale?.connected && tailscale.hostname
      ? (() => {
          try {
            const u = new URL(url);
            u.hostname = tailscale.hostname!;
            return u.toString();
          } catch {
            return null;
          }
        })()
      : null;

  const tailscaleJsonConfig = tailscaleUrl
    ? JSON.stringify(
        { mcpServers: { [CONFIG_SERVER_NAME]: { type: "http", url: tailscaleUrl, headers } } },
        null,
        2
      )
    : null;

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/endpoints/${endpointId}/regenerate-token`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to regenerate token");
      const data = await res.json();
      onTokenRegenerated(data.token);
      toast.success("Token regenerated — copy it now, it won't be shown again");
    } catch {
      toast.error("Failed to regenerate token");
    } finally {
      setRegenerating(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-3">
      {authMode === "oauth" && <p className="text-xs text-muted-foreground">This endpoint signs in through its configured OAuth issuer.</p>}
      {authMode === "bearer" && !revealedToken && (
        <p className="text-xs text-muted-foreground">
          The full token is only ever shown once. This config uses a masked placeholder — regenerate
          the token to get a fresh, copyable value.
        </p>
      )}
      <Tabs defaultValue="json">
        <TabsList>
          <TabsTrigger value="json">mcp.json</TabsTrigger>
          <TabsTrigger value="cli">Claude CLI</TabsTrigger>
          {tailscaleJsonConfig && <TabsTrigger value="tailscale">Tailscale</TabsTrigger>}
        </TabsList>
        <TabsContent value="json" className="space-y-2">
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{jsonConfig}</pre>
          <CopyButton text={jsonConfig} />
        </TabsContent>
        <TabsContent value="cli" className="space-y-2">
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
            {cliConfig}
          </pre>
          <CopyButton text={cliConfig} />
        </TabsContent>
        {tailscaleJsonConfig && (
          <TabsContent value="tailscale" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Uses this gateway&apos;s Tailscale hostname instead of the local origin — reachable from
              any device on your tailnet.
            </p>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
              {tailscaleJsonConfig}
            </pre>
            <CopyButton text={tailscaleJsonConfig} />
          </TabsContent>
        )}
      </Tabs>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={regenerating}
      >
        <RefreshCw className="size-3.5" />
        Regenerate token
      </Button>

      {authMode === "bearer" && <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate token?</AlertDialogTitle>
            <AlertDialogDescription>
              The current token will stop working immediately. Any client using it will need the new
              one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={regenerate}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
    </div>
  );
}
