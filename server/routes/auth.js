import { Router } from "express";
import {
  AUTH_CONFIG,
  ensureMember,
  isDomainAllowed,
  requireAuth,
  signSession,
  verifyGoogleCredential,
} from "../auth.js";
import { shared } from "../dal/shared.js";

const router = Router();

function asyncHandler(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const credential = req.body?.credential;
    if (!credential) {
      return res.status(400).json({ error: "credential is required" });
    }

    const verified = await verifyGoogleCredential(credential);

    if (!isDomainAllowed(verified.email)) {
      return res
        .status(403)
        .json({
          error: `email domain not allowed; only @${AUTH_CONFIG.allowedDomain} accepted`,
        });
    }

    const member = await ensureMember(verified);

    const token = signSession({
      sub: member.id,
      email: member.email,
      name: member.name,
      role: member.role,
      picture: member.picture,
    });

    res.cookie(AUTH_CONFIG.cookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // localhost only; flip to true when behind https
      maxAge: AUTH_CONFIG.cookieMaxAge,
      path: "/",
    });

    res.json({ user: member });
  })
);

router.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});

/**
 * Self-update: any signed-in user can edit their own name + designation.
 * Email and role are protected — email is bound to Google, role is admin-only.
 */
router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const allowed = {};
    if (req.body?.name !== undefined) allowed.name = String(req.body.name);
    if (req.body?.designation !== undefined) {
      allowed.designation = String(req.body.designation);
    }
    if (Object.keys(allowed).length === 0) {
      return res
        .status(400)
        .json({ error: "no allowed fields to update (name, designation)" });
    }
    const updated = await shared.updateMember(req.user.id, allowed);
    // Re-sign so the cookie reflects the new name immediately on next request.
    const token = signSession({
      sub: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      picture: updated.picture,
    });
    res.cookie(AUTH_CONFIG.cookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: AUTH_CONFIG.cookieMaxAge,
      path: "/",
    });
    res.json({ user: updated });
  })
);

router.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_CONFIG.cookieName, { path: "/" });
  res.json({ ok: true });
});

router.get("/config", (_req, res) => {
  // Client uses this to decide whether to render the login screen at all.
  res.json({
    google_client_id_set: Boolean(process.env.GOOGLE_CLIENT_ID),
    allowed_domain: AUTH_CONFIG.allowedDomain,
  });
});

export default router;
