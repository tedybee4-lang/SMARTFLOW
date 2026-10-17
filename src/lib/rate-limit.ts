import { NextResponse } from "next/server";

/** In-memory per-IP rate limiter for sensitive endpoints (serverless-safe best effort). */
const hits = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count += 1;
  if (entry.count > max) return false;
  return true;
}

export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export function rateLimited(req: Request, max = 20): NextResponse | null {
  if (!rateLimit(clientKey(req), max)) {
    return NextResponse.json({ error: "Too many requests — try again shortly" }, { status: 429 });
  }
  return null;
}
