import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMARTFLOW — One Platform. Every Business.",
  description: "Business management and storefronts for Kenyan businesses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-[#0a1633] text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              SMART<span className="text-sky-400">FLOW</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="hover:text-sky-300">Dashboard</Link>
              <Link href="/onboarding" className="hover:text-sky-300">Onboarding</Link>
              <Link href="/sign-in" className="rounded bg-sky-600 px-3 py-1.5 font-medium hover:bg-sky-500">Sign in</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500">
          SMARTFLOW · Prices in KSh · Timezone Africa/Nairobi
        </footer>
      </body>
    </html>
  );
}

