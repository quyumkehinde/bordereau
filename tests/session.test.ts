import { describe, expect, it } from "vitest";
import { createSessionToken, isValidSessionToken, SESSION_TTL_SECONDS } from "@/server/session";

describe("session tokens", () => {
  it("accepts a fresh token and rejects tampered or expired ones", () => {
    const now = Date.now();
    const t = createSessionToken(now);
    expect(isValidSessionToken(t, now)).toBe(true);
    const [payload, sig] = t.split(".");
    expect(isValidSessionToken(`${Number(payload) + 1000}.${sig}`, now)).toBe(false);
    expect(isValidSessionToken(t, now + SESSION_TTL_SECONDS * 1000 + 1)).toBe(false);
    expect(isValidSessionToken(undefined)).toBe(false);
    expect(isValidSessionToken("garbage")).toBe(false);
  });
});
