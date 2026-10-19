import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { supabaseServer } from "@/lib/supabase-server";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sb = await supabaseServer();
  const { data: biz } = await sb.from("businesses").select("id,name").eq("slug", slug).maybeSingle();
  const b = biz as { name: string } | null;
  if (!b) {
    return {
      title: "Shop not found | SMARTFLOW",
      description: "The SMARTFLOW shop you requested could not be found.",
    };
  }
  const { data: shop } = await sb.from("storefronts").select("hero_text").eq("business_id", (biz as { id: string }).id).maybeSingle();
  const hero = (shop as { hero_text: string | null } | null)?.hero_text;
  return {
    title: `${b.name} | SMARTFLOW online shop`,
    description: hero ?? `Browse products from ${b.name} and order online.`,
  };
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await supabaseServer();
  const { data: biz } = await sb.from("businesses").select("id,name,slug").eq("slug", slug).maybeSingle();
  if (!biz) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="page-title">Shop not found</h1>
        <p className="page-sub">Check the link and try again.</p>
        <Link href="/" className="btn-outline mt-6">Back to SMARTFLOW</Link>
      </div>
    );
  }
  const b = biz as { id: string; name: string };
  const [{ data: products }, { data: shop }] = await Promise.all([
    sb.from("products").select("id,name,selling_price,photo_url").eq("business_id", b.id).eq("is_active", true).limit(60),
    sb.from("storefronts").select("is_published,hero_text,whatsapp_number,delivery_fee").eq("business_id", b.id).maybeSingle(),
  ]);
  const s = shop as { is_published: boolean; hero_text: string | null; whatsapp_number: string | null; delivery_fee: number | null } | null;
  if (!s?.is_published) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="page-title">{b.name}</h1>
        <p className="page-sub">This shop is not published yet — check back soon.</p>
        <Link href="/" className="btn-outline mt-6">Back to SMARTFLOW</Link>
      </div>
    );
  }
  const wa = s.whatsapp_number;
  const items = ((products ?? []) as { id: string; name: string; selling_price: number; photo_url: string | null }[]);
  return (
    <div>
      {/* Shop hero */}
      <section className="relative overflow-hidden bg-navy-900 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(124,58,237,0.22),transparent_55%)]" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Online shop</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{b.name}</h1>
          <p className="mt-2 text-slate-300">{s.hero_text ?? "Karibu — order online."}</p>
          {wa && (
            <p className="mt-3 text-sm text-blue-200 flex items-center gap-2">
              <span className="text-blue-400">📱</span> WhatsApp: {wa}
            </p>
          )}
          <Link href={`/cart?shop=${slug}`} className="btn-primary mt-6 px-6 py-3 text-base">
            View cart & order
          </Link>
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <h2 className="text-xl font-bold tracking-tight text-navy-900">
          Products <span className="text-slate-400">({items.length})</span>
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <Link key={p.id} href={`/s/${slug}/products/${p.id}`} className="block">
              <div className="card overflow-hidden transition-shadow hover:shadow-md">
              {p.photo_url ? (
                <Image src={p.photo_url} alt={p.name} width={480} height={240} className="h-40 w-full object-cover" />
              ) : (
                <div className="flex h-40 w-full items-center justify-center bg-gradient-to-br from-navy-900 to-blue-900 text-4xl font-black text-white/20" aria-hidden="true">
                  {p.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="p-4">
                <h3 className="font-semibold text-navy-900">{p.name}</h3>
                <p className="mt-1 font-bold text-blue-700">
                  <span className="num">KSh {Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</span>
                </p>
              </div>
              </div>
              </Link>
          ))}
        </div>
        {items.length === 0 && (
          <div className="card mt-6 p-8 text-center text-sm text-slate-500">
            No products published yet.
          </div>
        )}

        <div className="card mt-10 flex flex-col items-center justify-between gap-4 p-6 sm:flex-row">
          <div>
            <p className="font-semibold text-navy-900">Ready to order?</p>
            <p className="text-sm text-slate-500">Add products to your cart and send your order directly to the shop.</p>
          </div>
          <Link href={`/cart?shop=${slug}`} className="btn-primary whitespace-nowrap">
            Go to cart
          </Link>
        </div>
      </div>
    </div>
  );
}

