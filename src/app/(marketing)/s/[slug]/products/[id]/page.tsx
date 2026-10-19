import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { supabaseServer } from "@/lib/supabase-server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}): Promise<Metadata> {
  const { slug, id } = await params;
  const sb = await supabaseServer();
  const { data: biz } = await sb.from("businesses").select("id,name").eq("slug", slug).maybeSingle();
  const b = biz as { id: string; name: string } | null;
  if (!b) {
    return { title: "Shop not found | SMARTFLOW", description: "The SMARTFLOW shop you requested could not be found." };
  }
  const { data: product } = await sb
    .from("products")
    .select("name,selling_price,attributes")
    .eq("id", id)
    .eq("business_id", b.id)
    .eq("is_active", true)
    .maybeSingle();
  const p = product as { name: string; selling_price: number; attributes: Record<string, unknown> } | null;
  if (!p) {
    return { title: "Product not found | SMARTFLOW", description: "That product is no longer available." };
  }
  const desc = (p.attributes?.description ?? p.attributes?.details ?? "") as string;
  return {
    title: `${p.name} | ${b.name} | SMARTFLOW`,
    description: desc || `${p.name} — KSh ${Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
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
  const { data: product } = await sb
    .from("products")
    .select("id,name,sku,barcode,unit,selling_price,tax_rate,photo_url,track_stock,low_stock_threshold,attributes,kind")
    .eq("id", id)
    .eq("business_id", b.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!product) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="page-title">Product not found</h1>
        <p className="page-sub">That product is no longer available.</p>
        <Link href={`/s/${slug}`} className="btn-outline mt-6">Back to shop</Link>
      </div>
    );
  }
  const p = product as {
    id: string; name: string; sku: string | null; barcode: string | null; unit: string;
    selling_price: number; tax_rate: number; photo_url: string | null; track_stock: boolean;
    low_stock_threshold: number; attributes: Record<string, unknown>; kind: string;
  };
  const desc = ((p.attributes as Record<string, unknown> | null)?.description ?? (p.attributes as Record<string, unknown> | null)?.details ?? "") as string;
  return (
    <div>
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <Link href={`/s/${slug}`} className="btn-ghost text-sm mb-4 inline-block">← Back to {b.name}</Link>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="card p-6">
            {p.photo_url ? (
              <Image src={p.photo_url} alt={p.name} width={640} height={360} className="h-56 w-full object-cover rounded-xl mb-4" />
            ) : (
              <div className="h-56 w-full rounded-xl bg-gradient-to-br from-navy-900 to-blue-900 flex items-center justify-center text-4xl font-black text-white/20 mb-4">
                {p.name.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="num text-3xl font-bold text-navy-900 mb-2">
              KSh {Number(p.selling_price).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
            </p>
            {p.sku && <p className="text-xs text-slate-500 mb-1">SKU: {p.sku}</p>}
            {p.barcode && <p className="text-xs text-slate-500 mb-4">Barcode: {p.barcode}</p>}
            <p className="text-sm text-slate-500 mb-2">Unit: {p.unit}</p>
            <p className="text-sm text-slate-500 mb-4">Type: {p.kind === "service" ? "Service" : "Product"}</p>
            <Link href={`/cart?shop=${slug}`} className="btn-primary w-full py-3 text-base">
              Add to cart & order
            </Link>
          </div>
          <div className="card p-6">
            <h2 className="text-lg font-bold text-navy-900 mb-4">Description</h2>
            <p className="text-slate-600 mb-4">{desc || "No description available."}</p>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase">Stock tracking</p>
                <p>{p.track_stock ? "Yes" : "No"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase">Availability</p>
                <p className="text-emerald-600 font-semibold">
                  Available — stock confirmed at checkout
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
