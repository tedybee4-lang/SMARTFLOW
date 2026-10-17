import { supabaseServer } from "@/lib/supabase-server";

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await supabaseServer();
  const { data: biz } = await sb.from("businesses").select("id,name").eq("slug", slug).maybeSingle();
  if (!biz) return <div className="rounded-xl border bg-white p-6"><h1 className="text-xl font-bold">Shop not found</h1><p className="text-sm text-slate-600">Check the link and try again.</p></div>;
  const b = biz as { id: string; name: string };
  const [{ data: products }, { data: shop }] = await Promise.all([
    sb.from("products").select("id,name,selling_price,photo_url").eq("business_id", b.id).eq("is_active", true).limit(60),
    sb.from("storefronts").select("is_published,hero_text").eq("business_id", b.id).maybeSingle(),
  ]);
  if (!(shop as { is_published: boolean } | null)?.is_published) {
    return <div className="rounded-xl border bg-white p-6"><h1 className="text-xl font-bold">{b.name}</h1><p className="text-sm text-slate-600">This shop is not published yet.</p></div>;
  }
  return (
    <div className="grid gap-6">
      <section className="rounded-2xl bg-[#0a1633] p-8 text-white">
        <h1 className="text-3xl font-bold">{b.name}</h1>
        <p className="mt-1 text-slate-300">{(shop as { hero_text: string | null } | null)?.hero_text ?? "Karibu — order online."}</p>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {((products ?? []) as { id: string; name: string; selling_price: number }[]).map((p) => (
          <div key={p.id} className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">{p.name}</h2>
            <p className="mt-1 font-bold text-sky-700">KSh {Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</p>
          </div>
        ))}
        {(products ?? []).length === 0 && <p className="text-sm text-slate-500">No products published yet.</p>}
      </div>
      <p className="text-xs text-slate-500">Full cart + checkout ships next in Phase 4.</p>
    </div>
  );
}
