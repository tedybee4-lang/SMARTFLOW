import { z } from "zod";

/** Slugs that must never be claimed by a business storefront (reserved app/marketing paths). */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "billing", "cart", "checkout", "contact", "dashboard",
  "help", "login", "logout", "new", "onboarding", "platform-admin", "pos", "pricing",
  "privacy", "register", "root", "s", "sign-in", "static", "subscribe", "support",
  "terms", "track", "www",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}

/** Business-profile onboarding payload (POST /api/onboarding). */
export const OnboardingSchema = z.object({
  name: z.string().trim().min(2, "Business name is too short").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, "Use lowercase letters, numbers and dashes (1–50 chars)"),
  business_type: z.string().trim().min(1).max(50).default("retail"),
  phone: z.string().min(9).max(20),
  location: z.string().trim().max(200).optional().default(""),
});

export const ProductSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["product", "service"]).default("product"),
  sku: z.string().max(64).optional().default(""),
  barcode: z.string().max(64).optional().default(""),
  unit: z.string().max(16).default("pcs"),
  cost_price: z.number().min(0).default(0),
  selling_price: z.number().min(0),
  wholesale_price: z.number().min(0).optional(),
  tax_rate: z.number().min(0).max(1).default(0),
  track_stock: z.boolean().default(true),
  low_stock_threshold: z.number().min(0).default(5),
});

export const SaleItemSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.number().positive(),
  unit_price: z.number().min(0),
  discount: z.number().min(0).default(0),
});

export const CheckoutSchema = z.object({
  business_id: z.string().uuid(),
  items: z.array(SaleItemSchema).min(1),
  order_discount: z.number().min(0).default(0),
  tax_rate: z.number().min(0).max(1).default(0),
  payment_method: z.enum(["cash", "payhero", "offline", "credit"]),
  amount_paid: z.number().min(0).default(0),
  customer_id: z.string().uuid().optional(),
  notes: z.string().max(500).optional().default(""),
});

export type CheckoutInput = z.infer<typeof CheckoutSchema>;

/**
 * Business Till / PayBill / PayHero channel settings (PUT /api/business/payment-channel).
 * The active payment_method must have its matching target populated — the DB
 * constraint `chk_payment_channel_target` mirrors this rule.
 */
export const PaymentChannelSchema = z
  .object({
    business_id: z.string().uuid(),
    payment_method: z.enum(["till", "paybill", "payhero"]),
    till_number: z.string().trim().max(20).default(""),
    paybill_number: z.string().trim().max(20).default(""),
    channel_id: z.string().trim().max(120).default(""),
    is_active: z.boolean().default(true),
  })
  .refine(
    (d) =>
      (d.payment_method === "till" && /^[0-9]{4,10}$/.test(d.till_number)) ||
      (d.payment_method === "paybill" && /^[0-9]{4,10}$/.test(d.paybill_number)) ||
      (d.payment_method === "payhero" && d.channel_id.length >= 1),
    {
      message:
        "Enter the number for the chosen payment method (Till/PayBill: 4–10 digits; PayHero: channel ID)",
      path: ["payment_method"],
    },
  );

export type PaymentChannelInput = z.infer<typeof PaymentChannelSchema>;
