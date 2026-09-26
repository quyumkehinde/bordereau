// Single shared demo login: an HMAC-signed, expiring session cookie. Not multi-user auth (a spec non-goal).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "bdx_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return s ?? "dev-only-secret";
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function createSessionToken(now = Date.now()): string {
  const payload = String(now + SESSION_TTL_SECONDS * 1000);
  return `${payload}.${sign(payload)}`;
}

export function isValidSessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(payload) > now;
}

export function passwordMatches(candidate: string): boolean {
  const expected = process.env.DEMO_PASSWORD;
  if (!expected) return process.env.NODE_ENV !== "production" && candidate === "demo";
  const a = Buffer.from(createHmac("sha256", "pw").update(candidate).digest());
  const b = Buffer.from(createHmac("sha256", "pw").update(expected).digest());
  return timingSafeEqual(a, b);
}
