"use client";
import Link from "next/link";
import { useState } from "react";

const SECTIONS = [
  { href: "/#features", label: "Features" },
  { href: "/#solutions", label: "Solutions" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#contact", label: "Contact" },
];

const CTA_CLASSES =
  "inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-500/25 transition-all hover:from-orange-600 hover:to-rose-600 hover:shadow-lg hover:shadow-orange-500/30 active:scale-[0.98]";

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8" aria-label="Main">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-navy-900 via-blue-600 to-violet-600 text-base font-black text-white shadow-md" aria-hidden="true">
            S
          </span>
          <span className="text-lg font-extrabold tracking-tight text-navy-900">
            SMART<span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">FLOW</span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 lg:flex">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-navy-900"
            >
              {s.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:border-navy-900 hover:bg-slate-50"
          >
            Business Login
          </Link>
          <Link href="/register" className={CTA_CLASSES}>
            Create Account
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-slate-50 lg:hidden"
          aria-expanded={open}
          aria-label="Toggle navigation menu"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 18L18 6M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
          Menu
        </button>
      </nav>

      {open && (
        <div className="border-t border-slate-200 bg-white lg:hidden">
          <div className="mx-auto grid max-w-7xl gap-1 px-4 py-4 sm:px-6">
            {SECTIONS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {s.label}
              </Link>
            ))}
            <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3">
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white shadow-md"
              >
                Create Account
              </Link>
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-navy-900 hover:bg-slate-50"
              >
                Business Login
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
