"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Moon, Sun, Monitor, RefreshCw } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { usePollingFetch } from "@/lib/hooks/use-polling-fetch";
import { cn } from "@/lib/utils";

type TailscaleStatus = { connected: boolean; hostname?: string; ip?: string };

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [origin, setOrigin] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const { data: tailscale, refetch: refetchTailscale } = usePollingFetch<TailscaleStatus>(
    "/api/settings/tailscale",
    15000
  );

  useEffect(() => {
    setMounted(true);
    setOrigin(window.location.origin);
  }, []);

  async function connectTailscale() {
    setConnecting(true);
    try {
      const res = await fetch("/api/settings/tailscale", { method: "POST" });
      if (!res.ok) throw new Error();
      await refetchTailscale();
    } catch {
      toast.error("Failed to bring up Tailscale — is it installed?");
    } finally {
      setConnecting(false);
    }
  }

  const hostname = origin ? new URL(origin).hostname : "";
  const isLocalOnly = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const portSuffix = origin && new URL(origin).port ? `:${new URL(origin).port}` : "";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Gateway connection info and preferences.</p>
      </div>

      {mounted && !isLocalOnly && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>This dashboard is reachable beyond localhost</AlertTitle>
          <AlertDescription>
            There is no login on this dashboard by design — it&apos;s meant for personal, single-user
            use. Anyone who can reach <code className="font-mono">{origin}</code> can manage servers,
            endpoints, and tokens. Keep this behind a firewall, VPN, or SSH tunnel unless you add your
            own access control in front of it.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>The base URL clients use to reach this gateway.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block rounded-md bg-muted px-3 py-2 text-sm">{origin ?? "…"}</code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Tailscale
            {tailscale && (
              <Badge variant={tailscale.connected ? "default" : "outline"} className="font-normal">
                {tailscale.connected ? "Connected" : "Not connected"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Reach this gateway from any device on your tailnet, without exposing it publicly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tailscale?.connected ? (
            <div className="space-y-2">
              {tailscale.hostname && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">
                    http://{tailscale.hostname}
                    {portSuffix}
                  </code>
                  <CopyButton text={`http://${tailscale.hostname}${portSuffix}`} />
                </div>
              )}
              {tailscale.ip && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">
                    http://{tailscale.ip}
                    {portSuffix}
                  </code>
                  <CopyButton text={`http://${tailscale.ip}${portSuffix}`} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                This address includes the gateway&apos;s port so it&apos;s directly reachable. It&apos;s
                also offered as a config option on each endpoint&apos;s copy-config panel.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Not connected. Requires the{" "}
                <code className="font-mono text-xs">tailscale</code> CLI installed on this host.
              </p>
              <Button variant="outline" size="sm" onClick={connectTailscale} disabled={connecting}>
                <RefreshCw className={connecting ? "size-3.5 animate-spin" : "size-3.5"} />
                Connect Tailscale
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant="outline"
                size="sm"
                className={cn(mounted && theme === value && "border-primary text-primary")}
                onClick={() => setTheme(value)}
              >
                <Icon className="size-3.5" />
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>MCP Gateway v0.1.0</p>
          <p>Single-user, self-hosted MCP aggregation gateway.</p>
        </CardContent>
      </Card>
    </div>
  );
}
