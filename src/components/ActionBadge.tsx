import {
  AlertOctagon,
  CheckCircle2,
  Hand,
  Hourglass,
  Pause,
  RotateCw,
} from "lucide-react";
import type { RecommendedAction } from "../types";
import Pill, { type PillTone } from "./Pill";

const META: Record<
  RecommendedAction,
  { tone: PillTone; label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  MARK_COMPLETE: { tone: "emerald", label: "Mark complete", Icon: CheckCircle2 },
  RETRIGGER: { tone: "blue", label: "Retrigger", Icon: RotateCw },
  TRIGGERED: { tone: "violet", label: "Triggered", Icon: Hourglass },
  SKIP_RUNNING: { tone: "amber", label: "Stuck running", Icon: Pause },
  MANUAL_REVIEW: { tone: "red", label: "Manual review", Icon: AlertOctagon },
  SKIP_OUT_OF_WINDOW: { tone: "ink", label: "Out of window", Icon: Hand },
};

export default function ActionBadge({ action }: { action: RecommendedAction }) {
  const m = META[action];
  if (!m) return <Pill wide>{action}</Pill>;
  return (
    <Pill tone={m.tone} Icon={m.Icon} wide>
      {m.label}
    </Pill>
  );
}
