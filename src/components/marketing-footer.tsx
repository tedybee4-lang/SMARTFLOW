import Link from "next/link";
import { APP_NAME, SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_HREF, TAGLINE } from "@/lib/site";

const PRODUCT_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#solutions", label: "Solutions" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

const ACCESS_LINKS = [
  { href: "/register", label: "Create Account" },
  { href: "/sign-in", label: "Business Login" },
  { href: "/track", label: "Track an order" },
];

export function MarketingFooter() {
  return (
    <footer className="relative overflow-hidden bg-navy-950 text-slate-300">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(37,99,235,0.18),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(124,58,237,0.14),transparent_50%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-base font-black text-white" aria-hidden="true">
                S
              </span>
              <span className="text-lg font-extrabold tracking-tight text-white">
                SMART<span className="text-blue-400">FLOW</span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
              {TAGLINE} Sales, stock, customers, orders, expenses, reporting and online storefronts for Kenyan businesses — all in one system.
            </p>
            <p className="mt-4 text-xs text-slate-500">
              Prices in KSh · Timezone Africa/Nairobi · Payments via PayHero (M-Pesa)
            </p>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Product</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {PRODUCT_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-slate-400 transition-colors hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Access</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {ACCESS_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-slate-400 transition-colors hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Support</h3>
            <p className="mt-4 text-sm text-slate-400">Need help getting set up or using SMARTFLOW? Call us:</p>
            <a
              href={SUPPORT_PHONE_HREF}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-lg font-black text-white shadow-lg shadow-orange-500/20 transition-all hover:from-orange-600 hover:to-rose-600"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.5a1 1 0 01-.5 1.2l-2.26 1.13a11 11 0 005.5 5.5l1.13-2.26a1 1 0 011.2-.5l4.5 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C7.82 21 3 16.18 3 10V5z" />
              </svg>
              {SUPPORT_PHONE_DISPLAY}
            </a>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-navy-800 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
          <p>Made for Kenyan businesses · {SUPPORT_PHONE_DISPLAY}</p>
        </div>
      </div>
    </footer>
  );
}
