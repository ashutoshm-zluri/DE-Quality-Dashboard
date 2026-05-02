import type { ReactNode } from "react";
import { InboxIcon } from "lucide-react";

interface Props {
  title: string;
  hint?: ReactNode;
  icon?: ReactNode;
}

export default function EmptyState({ title, hint, icon }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <div className="rounded-full bg-ink-100 p-3 text-ink-500">
        {icon ?? <InboxIcon className="h-6 w-6" />}
      </div>
      <div className="text-sm font-medium text-ink-700">{title}</div>
      {hint && (
        <div className="max-w-sm text-xs leading-relaxed text-ink-500">
          {hint}
        </div>
      )}
    </div>
  );
}
