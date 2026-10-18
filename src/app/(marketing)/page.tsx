import Link from "next/link";
import { getPublicPlans, formatPlanPrice } from "@/lib/plans";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_HREF } from "@/lib/site";

export const revalidate = 300;

const SOLUTIONS: Array<{ title: string; desc: string; icon: string }> = [
  { title: "Retail shops", desc: "Counter sales, stock that moves itself, end-of-day cash-up.", icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6a1 1 0 00.9 1.4H19" },
  { title: "Boutiques & fashion", desc: "Sizes, variants, receipts and a storefront that never closes.", icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" },
  { title: "Electronics", desc: "Cost vs selling price per unit, warranties, fast counter checkout.", icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 002 2v10a2 2 0 002 2z" },
  { title: "Hardware", desc: "Bulk items by metre, bag or piece — with unit pricing that fits.", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { title: "Wholesale", desc: "Volume pricing, credit accounts and delivery orders per customer.", icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6a1 1 0 00.9 1.4H19" },
  { title: "Restaurants & hotels", desc: "Table orders, kitchen tickets and daily food-cost tracking.", icon: "M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" },
  { title: "Salons & spas", desc: "Service menu, stylist commissions and appointment-style orders.", icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" },
  { title: "Cybercafés", desc: "Time-based services, printing charges and print credit balances.", icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 002-2H5a2 2 0 002 2v10a2 2 0 002 2z" },
  { title: "Supermarkets", desc: "Many tills, many staff, one live view of sales and stock.", icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6a1 1 0 00.9 1.4H19" },
  { title: "M-Pesa agents", desc: "Transaction register, float tracking and daily reconciliation.", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
  { title: "Pharmacies", desc: "Batch and expiry visibility, per-product stock ledger, dispensing log.", icon: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" },
  { title: "Any other business", desc: "Services, spares, salons — SMARTFLOW adapts to what you sell.", icon: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" },
];

const STEPS: Array<{ title: string; desc: string }> = [
  { title: "Create your account", desc: "Register with your name, email and a password, then verify your email. That one account is you across all of SMARTFLOW." },
  { title: "Set up your business", desc: "Add your business name, M-Pesa number and location, and choose your storefront link — your shop will live at /s/your-name." },
  { title: "Add products & staff", desc: "Enter or import your products with prices and stock. Give each staff member their own login with the right role." },
  { title: "Start selling", desc: "Ring up sales at the counter, fulfil delivery orders and let online customers order from your storefront — one system." },
];

const BUSINESS_TYPES = [
  "Retail", "Boutique", "Electronics", "Hardware", "Wholesale", "Restaurant",
  "Salon & spa", "Pharmacy", "Supermarket", "Cybercafé", "M-Pesa agent", "Other",
];
function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6 lg:max-w-4xl lg:px-8">
      <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-slate-600">{sub}</p>
    </div>
  );
}

export default async function Home() {
  const plans = await getPublicPlans();

  return (
    <div className="flex flex-col">
      {/* ============ HERO ============ */}
      <section id="hero" className="relative bg-navy-950">
        <div className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">SMARTFLOW for Kenyan businesses</p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">One platform. Every business.<br className="hidden sm:block" />Sales, stock and storefronts in one system.</h1>
            <p className="mt-6 text-lg text-slate-300 sm:text-xl">Register your account first — then set up your shop in under two minutes. Questions? Call{" "}
              <a href={SUPPORT_PHONE_HREF} className="font-bold text-orange-400 hover:text-orange-300">{SUPPORT_PHONE_DISPLAY}</a>.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/register" className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-8 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition-all hover:from-orange-600 hover:to-rose-600 hover:shadow-lg hover:shadow-orange-500/30 active:scale-[0.98]">
                Create Account
              </Link>
              <Link href="/sign-in" className="inline-flex items-center justify-center rounded-xl border border-white/40 bg-white/10 px-8 py-4 text-sm font-semibold text-white backdrop-blur transition-colors hover:border-white/70 hover:bg-white/20">
                Business Login
              </Link>
            </div>
            <div className="mt-10 flex items-center justify-center gap-6 text-sm text-slate-400">
              <span className="flex items-center gap-2"><span className="text-blue-600" aria-hidden="true">◆</span> M-Pesa via PayHero</span>
              <span className="flex items-center gap-2"><span className="text-blue-600" aria-hidden="true">◆</span> Your storefront at /s/your-shop</span>
              <span className="flex items-center gap-2"><span className="text-blue-600" aria-hidden="true">◆</span> Support on {SUPPORT_PHONE_DISPLAY}</span>
            </div>
          </div>
          <div className="mt-16 relative mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-white/0 to-white/5 pointer-events-none" aria-hidden="true" />
            <div className="relative grid gap-3 p-2 text-sm">
              {STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white font-semibold text-xs">{i + 1}</span>
                  <div>
                    <div className="font-medium text-slate-200">{step.title}</div>
                    <div className="text-slate-400">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      {/* ============ SOLUTIONS ============ */}
      <section id="solutions" className="bg-white py-20 border-y border-slate-200">
        <SectionHeading eyebrow="Built for your trade" title="Your business, fully covered" sub="Counter sales, stock, customers and online orders — whatever you sell, SMARTFLOW handles it." />
        <div className="mt-16 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {SOLUTIONS.map((solution) => (
              <div key={solution.title} className="rounded-xl border border-slate-200 bg-white p-6 hover:border-blue-200 hover:shadow-md transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                    <path d={solution.icon} />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-bold text-navy-900">{solution.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{solution.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FEATURES ============ */}
      <section id="features" className="bg-white py-20 border-b border-slate-200">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading eyebrow="Everything included" title="Run the whole shop in one place" sub="From the counter to the cloud — the tools you would otherwise stitch together from five apps." />
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Point of sale", "Ring up sales at the counter with cash, M-Pesa or credit — stock updates instantly, receipts print, end-of-day cash-up just works.", "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6a1 1 0 00.9 1.4H19"],
              ["Inventory that adds up", "Stock movements per product, low-stock alerts and a purchase ledger — every unit in, every unit out, accounted for.", "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10l8 4"],
              ["Online storefront", "A unique link for your shop where customers browse and order — orders land straight in your dashboard.", "M3 9l1-5h16l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6"],
              ["Reports you can trust", "Daily sales, expenses, profit and top products — real numbers from real records, not guesswork.", "M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"],
              ["Staff & roles", "Give each employee their own login with the right permissions — and see who did what in the audit log.", "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-8 0 4 4 0 008 0zm6-1a4 4 0 11-3-3.87"],
              ["M-Pesa ready", "Configure your Till or PayBill, collect with STK push through PayHero, and pay your subscription the same way.", "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"],
            ] as Array<[string, string, string]>).map(([title, desc, icon]) => (
              <div key={title} className="rounded-xl border border-slate-200 bg-white p-6 hover:border-blue-200 hover:shadow-md transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-900 text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={icon} />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-bold text-navy-900">{title}</h3>
                <p className="mt-2 text-sm text-slate-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section id="how-it-works" className="bg-slate-50 py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading eyebrow="How it works" title="From sign-up to your first sale" sub="Four steps and you are open for business — in-store and online." />
          <div className="mt-16 grid gap-12 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={i} className="flex flex-col gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-navy-900 shadow-sm">{i + 1}</div>
                <h3 className="text-lg font-bold text-navy-900">{step.title}</h3>
                <p className="text-sm text-slate-600">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* ============ PRICING ============ */}
      <section id="pricing" className="bg-white py-20 border-y border-slate-200">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading eyebrow="Simple, monthly pricing" title="One plan, one price" sub="Start with a 7-day free trial. All prices in KSh, billed monthly via M-Pesa through PayHero. No setup fees, no per-sale commission." />
          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.code} className="rounded-2xl border border-slate-200 bg-white p-8 hover:border-blue-200 hover:shadow-lg transition-colors flex flex-col">
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-navy-900">{plan.name}</h3>
                  <p className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold tracking-tight text-navy-900">{formatPlanPrice(plan.price_kes_per_month)}</span>
                    <span className="text-sm font-semibold text-slate-500">/month</span>
                  </p>
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    For monthly sales of{" "}
                    {plan.monthly_sales_min === 0 ? `KSh 0 – ${formatPlanPrice(plan.monthly_sales_max ?? 0)}` : `${formatPlanPrice(plan.monthly_sales_min)} – ${plan.monthly_sales_max == null ? "above" : formatPlanPrice(plan.monthly_sales_max)}`}
                  </p>
                </div>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
                  <li className="flex items-center gap-2"><span className="text-blue-600" aria-hidden="true">◆</span> Unlimited products &amp; orders</li>
                  <li className="flex items-center gap-2"><span className="text-blue-600" aria-hidden="true">◆</span> Online storefront at /s/your-shop</li>
                  <li className="flex items-center gap-2"><span className="text-blue-600" aria-hidden="true">◆</span> M-Pesa payments via PayHero</li>
                  {plan.max_staff ? (<li className="flex items-center gap-2"><span className="text-blue-600" aria-hidden="true">◆</span> Up to {plan.max_staff} staff accounts</li>) : null}
                  {plan.priority_support ? (<li className="flex items-center gap-2"><span className="text-blue-600" aria-hidden="true">◆</span> Priority support</li>) : null}
                </ul>
                <div className="mt-8">
                  <Link href="/register" className={`w-full py-3 rounded-xl font-semibold transition-colors ${plan.code === "starter" ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md shadow-orange-500/25 hover:from-orange-600 hover:to-rose-600" : "border border-slate-300 bg-white text-navy-900 hover:border-navy-900 hover:bg-slate-50"}`}>
                    Create Account
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-blue-100 bg-blue-50/60 p-5 text-sm leading-relaxed text-slate-700">
            <p>
              <strong className="font-bold text-navy-900">Two kinds of money, kept separate.</strong> Your SMARTFLOW subscription (billed monthly via M-Pesa through PayHero) covers your use of the platform. Purchases customers make from your shop flow directly to your business — SMARTFLOW never takes a cut of your sales.
            </p>
          </div>
        </div>
      </section>
      {/* ============ BUSINESS TYPES ============ */}
      <section id="business-types" className="bg-slate-50 py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading eyebrow="Pick your trade" title="Your shop, your link" sub="Choose your business type during setup — your storefront goes live at /s/your-name." />
          <div className="mt-12 grid gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {BUSINESS_TYPES.map((type) => (
              <button key={type} type="button" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-blue-300 hover:bg-slate-50 transition-colors">
                {type}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section id="faq" className="bg-white py-20 border-y border-slate-200">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <SectionHeading eyebrow="FAQ" title="Questions, answered" sub="Everything you need to know before you start." />
          <div className="mt-12 grid gap-3">
            {([
              [
                "How does the 7-day free trial work?",
                "Every new business gets full access for 7 days — no card required. After the trial ends, pick a plan to keep selling; your data stays exactly where it is.",
              ],
              [
                "Do you take a cut of my sales?",
                "No. SMARTFLOW charges only the monthly subscription. Money your customers pay flows directly to your business through your own M-Pesa Till, PayBill or PayHero channel.",
              ],
              [
                "How do customers pay their subscription?",
                "Monthly via M-Pesa through PayHero — an STK push reaches your phone and you approve it with your PIN. No bank details, no card.",
              ],
              [
                "What is my storefront link?",
                "Every business gets a unique URL like /s/your-shop. Customers browse your products and send orders straight into your dashboard. You can rename the link in Storefront settings.",
              ],
              [
                "Can my staff have their own logins?",
                "Yes. Invite staff and give each a role — cashier, manager, stockkeeper and more. Every action they take is recorded in the audit log.",
              ],
              [
                "What if I need help?",
                `Call or text ${SUPPORT_PHONE_DISPLAY} — a real person walks you through setup and migrating your existing records.`,
              ],
            ] as Array<[string, string]>).map(([q, a]) => (
              <details key={q} className="group rounded-xl border border-slate-200 bg-white p-5 open:border-blue-200 open:shadow-sm transition-colors">
                <summary className="cursor-pointer list-none font-semibold text-navy-900 marker:hidden">
                  <span className="mr-2 inline-block text-blue-600 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
                  {q}
                </summary>
                <p className="mt-3 pl-6 text-sm leading-relaxed text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="bg-navy-900 py-20">
        <div className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-24">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.15),transparent_50%)]" aria-hidden="true" />
          <div className="relative max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Ready to open your shop?</h2>
            <p className="mt-4 text-lg text-slate-300">Create your account in under two minutes — start with a 7-day free trial, no card needed.</p>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/register" className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-8 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition-all hover:from-orange-600 hover:to-rose-600">
                Create Account
              </Link>
              <Link href="/sign-in" className="inline-flex items-center justify-center rounded-xl border border-white/40 bg-white/10 px-8 py-4 text-sm font-semibold text-white backdrop-blur transition-colors hover:border-white/70 hover:bg-white/20">
                Business Login
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============ CONTACT ============ */}
      <section id="contact" className="bg-slate-50 py-20">
        <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
          <SectionHeading eyebrow="Contact" title="Talk to a real person" sub="Questions about pricing, setup or migrating your current records? We help you get started — call and we will walk you through it." />
          <a
            href={SUPPORT_PHONE_HREF}
            className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-white px-8 py-5 shadow-lg ring-1 ring-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-xl"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white" aria-hidden="true">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.5a1 1 0 01-.5 1.2l-2.26 1.13a11 11 0 005.5 5.5l1.13-2.26a1 1 0 011.2-.5l4.5 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C7.82 21 3 16.18 3 10V5z" />
              </svg>
            </span>
            <span className="text-left">
              <span className="block text-sm font-semibold text-slate-500">Call or text us</span>
              <span className="block text-2xl font-extrabold tracking-tight text-navy-900">{SUPPORT_PHONE_DISPLAY}</span>
            </span>
          </a>
          <p className="mt-6 text-sm text-slate-500">
            Already selling with SMARTFLOW?{" "}
            <Link href="/sign-in" className="font-bold text-blue-700 hover:underline">Sign in</Link>{" "}
            ·{" "}
            <Link href="/register" className="font-bold text-blue-700 hover:underline">Create an account</Link>
          </p>
        </div>
      </section>
    </div>
  );
}