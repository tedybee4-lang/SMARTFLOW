/**
 * TOPSPEED SMS + WhatsApp Cloud API adapters (server-only).
 *
 * These functions are injected so callers (and tests) can swap in a mock.
 * Real delivery requires TOPSPEED_API_KEY / WHATSAPP_ACCESS_TOKEN.
 * We NEVER send a live message without explicit authorization.
 */
export type SendResult = { ok: boolean; provider_ref: string | null; error?: string };

/** Mock sender used by tests and local development. */
export async function sendSMSMock(to: string, message: string): Promise<SendResult> {
  if (!to || !message) return { ok: false, provider_ref: null, error: "Missing recipient or message" };
  return { ok: true, provider_ref: `MOCK-SMS-${to}` };
}

/** Mock WhatsApp sender used by tests and local development. */
export async function sendWhatsAppMock(to: string, template: string, params: string[] = []): Promise<SendResult> {
  if (!to || !template) return { ok: false, provider_ref: null, error: "Missing recipient or template" };
  return { ok: true, provider_ref: `MOCK-WA-${to}-${template}` };
}

/** Real TOPSPEED SMS sender. Requires TOPSPEED_API_KEY + TOPSPEED_SENDER_ID. */
export async function sendSMSReal(to: string, message: string): Promise<SendResult> {
  const apiKey = process.env.TOPSPEED_API_KEY;
  const senderId = process.env.TOPSPEED_SENDER_ID;
  const endpoint = process.env.TOPSPEED_API_URL ?? "https://api.topspeedsms.com/v1/sms/send";
  if (!apiKey || !senderId) {
    return { ok: false, provider_ref: null, error: "TOPSPEED_API_KEY or TOPSPEED_SENDER_ID not configured" };
  }
  if (!to || !message) return { ok: false, provider_ref: null, error: "Missing recipient or message" };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ to, message, sender_id: senderId }),
  });
  if (!res.ok) return { ok: false, provider_ref: null, error: `HTTP ${res.status}` };
  const json = (await res.json()) as { id?: string; provider_ref?: string };
  return { ok: true, provider_ref: json.provider_ref ?? json.id ?? null };
}

/** Real WhatsApp Cloud API sender. Requires WHATSAPP_ACCESS_TOKEN + PHONE_NUMBER_ID. */
export async function sendWhatsAppReal(to: string, template: string, params: string[] = []): Promise<SendResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  if (!token || !phoneId) {
    return { ok: false, provider_ref: null, error: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured" };
  }
  if (!to || !template) return { ok: false, provider_ref: null, error: "Missing recipient or template" };
  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: template, language: { code: "en_KE" }, components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] },
    }),
  });
  if (!res.ok) return { ok: false, provider_ref: null, error: `HTTP ${res.status}` };
  const json = (await res.json()) as { messages?: Array<{ id?: string }> };
  return { ok: true, provider_ref: json.messages?.[0]?.id ?? null };
}

/** Select the real provider when credentials are present, else the mock. */
export function sendSMS(to: string, message: string): Promise<SendResult> {
  if (process.env.TOPSPEED_API_KEY) return sendSMSReal(to, message);
  return sendSMSMock(to, message);
}
export function sendWhatsApp(to: string, template: string, params: string[] = []): Promise<SendResult> {
  if (process.env.WHATSAPP_ACCESS_TOKEN) return sendWhatsAppReal(to, template, params);
  return sendWhatsAppMock(to, template, params);
}