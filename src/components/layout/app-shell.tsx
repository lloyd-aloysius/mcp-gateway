"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Menu, Network } from "lucide-react";
import { toast } from "sonner";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function ShellFooter({ version, canSignOut }: { version: string; canSignOut: boolean }) {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const response = await fetch("/api/admin/session", { method: "DELETE" });
      if (!response.ok) throw new Error();
      window.location.replace("/login");
    } catch {
      toast.error("Could not sign out. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
      <span className="font-mono text-xs text-muted-foreground" aria-label={`Gateway version ${version}`}>
        v{version}
      </span>
      {canSignOut && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={signOut}>
          <LogOut className="size-4" aria-hidden="true" />
          {pending ? "Signing out…" : "Sign out"}
        </Button>
      )}
    </div>
  );
}

export function AppShell({ children, version, canSignOut }: {
  children: React.ReactNode;
  version: string;
  canSignOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  if (pathname === "/login") return children;

  return (
    <div className="flex h-full w-full">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:flex md:flex-col">
        <div className="flex items-center justify-between gap-2 px-4 py-4 border-b">
          <div className="flex items-center gap-2">
            <Network className="size-5 text-primary" />
            <span className="font-semibold">MCP Gateway</span>
          </div>
          <ThemeToggle />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks />
        </div>
        <ShellFooter version={version} canSignOut={canSignOut} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="flex w-64 flex-col p-0">
              <div className="flex items-center gap-2 px-4 py-4 border-b">
                <Network className="size-5 text-primary" />
                <SheetTitle>MCP Gateway</SheetTitle>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <NavLinks onNavigate={() => setOpen(false)} />
              </div>
              <ShellFooter version={version} canSignOut={canSignOut} />
            </SheetContent>
          </Sheet>
          <span className="flex-1 font-semibold">MCP Gateway</span>
          <ThemeToggle />
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
