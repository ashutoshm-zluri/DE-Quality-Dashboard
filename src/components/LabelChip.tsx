import { Check, X } from "lucide-react";
import type { Label, LabelColor } from "../types";
import Pill, { type PillTone } from "./Pill";

const TONE: Record<LabelColor, PillTone> = {
  neutral: "neutral",
  red: "red",
  orange: "orange",
  amber: "amber",
  blue: "blue",
  violet: "violet",
  emerald: "emerald",
  ink: "ink",
};

interface Props {
  label: Label;
  onRemove?: () => void;
  onClick?: () => void;
  selected?: boolean;
}

export default function LabelChip({ label, onRemove, onClick, selected }: Props) {
  // When `onClick` is set we render as a button (toggle in pickers).
  //
  // For the "selected" state in a picker we use opacity + a leading Check
  // icon — no outer ring, so the chip's hit area is exactly its visible
  // shape (the previous ring + ring-offset bled outside the pill).
  const tone = TONE[label.color] ?? "neutral";
  const isPicker = typeof onClick === "function";
  const showCheck = isPicker && selected;

  const inner = (
    <Pill tone={tone} Icon={showCheck ? Check : undefined}>
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-black/10"
          aria-label={`Remove ${label.name}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </Pill>
  );

  if (isPicker) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`rounded-full transition ${
          selected ? "" : "opacity-50 hover:opacity-100"
        }`}
      >
        {inner}
      </button>
    );
  }
  return inner;
}
