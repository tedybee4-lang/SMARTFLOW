import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-navy-800 bg-navy-900 text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-black">
              S
            </span>
            <span>
              SMART<span className="text-blue-400">FLOW</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link href="/track" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-navy-800 hover:text-white">
              Track order
            </Link>
            <Link href="/dashboard" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-navy-800 hover:text-white">
              Dashboard
            </Link>
            <Link href="/onboarding" className="btn-primary hidden px-3 py-2 sm:inline-flex">
              Start free
            </Link>
            <Link href="/sign-in" className="btn-outline border-navy-700 bg-transparent px-3 py-2 text-slate-200 hover:border-blue-400 hover:bg-navy-800 hover:text-white">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            <span className="font-semibold text-navy-900">SMARTFLOW</span> · One platform. Every business.
          </p>
          <p>Prices in KSh · Timezone Africa/Nairobi · Nairobi, Kenya</p>
        </div>
      </footer>
    </div>
  );
}