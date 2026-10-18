/**
 * TOPSPEED SMS via the shared central integration (server-only).
 *
 * Provider: ispledger-hosted TOPSPEED HTTP API, base URL from
 * TOPSPEED_API_URL (default https://sms.ispledger.com/api/v3).
 * Auth: Bearer token from TOPSPEED_API_KEY (server-only env; the value is
 * NEVER logged, never committed, never sent to the browser — only a
 * presence boolean is ever exposed to the admin UI).
 *
 * Businesses NEVER hold TOPSPEED credentials. They buy SMS credit packages
 * (see sms_packages / sms_balances / sms_ledger migrations) and every send
 * debits their ledger. The free test console uses the platform's own test
 * allowance and is never billed to a business.
 */
export type SendResult = { ok: boolean; provider_ref: string | null; error?: string };

/** Presence check — safe to expose as booleans to the admin UI. */
export function topspeedConfigStatus(): {
  configured: boolean;
  hasApiKey: boolean;
  hasSenderId: boolean;
  baseUrl: string;
} {
  const hasApiKey = !!process.env.TOPSPEED_API_KEY;
  const hasSenderId = !!process.env.TOPSPEED_SENDER_ID;
  return {
    configured: hasApiKey,
    hasApiKey,
    hasSenderId,
    baseUrl: process.env.TOPSPEED_API_URL ?? "https://sms.ispledger.com/api/v3",
  };
}

/** GSM-7 segment math: 1 credit = 1 segment. Unicode (UCS-2) halves limits. */
export function smsSegments(body: string): number {
  // Any char outside GSM-7 basic+extension forces UCS-2 encoding.
  // eslint-disable-next-line no-control-regex
  const gsmRe = /^[\u0000-\u007F\u00A0\u00A3\u00A4\u00A5\u00A7\u00A8\u00AB\u00B6\u00B7\u00BB\u00BF\u00C4\u00C5\u00C6\u00D1\u00D6\u00D8\u00DE\u00DF\u00E0-\u00E5\u00E6\u00E8-\u00EC\u00F1\u00F2-\u00F6\u00F8\u00FE\u00FF\u20AC]*$/;
  const isUnicode = !gsmRe.test(body);
  const len = [...body].length;
  if (!isUnicode) {
    if (len <= 160) return 1;
    return Math.ceil(len / 153);
  }
  if (len <= 70) return 1;
  return Math.ceil(len / 67);
}

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

/** Real TOPSPEED send via the central credentials. Requires TOPSPEED_API_KEY. */
export async function sendSMSReal(to: string, message: string): Promise<SendResult> {
  const apiKey = process.env.TOPSPEED_API_KEY;
  const senderId = process.env.TOPSPEED_SENDER_ID;
  const base = (process.env.TOPSPEED_API_URL ?? "https://sms.ispledger.com/api/v3").replace(/\/+$/, "");
  if (!apiKey) {
    return { ok: false, provider_ref: null, error: "TOPSPEED_API_KEY not configured" };
  }
  if (!to || !message) return { ok: false, provider_ref: null, error: "Missing recipient or message" };
  const payload: Record<string, unknown> = { to, message };
  if (senderId) payload.sender_id = senderId;
  let res: Response;
  try {
    res = await fetch(`${base}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, provider_ref: null, error: e instanceof Error ? e.message.slice(0, 200) : "Network error" };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, provider_ref: null, error: `HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ""}` };
  }
  const json = (await res.json().catch(() => ({}))) as {
    id?: string; provider_ref?: string; message_id?: string; reference?: string;
  };
  return { ok: true, provider_ref: json.provider_ref ?? json.message_id ?? json.id ?? json.reference ?? null };
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