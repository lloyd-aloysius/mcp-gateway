"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { KeyValueListEditor } from "@/components/servers/key-value-list-editor";
import { parseServerConfigPaste } from "@/lib/server-config-import";

const formSchema = z
  .object({
    connectionType: z.enum(["stdio", "http", "sse"]),
    key: z.string().min(1, "required").regex(/^[a-zA-Z0-9-]+$/, "letters, numbers, hyphens only"),
    name: z.string().min(1, "required"),
    description: z.string().optional(),
    command: z.string().optional(),
    argsText: z.string().optional(),
    env: z.record(z.string(), z.string()),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()),
    enabled: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.connectionType === "stdio" && !data.command?.trim()) {
      ctx.addIssue({ code: "custom", path: ["command"], message: "required for stdio servers" });
    }
    if (data.connectionType !== "stdio") {
      if (!data.url?.trim()) {
        ctx.addIssue({ code: "custom", path: ["url"], message: "required" });
      } else {
        try {
          new URL(data.url);
        } catch {
          ctx.addIssue({ code: "custom", path: ["url"], message: "must be a valid URL" });
        }
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

const DEFAULT_VALUES: FormValues = {
  connectionType: "stdio",
  key: "",
  name: "",
  description: "",
  command: "npx",
  argsText: "",
  env: {},
  url: "",
  headers: {},
  enabled: true,
};

export function ServerFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"form" | "paste">("form");
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteInferred, setPasteInferred] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_VALUES,
  });

  useEffect(() => {
    if (open) {
      form.reset(DEFAULT_VALUES);
      setTab("form");
      setPasteText("");
      setPasteError(null);
      setPasteInferred(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const connectionType = form.watch("connectionType");

  function handleParsePaste() {
    const result = parseServerConfigPaste(pasteText);
    if (!result.ok) {
      setPasteError(result.error);
      return;
    }
    setPasteError(null);
    setPasteInferred(true);
    const parsed = result.value;
    form.reset({
      ...DEFAULT_VALUES,
      connectionType: parsed.connectionType,
      key: parsed.key ?? "",
      name: parsed.name ?? "",
      command: parsed.command ?? DEFAULT_VALUES.command,
      argsText: parsed.args?.join("\n") ?? "",
      env: parsed.env ?? {},
      url: parsed.url ?? "",
      headers: parsed.headers ?? {},
    });
    setTab("form");
  }

  async function onSubmit(values: FormValues) {
    const body =
      values.connectionType === "stdio"
        ? {
            connectionType: "stdio" as const,
            key: values.key,
            name: values.name,
            description: values.description || undefined,
            command: values.command!.trim(),
            args: values.argsText ? values.argsText.split("\n").map((s) => s.trim()).filter(Boolean) : [],
            env: Object.keys(values.env).length ? values.env : undefined,
            enabled: values.enabled,
          }
        : {
            connectionType: values.connectionType,
            key: values.key,
            name: values.name,
            description: values.description || undefined,
            url: values.url!.trim(),
            headers: Object.keys(values.headers).length ? values.headers : undefined,
            enabled: values.enabled,
          };

    const res = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error && typeof data.error === "string" ? data.error : "Failed to add server");
      return;
    }

    toast.success(`Server "${values.name}" added`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add backend MCP server</DialogTitle>
          <DialogDescription>
            Connect a stdio-based or remote MCP server. Its tools will be namespaced as{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">key__toolName</code>.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab((v as "form" | "paste") ?? "form")}>
          <TabsList>
            <TabsTrigger value="form">Guided form</TabsTrigger>
            <TabsTrigger value="paste">Paste config</TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Paste a server config — a bare <code className="font-mono">{"{command,args,env}"}</code> or{" "}
              <code className="font-mono">{"{url,headers}"}</code> object, or a full{" "}
              <code className="font-mono">{"{\"mcpServers\":{...}}"}</code> block. Nothing is submitted yet —
              it prefills the guided form below for you to review.
            </p>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'{\n  "command": "npx",\n  "args": ["-y", "some-mcp-server"],\n  "env": { "API_KEY": "..." }\n}'}
              className="min-h-32 font-mono text-xs"
            />
            {pasteError && (
              <Alert variant="destructive">
                <AlertDescription>{pasteError}</AlertDescription>
              </Alert>
            )}
            <Button type="button" variant="outline" size="sm" onClick={handleParsePaste} disabled={!pasteText.trim()}>
              Parse &amp; review
            </Button>
          </TabsContent>

          <TabsContent value="form">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {pasteInferred && (
                  <p className="text-xs text-muted-foreground">
                    Prefilled from pasted config — verify connection type and fields below before adding.
                  </p>
                )}
                <FormField
                  control={form.control}
                  name="connectionType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Connection type</FormLabel>
                      <Select
                        items={{
                          stdio: "Stdio (local command)",
                          http: "Streamable HTTP (remote)",
                          sse: "SSE (legacy remote)",
                        }}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="stdio">Stdio (local command)</SelectItem>
                          <SelectItem value="http">Streamable HTTP (remote)</SelectItem>
                          <SelectItem value="sse">SSE (legacy remote)</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 items-start gap-3">
                  <FormField
                    control={form.control}
                    name="key"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Key</FormLabel>
                        <FormControl>
                          <Input placeholder="filesystem" {...field} />
                        </FormControl>
                        <FormDescription>Used in tool names</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Display name</FormLabel>
                        <FormControl>
                          <Input placeholder="Filesystem" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="What is this server for?" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {connectionType === "stdio" ? (
                  <>
                    <FormField
                      control={form.control}
                      name="command"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Command</FormLabel>
                          <FormControl>
                            <Input placeholder="npx" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="argsText"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Arguments</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
                              className="font-mono text-sm"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>One argument per line</FormDescription>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="env"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Environment variables (optional)</FormLabel>
                          <KeyValueListEditor
                            value={field.value}
                            onChange={field.onChange}
                            keyPlaceholder="API_KEY"
                            valuePlaceholder="value"
                            addLabel="Add variable"
                            emptyLabel="No environment variables set"
                          />
                        </FormItem>
                      )}
                    />
                  </>
                ) : (
                  <>
                    <FormField
                      control={form.control}
                      name="url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>URL</FormLabel>
                          <FormControl>
                            <Input placeholder="https://example.com/mcp" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="headers"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Headers (optional)</FormLabel>
                          <KeyValueListEditor
                            value={field.value}
                            onChange={field.onChange}
                            keyPlaceholder="Authorization"
                            valuePlaceholder="Bearer ..."
                            addLabel="Add header"
                            emptyLabel="No headers set"
                          />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel>Enabled</FormLabel>
                        <FormDescription>Connect immediately after creating</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? "Adding…" : "Add server"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
