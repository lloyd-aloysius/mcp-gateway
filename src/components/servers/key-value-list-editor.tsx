"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Row = { id: string; key: string; value: string };

function recordToRows(record: Record<string, string>): Row[] {
  return Object.entries(record).map(([key, value]) => ({ id: crypto.randomUUID(), key, value }));
}

function rowsToRecord(rows: Row[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) record[row.key] = row.value;
  }
  return record;
}

export function KeyValueListEditor({
  value,
  onChange,
  onCommit,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
  addLabel = "Add",
  emptyLabel = "None set",
  className,
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  /** Fires on blur of a row's input, not on every keystroke — for callers that want to save on commit rather than on change. */
  onCommit?: (value: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => recordToRows(value));
  const lastEmittedRef = useRef(value);

  // Resync from the value prop only when it changed for a reason other than this component's
  // own last onChange call (reference-equality check) — keeps typing from losing focus while
  // still picking up external resets (e.g. a form's `reset()` on reopen).
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setRows(recordToRows(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  function emit(nextRows: Row[]) {
    setRows(nextRows);
    const record = rowsToRecord(nextRows);
    lastEmittedRef.current = record;
    onChange(record);
  }

  function commit(nextRows: Row[]) {
    onCommit?.(rowsToRecord(nextRows));
  }

  function addRow() {
    emit([...rows, { id: crypto.randomUUID(), key: "", value: "" }]);
  }

  function removeRow(id: string) {
    const next = rows.filter((r) => r.id !== id);
    emit(next);
    commit(next);
  }

  function updateRow(id: string, field: "key" | "value", text: string) {
    emit(rows.map((r) => (r.id === id ? { ...r, [field]: text } : r)));
  }

  return (
    <div className={cn("space-y-2", className)}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-1.5">
              <Input
                value={row.key}
                onChange={(e) => updateRow(row.id, "key", e.target.value)}
                onBlur={() => commit(rows)}
                placeholder={keyPlaceholder}
                className="font-mono text-xs"
              />
              <Input
                value={row.value}
                onChange={(e) => updateRow(row.id, "value", e.target.value)}
                onBlur={() => commit(rows)}
                placeholder={valuePlaceholder}
                className="font-mono text-xs"
              />
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeRow(row.id)}>
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="size-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
