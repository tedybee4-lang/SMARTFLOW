import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SMARTFLOW — One Platform. Every Business.",
    template: "%s · SMARTFLOW",
  },
  description:
    "Sales, stock, orders, expenses, storefronts and M-Pesa-ready payments for Kenyan businesses. Prices in KSh, Nairobi time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}

