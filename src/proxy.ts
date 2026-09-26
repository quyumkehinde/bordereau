import { NextResponse, type NextRequest } from "next/server";
import { isValidSessionToken, SESSION_COOKIE } from "@/server/session";

// Optimistic gate for pages; actions and route handlers check the session themselves.
export function proxy(request: NextRequest) {
  if (isValidSessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|api/health).*)"],
};
