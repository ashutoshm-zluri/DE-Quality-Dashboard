import type { ReactNode } from "react";

/**
 * Single pill component used for every label across the app — status,
 * action, validator code, yes/no flags, etc. Uniform height (20px),
 * uniform padding, uniform font-size, uniform whitespace-nowrap.
 *
 * Pick the color via `tone`. Optionally pass an icon component as `Icon`.
 */

export type PillTone =
  | "neutral"
  | "red"
  | "orange"
  | "amber"
  | "blue"
  | "violet"
  | "emerald"
  | "ink";

const TONES: Record<PillTone, string> = {
  neutral: "bg-ink-100 text-ink-700 ring-1 ring-inset ring-ink-200",
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  orange: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200",
  amber: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  blue: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  violet: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  ink: "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200",
};

interface Props {
  tone?: PillTone;
  Icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  title?: string;
  /**
   * When true, the pill is padded to a uniform fixed width (large enough for
   * the longest status / action label) and its content is centered. Used by
   * StatusBadge and ActionBadge so every row in a table column is the same
   * size. Inline pills (e.g. yes/no flags, status codes) leave this off.
   */
  wide?: boolean;
}

export default function Pill({ tone = "neutral", Icon, children, title, wide }: Props) {
  return (
    <span
      className={`pill ${TONES[tone]} ${
        wide ? "w-32 justify-center" : ""
      }`}
      title={title}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  );
}
