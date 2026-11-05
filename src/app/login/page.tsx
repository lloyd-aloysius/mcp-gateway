"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Network } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Login() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        window.location.replace("/");
        return;
      }
      const result = await response.json().catch(() => null);
      setError(result?.error ?? "Sign-in failed. Try again.");
    } catch {
      setError("Could not reach the gateway. Try again.");
    }
    setPending(false);
  }

  return (
    <main className="relative grid min-h-full flex-1 place-items-center overflow-y-auto px-5 py-14">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <Card className="glass-panel w-full max-w-sm gap-6 p-7 ring-0 backdrop-blur-2xl sm:p-8">
        <CardHeader className="gap-2 p-0">
          <div className="mb-2 grid size-11 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <Network className="size-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-primary">MCP Gateway</p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to your gateway</h1>
          <CardDescription>Enter your admin token to open the dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <form action="/api/admin/session" method="post" onSubmit={signIn} className="grid gap-4">
            <div className="grid gap-2">
              <input autoComplete="username" name="username" defaultValue="admin" hidden />
              <label htmlFor="admin-token" className="text-sm font-medium">Admin token</label>
              <Input
                id="admin-token"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "sign-in-error" : undefined}
                className="h-10"
              />
            </div>
            {error && <p id="sign-in-error" role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
