# Kenya localisation (SMARTFLOW)

- Currency: Kenyan shilling. Code KES, symbol "KSh". Format: `KSh 1,250.00`
  (en-KE grouping). Store money as integer minor units (cents) OR numeric(12,2) —
  this project uses `numeric(12,2)` in Postgres and integer cents in checkout math
  where rounding matters. Display via `formatKES()`.
- Timezone: Africa/Nairobi (UTC+3, no DST). Store timestamptz (UTC); display with
  `date-fns-tz` in Nairobi tz. Daily reports cut at Nairobi midnight.
- Phones: accept 07XXXXXXXX, 01XXXXXXXX, +254..., 254... Normalise to +254XXXXXXXXX
  for PayHero STK, TOPSPEED, WhatsApp. Validate with `normalizeKEPhone()`.
  PayHero STK requires Safaricom-format 2547XXXXXXXX.
- Taxes: configurable per business (`tax_rates` table). No hardcoded statutory rate.
  Receipts show subtotal, discount, tax lines, total — exportable for accountant/KRA review.
  eTIMS: schema supports receipt/invoice exports; do NOT claim KRA compliance until verified.
