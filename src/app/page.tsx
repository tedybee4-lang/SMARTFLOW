export default function Home() {
  return (
    <div className="grid gap-6">
      <section className="rounded-2xl bg-[#0a1633] p-8 text-white">
        <p className="text-sm font-medium text-sky-300">One Platform. Every Business.</p>
        <h1 className="mt-2 text-3xl font-bold">SMARTFLOW for Kenyan businesses</h1>
        <p className="mt-2 max-w-xl text-slate-300">
          Sales, stock, customers, orders, expenses, staff, payments, storefronts,
          reports and subscriptions — in Kenyan shillings, Nairobi time.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/onboarding" className="rounded-lg bg-sky-600 px-4 py-2 font-medium hover:bg-sky-500">Start onboarding</a>
          <a href="/dashboard" className="rounded-lg border border-slate-600 px-4 py-2 hover:border-sky-400">Open dashboard</a>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {[["POS & sales", "Fast checkout, cash + PayHero, receipts."], ["Stock", "Ledger-based inventory, low-stock alerts."], ["Storefront", "Mobile-first shop link per business."]].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">{t}</h2>
            <p className="mt-1 text-sm text-slate-600">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

