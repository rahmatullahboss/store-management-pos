import { timingSafeEqual } from "./crypto.js";

const encoder = new TextEncoder();
function toHex(bytes: ArrayBuffer): string { return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); }

export async function signWebhook(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
}

export async function verifyWebhook(input: { secret: string; timestamp: number; body: string; signature: string; now?: number; toleranceSeconds?: number }): Promise<boolean> {
  const now = input.now ?? Math.floor(Date.now() / 1_000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - input.timestamp) > tolerance) return false;
  return timingSafeEqual(await signWebhook(input.secret, input.timestamp, input.body), input.signature.toLowerCase());
}
