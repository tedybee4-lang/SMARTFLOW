import Link from "next/link";

const FEATURES: Array<[string, string, string]> = [
  ["Point of sale", "Cash and credit sales at the counter, receipts with your order number, real-time stock movement.", "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6a1 1 0 00.9 1.4H19"],
  ["Inventory", "Ledger-based stock, low-stock alerts, cost vs selling price per product, barcode support.", "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"],
  ["Orders & delivery", "Placed to processing to ready to dispatched to delivered, with balances due tracked per order.", "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2z"],
  ["Storefront", "A mobile-first shop link per business — customers browse and order without an app.", "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"],
  ["M-Pesa ready", "PayHero integration for STK pushes on orders and subscription invoices, with callback verification.", "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"],
  ["Expenses & reports", "Track rent, stock, transport and more. Daily sales, cash received and outstanding balances.", "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"],
];

const STEPS: Array<[string, string]> = [
  ["Create your business", "Register your shop name, M-Pesa number and location in under two minutes."],
  ["Add your products", "Import or enter products with prices and barcodes. Stock tracks itself from sales."],
  ["Sell from anywhere", "Counter POS for walk-ins, a storefront link for online customers, orders for delivery."],
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy-900 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(124,58,237,0.22),transparent_55%)]" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">One platform. Every business.</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Run your Kenyan business{" "}
            <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
              end to end
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-300">
            Sales, stock, customers, orders, expenses, staff, payments, storefronts,
            reports and subscriptions — in Kenyan shillings, on Nairobi time.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/onboarding" className="btn-primary px-6 py-3 text-base">
              Start onboarding — free
            </Link>
            <Link href="/sign-in" className="btn-outline border-navy-700 bg-navy-800/60 px-6 py-3 text-base text-white hover:border-blue-400 hover:bg-navy-800">
              Sign in
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-400">
            Built for boutiques, hardware, electronics, salons, cybercafés, restaurants and more.
          </p>
        </div>
      </section>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Features */}
        <section className="py-16">
          <h2 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            Everything a growing shop needs
          </h2>
          <p className="mt-2 max-w-2xl text-slate-600">
            One login for the counter, the stockroom, the delivery rider and the online storefront.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, desc, icon]) => (
              <div key={title} className="card-pad group transition-shadow hover:shadow-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={icon} />
                  </svg>
                </span>
                <h3 className="mt-4 font-semibold text-navy-900">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="pb-16">
          <div className="card overflow-hidden">
            <div className="grid gap-0 sm:grid-cols-3">
              {STEPS.map(([title, desc], i) => (
                <div key={title} className="border-slate-200 p-6 sm:border-l sm:first:border-l-0">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-3 font-semibold text-navy-900">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="pb-20">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-navy-900 via-navy-800 to-blue-900 px-6 py-12 text-center text-white sm:px-12">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Ready to flow? Create your business today.
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-slate-300">
              No demo data, no lock-in — your real products, your real sales, from day one.
            </p>
            <div className="mt-6">
              <Link href="/onboarding" className="btn bg-white px-6 py-3 text-base text-navy-900 hover:bg-slate-100">
                Start onboarding
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

