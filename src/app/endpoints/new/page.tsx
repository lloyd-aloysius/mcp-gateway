"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, PartyPopper } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { CopyConfigPanel } from "@/components/endpoints/copy-config-panel";

const formSchema = z.object({
  name: z.string().min(1, "required"),
  slug: z.string().min(1, "required").regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  defaultPolicy: z.enum(["allow_all", "deny_all"]),
});

type FormValues = z.infer<typeof formSchema>;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function NewEndpointPage() {
  const router = useRouter();
  const [created, setCreated] = useState<{
    id: string;
    slug: string;
    tokenPrefix: string;
    token: string;
  } | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", slug: "", defaultPolicy: "deny_all" },
  });

  async function onSubmit(values: FormValues) {
    const res = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error && typeof data.error === "string" ? data.error : "Failed to create endpoint");
      return;
    }

    const data = await res.json();
    setCreated({ id: data.id, slug: data.slug, tokenPrefix: data.tokenPrefix, token: data.token });
  }

  if (created) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-6">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <PartyPopper className="size-5" />
          <h1 className="text-xl font-semibold">Endpoint created</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Copy this token now</CardTitle>
            <CardDescription>
              For security, this is the only time the full token is shown. Paste this config into your
              MCP client to connect.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CopyConfigPanel
              endpointId={created.id}
              slug={created.slug}
              tokenPrefix={created.tokenPrefix}
              revealedToken={created.token}
              onTokenRegenerated={(token) => setCreated((c) => (c ? { ...c, token } : c))}
            />
          </CardContent>
        </Card>
        <Button onClick={() => router.push(`/endpoints/${created.id}`)}>
          Done — go to endpoint settings
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-6 space-y-6">
      <Link
        href="/endpoints"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to endpoints
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New client endpoint</h1>
        <p className="text-sm text-muted-foreground">
          Creates a unique URL + token a client can connect with.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Claude Desktop — Home"
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      if (!slugTouched) form.setValue("slug", slugify(e.target.value));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Slug</FormLabel>
                <FormControl>
                  <Input
                    placeholder="claude-desktop-home"
                    {...field}
                    onChange={(e) => {
                      setSlugTouched(true);
                      field.onChange(e);
                    }}
                  />
                </FormControl>
                <FormDescription>Used in the connection URL: /api/mcp/{field.value || "…"}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="defaultPolicy"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default access policy</FormLabel>
                <FormControl>
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-3">
                    <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[[data-state=checked]]:border-primary">
                      <RadioGroupItem value="deny_all" id="deny_all" className="mt-0.5" />
                      <div>
                        <Label htmlFor="deny_all" className="font-medium">
                          Deny everything, then grant
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Safer default — explicitly allow only the servers this client needs.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[[data-state=checked]]:border-primary">
                      <RadioGroupItem value="allow_all" id="allow_all" className="mt-0.5" />
                      <div>
                        <Label htmlFor="allow_all" className="font-medium">
                          Allow everything, then restrict
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Convenient for trusted clients — explicitly deny anything sensitive.
                        </p>
                      </div>
                    </label>
                  </RadioGroup>
                </FormControl>
              </FormItem>
            )}
          />

          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {form.formState.isSubmitting ? "Creating…" : "Create endpoint"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
