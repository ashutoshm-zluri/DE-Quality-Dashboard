import type { SyncStatus } from "../types";
import Pill, { type PillTone } from "./Pill";

const TONE: Record<string, PillTone> = {
  Failed: "red",
  Running: "blue",
  Triggered: "violet",
  "Not Triggered": "orange",
  Completed: "emerald",
  "Not Started": "ink",
};

export default function StatusBadge({ status }: { status: SyncStatus }) {
  return (
    <Pill tone={TONE[status] ?? "neutral"} wide>
      {status}
    </Pill>
  );
}
