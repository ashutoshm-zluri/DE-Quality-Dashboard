import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  ShieldX,
  Undo2,
  XCircle,
} from "lucide-react";
import type { RecoveryState } from "../types";
import Pill, { type PillTone } from "./Pill";

const BY_STATE: Record<
  RecoveryState,
  { tone: PillTone; label: string; Icon: typeof Circle }
> = {
  PLANNED: { tone: "neutral", label: "Planned", Icon: Clock },
  READY: { tone: "neutral", label: "Ready", Icon: Clock },
  EXECUTING: { tone: "blue", label: "Executing", Icon: Loader2 },
  SUCCEEDED: { tone: "emerald", label: "Succeeded", Icon: CheckCircle2 },
  FAILED: { tone: "red", label: "Failed", Icon: XCircle },
  SKIPPED: { tone: "neutral", label: "Skipped", Icon: Circle },
  BLOCKED: { tone: "amber", label: "Blocked", Icon: ShieldX },
  UNDONE: { tone: "violet", label: "Undone", Icon: Undo2 },
  POISONED: { tone: "red", label: "Poisoned", Icon: AlertOctagon },
};

export default function RecoveryStateBadge({ state }: { state: RecoveryState }) {
  const cfg = BY_STATE[state] ?? {
    tone: "neutral" as PillTone,
    label: state,
    Icon: AlertTriangle,
  };
  return (
    <Pill tone={cfg.tone} Icon={cfg.Icon}>
      {cfg.label}
    </Pill>
  );
}

export { BY_STATE as RECOVERY_STATE_STYLES };
