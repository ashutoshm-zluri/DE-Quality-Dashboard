import type { RcaDoc, TeamMember } from "../types";
import { isAdmin } from "./auth";

/**
 * RCA write access mirrors the server-side `rcaWriteGuard`:
 * admin OR the doc's owner OR the doc's reviewer (matched by email).
 */
export function canEditRca(
  user: TeamMember | null | undefined,
  doc: Pick<RcaDoc, "owner" | "reviewer"> | null | undefined
): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (!doc) return false;
  const me = (user.email ?? "").toLowerCase();
  if (!me) return false;
  return (
    (doc.owner ?? "").toLowerCase() === me ||
    (doc.reviewer ?? "").toLowerCase() === me
  );
}

/**
 * Members tab and all member CRUD on settings is admin-only.
 */
export function canManageTeam(user: TeamMember | null | undefined): boolean {
  return isAdmin(user);
}

/**
 * Failure recovery actions (retrigger, mark-complete, re-run all,
 * refresh-statuses, edit failure tags) are admin-only on the server.
 */
export function canRecover(user: TeamMember | null | undefined): boolean {
  return isAdmin(user);
}

/**
 * Creating a new RCA / uploading is gated to member+ (viewers are read-only).
 */
export function canCreateRca(user: TeamMember | null | undefined): boolean {
  return !!user && (user.role === "admin" || user.role === "member");
}
