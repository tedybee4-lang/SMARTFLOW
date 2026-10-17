import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(cookieList: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookieList.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            /* read-only in RSC */
          }
        },
      },
    },
  );
}

/** Service-role client — server only. Never import in client components. */
export function supabaseServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service-role credentials not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}
