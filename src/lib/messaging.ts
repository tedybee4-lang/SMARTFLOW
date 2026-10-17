/** TOPSPEED SMS + WhatsApp Cloud API skeletons (server-only). */
export async function sendSMS(_to: string, _message: string) {
  if (!process.env.TOPSPEED_API_KEY) throw new Error("TOPSPEED_API_KEY not configured");
  throw new Error("TOPSPEED sender not wired yet — add provider endpoint after account setup.");
}

export async function sendWhatsApp(_to: string, _template: string, _params: string[] = []) {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) throw new Error("WHATSAPP_ACCESS_TOKEN not configured");
  throw new Error("WhatsApp sender not wired yet — add Cloud API call after account setup.");
}
