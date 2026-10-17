import { isPlatformAdmin } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const admin = await isPlatformAdmin();
  return (
    <div className="min-h-screen">
      <AppSidebar isAdmin={admin} />
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-slate-400 sm:px-6 lg:px-8">
          SMARTFLOW · Prices in KSh · Timezone Africa/Nairobi
        </footer>
      </div>
    </div>
  );
}