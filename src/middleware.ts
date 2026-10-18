import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedRoute, sanitizeRedirect } from "@/lib/access";

/**
 * Edge middleware: refreshes the Supabase session on every matched request and
 * redirects anonymous visitors away from business/platform-admin pages.
 * Authorisation itself is enforced again server-side in layouts, pages and API
 * routes (membership + RLS) — this only handles sessions and redirects.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookies: { name: string; value: string; options?: CookieOptions }[]) {
          cookies.forEach(({ name, value, options }) => {
            req.cookies.set({ name, value, ...options });
            res.cookies.set({ name, value, ...options });
          });
        },
      },
    },
  );

  // getUser() validates the JWT and refreshes tokens/cookies as a side effect.
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = req.nextUrl.pathname;
  if (!user && isProtectedRoute(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(sanitizeRedirect(pathname + req.nextUrl.search))}`;
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/pos/:path*",
    "/products/:path*",
    "/orders/:path*",
    "/customers/:path*",
    "/expenses/:path*",
    "/reports/:path*",
    "/staff/:path*",
    "/storefront-settings/:path*",
    "/subscriptions/:path*",
    "/onboarding",
    "/platform-admin/:path*",
  ],
};
