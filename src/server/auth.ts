import { cookies } from "next/headers";
import { isValidSessionToken, SESSION_COOKIE } from "./session";

export async function hasSession(): Promise<boolean> {
  return isValidSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** For server actions and route handlers: they are reachable without going through a gated page. */
export async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error("Not signed in");
}
