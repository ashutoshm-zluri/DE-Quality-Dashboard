/**
 * Auth foundation: Google credential verification + session JWT.
 *
 * Flow:
 *   1. Frontend renders <GoogleLogin> button (Google Identity Services)
 *   2. User clicks, signs in, GIS returns a JWT credential
 *   3. POST /api/auth/login with that credential
 *   4. Server verifies against Google's public keys (audience = our client ID)
 *   5. Server find-or-creates the member record (new emails get role=viewer)
 *   6. Server signs its own session JWT, sets it as an httpOnly cookie
 *   7. All subsequent requests carry the cookie; auth middleware decodes it
 *
 * The session JWT is short-lived (7 days). On logout we just clear the cookie.
 */

import "dotenv/config";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { shared } from "./dal/shared.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "").trim();

const SESSION_COOKIE = "dqp_session";
const SESSION_TTL_DAYS = 7;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

if (!GOOGLE_CLIENT_ID) {
  console.warn(
    "[auth] GOOGLE_CLIENT_ID is unset. /api/auth/login will reject with 500."
  );
}
if (!SESSION_SECRET) {
  console.warn("[auth] SESSION_SECRET is unset. Generate one with `openssl rand -hex 32`.");
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export async function verifyGoogleCredential(credential) {
  if (!GOOGLE_CLIENT_ID) {
    throw httpErr(500, "GOOGLE_CLIENT_ID not configured on server");
  }
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw httpErr(401, "Google credential had no email");
  }
  if (!payload.email_verified) {
    throw httpErr(401, "Google email is not verified");
  }
  return {
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
    picture: payload.picture || null,
  };
}

export function signSession(payload) {
  if (!SESSION_SECRET) throw httpErr(500, "SESSION_SECRET not configured");
  return jwt.sign(payload, SESSION_SECRET, {
    expiresIn: `${SESSION_TTL_DAYS}d`,
  });
}

export function verifySession(token) {
  if (!token || !SESSION_SECRET) return null;
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch {
    return null;
  }
}

/**
 * Soft auth — sets req.user if a valid cookie is present, otherwise leaves it
 * undefined. Doesn't fail the request. Plug it into the app once globally.
 */
export function authMiddleware(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = verifySession(token);
  if (payload && payload.email) {
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      picture: payload.picture ?? null,
    };
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "auth_required" });
  next();
}

/** Allow only callers whose role matches one of the given strings. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "auth_required" });
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "forbidden", required: roles, have: req.user.role });
    }
    next();
  };
}

/**
 * Find-or-create the member record for the email Google verified. New emails
 * default to role=viewer. Existing members keep their role; we only refresh
 * name + picture from Google in case they changed.
 */
export async function ensureMember({ email, name, picture }) {
  const members = await shared.listMembers();
  const existing = members.find((m) => m.email === email);
  if (existing) {
    const patch = {};
    if (name && name !== existing.name) patch.name = name;
    if (picture && picture !== existing.picture) patch.picture = picture;
    if (Object.keys(patch).length > 0) {
      return await shared.updateMember(existing.id, patch);
    }
    return existing;
  }
  // First-time sign-in: viewer by default. Designation blank — admin can fill.
  const created = await shared.createMember({
    email,
    name,
    role: "viewer",
    designation: "",
  });
  if (picture) {
    return await shared.updateMember(created.id, { picture });
  }
  return created;
}

export function isDomainAllowed(email) {
  if (!ALLOWED_EMAIL_DOMAIN) return true;
  const [, domain] = email.split("@");
  return domain === ALLOWED_EMAIL_DOMAIN;
}

export const AUTH_CONFIG = {
  cookieName: SESSION_COOKIE,
  cookieMaxAge: SESSION_TTL_MS,
  allowedDomain: ALLOWED_EMAIL_DOMAIN || null,
};
