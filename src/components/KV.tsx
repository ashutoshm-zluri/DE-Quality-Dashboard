import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { useState } from "react";

interface Props {
  label: string;
  value: ReactNode;
  copy?: string;
  mono?: boolean;
}

export default function KV({ label, value, copy, mono }: Props) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!copy) return;
    await navigator.clipboard.writeText(copy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1100);
  };

  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-44 shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-500">
        {label}
      </div>
      <div
        className={`min-w-0 flex-1 break-words text-sm ${
          mono ? "mono text-ink-800" : "text-ink-800"
        }`}
      >
        {value || <span className="text-ink-400">—</span>}
      </div>
      {copy && (
        <button
          type="button"
          onClick={onCopy}
          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          aria-label="Copy"
          title={copied ? "Copied!" : "Copy"}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
