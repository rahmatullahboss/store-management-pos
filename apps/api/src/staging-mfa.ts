import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import {
  errorResponse,
  PlatformError,
} from "../../../packages/foundation/src/errors.js";
import {
  resolveStagingReadContext,
  type StagingReadContextEnvironment,
} from "./staging-read-context.js";

const SESSION_COOKIE = "ozzyl_staging_session";
const STEP_UP_COOKIE = "ozzyl_staging_step_up";
const STEP_UP_SECONDS = 300;
const TOTP_PERIOD_SECONDS = 30;
const PBKDF2_ITERATIONS = 310_000;
const RESERVATION_PERMISSION = "inventory.reservation.manage";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const encoder = new TextEncoder();

type WebBytes = Uint8Array<ArrayBuffer>;

export interface StagingMfaFactor {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly status: "pending" | "active";
  readonly label: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly salt: string;
  readonly iterations: number;
  readonly lastUsedCounter?: number;
  readonly confirmedAt?: string;
}

interface PendingFactorInput {
  readonly sessionTokenHash: string;
  readonly factorId: string;
  readonly label: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly salt: string;
  readonly iterations: number;
  readonly requestId: string;
}

interface StepUpInput {
  readonly sessionTokenHash: string;
  readonly factorId: string;
  readonly grantId: string;
  readonly grantTokenHash: string;
  readonly permission: typeof RESERVATION_PERMISSION;
  readonly counter: number;
  readonly expiresAt: string;
  readonly requestId: string;
}

export interface StagingMfaStore {
  loadFactor(
    sessionTokenHash: string,
    status: "pending" | "active",
  ): Promise<StagingMfaFactor | null>;
  verifyPassword(
    sessionTokenHash: string,
    password: string,
    requestId: string,
  ): Promise<boolean>;
  storePending(input: PendingFactorInput): Promise<boolean>;
  activate(
    sessionTokenHash: string,
    factorId: string,
    counter: number,
    requestId: string,
  ): Promise<boolean>;
  issueStepUp(input: StepUpInput): Promise<boolean>;
  consumeStepUp(
    sessionTokenHash: string,
    grantTokenHash: string,
    permission: typeof RESERVATION_PERMISSION,
  ): Promise<boolean>;
}

export interface StagingMfaEnvironment extends StagingReadContextEnvironment {
  readonly STAGING_MFA_STORE?: StagingMfaStore;
}

interface FactorRow extends Record<string, unknown> {
  readonly factor_id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly factor_status: "pending" | "active";
  readonly factor_label: string;
  readonly secret_ciphertext: string;
  readonly secret_iv: string;
  readonly secret_salt: string;
  readonly kdf_iterations: number;
  readonly last_used_counter?: string | number | null;
  readonly confirmed_at?: string | null;
}

function webBytes(value: Uint8Array): WebBytes {
  const output = new Uint8Array(value.byteLength);
  output.set(value);
  return output;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): WebBytes {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new PlatformError("VALIDATION_FAILED", "MFA secret encoding is invalid", 400);
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index);
    }
    if (base64Url(output) !== value) throw new Error("non-canonical");
    return output;
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "MFA secret encoding is invalid", 400);
  }
}

function randomBytes(length: number): WebBytes {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
}

function randomToken(): string {
  return base64Url(randomBytes(32));
}

async function sha256(value: string): Promise<string> {
  return base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const entry of header.split(";")) {
    const [candidate, ...parts] = entry.trim().split("=");
    if (candidate !== name) continue;
    const value = parts.join("=");
    return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
  }
  return null;
}

function sessionToken(request: Request): string | null {
  return cookieValue(request, SESSION_COOKIE);
}

function stepUpToken(request: Request): string | null {
  return cookieValue(request, STEP_UP_COOKIE);
}

function stepUpCookie(token: string, expiresAt: Date): string {
  return `${STEP_UP_COOKIE}=${token}; Path=/; Max-Age=${STEP_UP_SECONDS}; Expires=${expiresAt.toUTCString()}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearStagingStepUpCookie(): string {
  return `${STEP_UP_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

function validateActionOrigin(request: Request): void {
  const url = new URL(request.url);
  const expected = `${url.protocol}//${url.host}`;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== null && origin !== "null" && origin !== expected) {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "MFA request origin is invalid", 403);
  }
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Cross-site MFA is not allowed", 403);
  }
  if ((origin === null || origin === "null") && fetchSite !== "same-origin") {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "MFA origin evidence is missing", 403);
  }
}

function safeReturnTo(value: FormDataEntryValue | null): string {
  return typeof value === "string" && value.trim() === "/admin/inventory/reservations"
    ? "/admin/inventory/reservations"
    : "/admin/inventory/reservations";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function securityHeaders(contentType: string): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

function htmlResponse(request: Request, body: string, status = 200): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: securityHeaders("text/html; charset=utf-8"),
  });
}

function redirect(request: Request, pathname: string, cookie?: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: new URL(pathname, request.url).toString(),
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function rowToFactor(row: FactorRow): StagingMfaFactor {
  const rawCounter = row.last_used_counter;
  const counter = rawCounter === null || rawCounter === undefined
    ? undefined
    : Number(rawCounter);
  return {
    id: String(row.factor_id),
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    status: row.factor_status,
    label: String(row.factor_label),
    ciphertext: String(row.secret_ciphertext),
    iv: String(row.secret_iv),
    salt: String(row.secret_salt),
    iterations: Number(row.kdf_iterations),
    ...(counter === undefined ? {} : { lastUsedCounter: counter }),
    ...(row.confirmed_at
      ? { confirmedAt: new Date(String(row.confirmed_at)).toISOString() }
      : {}),
  };
}

class PostgresStagingMfaStore implements StagingMfaStore {
  private readonly database: NeonDatabase;

  constructor(connectionString: string) {
    this.database = new NeonDatabase({
      connectionString,
      statementTimeoutMs: 12_000,
      lockTimeoutMs: 2_000,
    });
  }

  async loadFactor(
    sessionTokenHash: string,
    status: "pending" | "active",
  ): Promise<StagingMfaFactor | null> {
    const rows = await this.database.httpQuery<FactorRow>(
      "SELECT * FROM platform.custom_auth_load_totp_factor($1::text,$2::text)",
      [sessionTokenHash, status],
    );
    return rows[0] ? rowToFactor(rows[0]) : null;
  }

  async verifyPassword(
    sessionTokenHash: string,
    password: string,
    requestIdValue: string,
  ): Promise<boolean> {
    const rows = await this.database.httpQuery<
      { valid: boolean } & Record<string, unknown>
    >(
      "SELECT platform.custom_auth_verify_current_password($1::text,$2::text,$3::text) AS valid",
      [sessionTokenHash, password, requestIdValue],
    );
    return rows[0]?.valid === true;
  }

  async storePending(input: PendingFactorInput): Promise<boolean> {
    const rows = await this.database.httpQuery(
      `SELECT * FROM platform.custom_auth_store_pending_totp(
        $1::text,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::integer,$8::text
      )`,
      [
        input.sessionTokenHash,
        input.factorId,
        input.label,
        input.ciphertext,
        input.iv,
        input.salt,
        input.iterations,
        input.requestId,
      ],
    );
    return rows.length === 1;
  }

  async activate(
    sessionTokenHash: string,
    factorId: string,
    counter: number,
    requestIdValue: string,
  ): Promise<boolean> {
    const rows = await this.database.httpQuery<
      { activated: boolean } & Record<string, unknown>
    >(
      "SELECT platform.custom_auth_activate_totp($1::text,$2::uuid,$3::bigint,$4::text) AS activated",
      [sessionTokenHash, factorId, counter.toString(), requestIdValue],
    );
    return rows[0]?.activated === true;
  }

  async issueStepUp(input: StepUpInput): Promise<boolean> {
    const rows = await this.database.httpQuery(
      `SELECT * FROM platform.custom_auth_issue_step_up(
        $1::text,$2::uuid,$3::uuid,$4::text,$5::text,$6::bigint,$7::timestamptz,$8::text
      )`,
      [
        input.sessionTokenHash,
        input.factorId,
        input.grantId,
        input.grantTokenHash,
        input.permission,
        input.counter.toString(),
        input.expiresAt,
        input.requestId,
      ],
    );
    return rows.length === 1;
  }

  async consumeStepUp(
    sessionTokenHash: string,
    grantTokenHash: string,
    permission: typeof RESERVATION_PERMISSION,
  ): Promise<boolean> {
    const rows = await this.database.httpQuery<
      { consumed: boolean } & Record<string, unknown>
    >(
      "SELECT platform.custom_auth_consume_step_up($1::text,$2::text,$3::text) AS consumed",
      [sessionTokenHash, grantTokenHash, permission],
    );
    return rows[0]?.consumed === true;
  }
}

function store(env: StagingMfaEnvironment): StagingMfaStore {
  if (env.STAGING_MFA_STORE) return env.STAGING_MFA_STORE;
  if (!env.DATABASE_URL) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "MFA database is not configured",
      503,
    );
  }
  return new PostgresStagingMfaStore(env.DATABASE_URL);
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): WebBytes {
  const normalized = value.replaceAll(" ", "").toUpperCase().replace(/=+$/u, "");
  if (!/^[A-Z2-7]{16,128}$/u.test(normalized)) {
    throw new PlatformError("VALIDATION_FAILED", "TOTP secret is invalid", 400);
  }
  const output: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new PlatformError("VALIDATION_FAILED", "TOTP secret is invalid", 400);
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function passwordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: webBytes(salt),
      iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptTotpSecret(
  secret: Uint8Array,
  password: string,
  factorId: string,
): Promise<{
  readonly ciphertext: string;
  readonly iv: string;
  readonly salt: string;
  readonly iterations: number;
}> {
  const iv = randomBytes(12);
  const salt = randomBytes(16);
  const key = await passwordKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(`ozzyl-totp:${factorId}`),
      },
      key,
      webBytes(secret),
    ),
  );
  return {
    ciphertext: base64Url(ciphertext),
    iv: base64Url(iv),
    salt: base64Url(salt),
    iterations: PBKDF2_ITERATIONS,
  };
}

export async function decryptTotpSecret(
  factor: StagingMfaFactor,
  password: string,
): Promise<WebBytes> {
  try {
    const key = await passwordKey(
      password,
      decodeBase64Url(factor.salt),
      factor.iterations,
    );
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decodeBase64Url(factor.iv),
          additionalData: encoder.encode(`ozzyl-totp:${factor.id}`),
        },
        key,
        decodeBase64Url(factor.ciphertext),
      ),
    );
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Current password is invalid",
      403,
    );
  }
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const counterBytes = new Uint8Array(8);
  let remaining = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    counterBytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    webBytes(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, webBytes(counterBytes)),
  );
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const binary =
    (((digest[offset] ?? 0) & 127) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function totpCodeAt(
  secret: Uint8Array,
  nowMs: number,
): Promise<{ readonly code: string; readonly counter: number }> {
  const counter = Math.floor(nowMs / 1_000 / TOTP_PERIOD_SECONDS);
  return { code: await hotp(secret, counter), counter };
}

export async function verifyTotpCode(
  secret: Uint8Array,
  code: string,
  nowMs = Date.now(),
): Promise<number | null> {
  if (!/^\d{6}$/u.test(code)) return null;
  const current = Math.floor(nowMs / 1_000 / TOTP_PERIOD_SECONDS);
  for (const counter of [current - 1, current, current + 1]) {
    if (counter >= 0 && (await hotp(secret, counter)) === code) return counter;
  }
  return null;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title><style>:root{font-family:ui-sans-serif,system-ui;color:#17231e;background:#f5f3ec}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:1rem}.shell{width:min(100%,48rem);margin:clamp(1rem,5vw,4rem) auto;background:#fffefa;border:1px solid #d7ddd8;border-radius:1rem;padding:clamp(1rem,4vw,2rem);box-shadow:0 12px 34px rgba(23,35,30,.12)}h1{font-size:clamp(2rem,7vw,3.4rem);line-height:1;margin:.25rem 0 .75rem}p{line-height:1.55}.notice{border:2px solid #1f6a51;background:#edf8f3;padding:.8rem 1rem;border-radius:.65rem}.warning{border:2px solid #9b651d;background:#fff7df;padding:.8rem 1rem;border-radius:.65rem}form{display:grid;gap:.8rem;margin-top:1.25rem}label{font-weight:800}input{width:100%;min-height:48px;padding:.7rem .8rem;border:1px solid #87928b;border-radius:.45rem;font:inherit}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;border:0;border-radius:.45rem;background:#14251e;color:#fff;padding:.7rem 1rem;font:800 1rem/1 system-ui;cursor:pointer;text-decoration:none}.secondary{background:#fff;color:#14251e;border:1px solid #14251e}code{overflow-wrap:anywhere;background:#eef1ee;padding:.15rem .3rem;border-radius:.25rem}.actions{display:flex;gap:.65rem;flex-wrap:wrap;margin-top:1rem}</style></head><body><main class="shell"><p><a href="/admin">← Admin</a></p>${body}</main></body></html>`;
}

async function mfaPage(request: Request, env: StagingMfaEnvironment): Promise<Response> {
  const context = await resolveStagingReadContext(request, env);
  const token = sessionToken(request);
  if (!context || !token) return redirect(request, "/login?returnTo=/auth/mfa");
  const tokenHash = await sha256(token);
  const active = await store(env).loadFactor(tokenHash, "active");
  const pending = active ? null : await store(env).loadFactor(tokenHash, "pending");
  const url = new URL(request.url);
  const status = url.searchParams.get("enrolled") === "1"
    ? '<p class="notice" role="status">TOTP MFA is active.</p>'
    : "";
  if (active) {
    return htmlResponse(
      request,
      page(
        "MFA and step-up",
        `${status}<h1>MFA is active</h1><p class="notice"><strong>${escapeHtml(active.label)}</strong><br>Confirmed ${escapeHtml(active.confirmedAt ?? "recently")}. The secret is encrypted at rest.</p><h2>Authorize one reservation command</h2><p>Enter your current password and a fresh code. The grant is single-use and expires within five minutes.</p><form action="/auth/mfa/step-up" method="post"><input type="hidden" name="returnTo" value="/admin/inventory/reservations"><div><label for="step-password">Current password</label><input id="step-password" name="password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></div><div><label for="step-code">Authenticator code</label><input id="step-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><button type="submit">Verify and continue</button></form><div class="actions"><a class="button secondary" href="/admin/inventory/reservations">Open reservations</a></div>`,
      ),
    );
  }
  return htmlResponse(
    request,
    page(
      "Set up MFA",
      `${pending ? '<p class="warning">An unfinished enrollment exists. Starting again rotates its pending encrypted secret.</p>' : ""}<h1>Set up TOTP MFA</h1><p>Use a staging-only authenticator entry. The secret is encrypted with a key derived from your current password before storage.</p><form action="/auth/mfa/enroll" method="post"><div><label for="mfa-label">Factor label</label><input id="mfa-label" name="label" value="Primary authenticator" minlength="1" maxlength="80" required></div><div><label for="mfa-password">Current password</label><input id="mfa-password" name="password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></div><button type="submit">Generate encrypted TOTP secret</button></form>`,
    ),
  );
}

async function enroll(request: Request, env: StagingMfaEnvironment): Promise<Response> {
  validateActionOrigin(request);
  const context = await resolveStagingReadContext(request, env);
  const token = sessionToken(request);
  if (!context || !token) return redirect(request, "/login?returnTo=/auth/mfa");
  const form = await request.formData();
  const password = typeof form.get("password") === "string"
    ? String(form.get("password"))
    : "";
  const label = typeof form.get("label") === "string"
    ? String(form.get("label")).trim()
    : "";
  if (password.length < 10 || password.length > 128 || label.length < 1 || label.length > 80) {
    throw new PlatformError("VALIDATION_FAILED", "MFA enrollment input is invalid", 400);
  }
  const tokenHash = await sha256(token);
  if (!(await store(env).verifyPassword(tokenHash, password, requestId(request)))) {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Current password is invalid", 403);
  }
  const factorId = crypto.randomUUID();
  const secretBytes = randomBytes(20);
  const secret = base32Encode(secretBytes);
  const encrypted = await encryptTotpSecret(secretBytes, password, factorId);
  const stored = await store(env).storePending({
    sessionTokenHash: tokenHash,
    factorId,
    label,
    ...encrypted,
    requestId: requestId(request),
  });
  if (!stored) {
    throw new PlatformError("INTERNAL_ERROR", "MFA enrollment could not be stored", 500);
  }
  const account = encodeURIComponent(context.user.email);
  const issuer = encodeURIComponent("Ozzyl Store Staging");
  const otpauth = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return htmlResponse(
    request,
    page(
      "Confirm TOTP MFA",
      `<h1>Add the authenticator</h1><p class="warning">This secret is shown only in this response. Do not use it outside synthetic staging.</p><p><strong>Manual secret</strong><br><code>${escapeHtml(secret)}</code></p><p><strong>Authenticator URI</strong><br><code>${escapeHtml(otpauth)}</code></p><form action="/auth/mfa/confirm" method="post"><div><label for="confirm-password">Current password</label><input id="confirm-password" name="password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></div><div><label for="confirm-code">Six-digit code</label><input id="confirm-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><button type="submit">Confirm MFA</button></form>`,
    ),
  );
}

async function confirm(request: Request, env: StagingMfaEnvironment): Promise<Response> {
  validateActionOrigin(request);
  const context = await resolveStagingReadContext(request, env);
  const token = sessionToken(request);
  if (!context || !token) return redirect(request, "/login?returnTo=/auth/mfa");
  const form = await request.formData();
  const password = typeof form.get("password") === "string"
    ? String(form.get("password"))
    : "";
  const code = typeof form.get("code") === "string"
    ? String(form.get("code")).trim()
    : "";
  const tokenHash = await sha256(token);
  if (!(await store(env).verifyPassword(tokenHash, password, requestId(request)))) {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Current password is invalid", 403);
  }
  const factor = await store(env).loadFactor(tokenHash, "pending");
  if (!factor) {
    throw new PlatformError("NOT_FOUND", "Pending MFA enrollment was not found", 404);
  }
  const counter = await verifyTotpCode(
    await decryptTotpSecret(factor, password),
    code,
  );
  if (counter === null) {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Authenticator code is invalid", 403);
  }
  if (!(await store(env).activate(tokenHash, factor.id, counter, requestId(request)))) {
    throw new PlatformError("CONFLICT", "MFA enrollment state changed", 409);
  }
  return redirect(request, "/auth/mfa?enrolled=1");
}

async function issueStepUp(request: Request, env: StagingMfaEnvironment): Promise<Response> {
  validateActionOrigin(request);
  const context = await resolveStagingReadContext(request, env);
  const token = sessionToken(request);
  if (!context || !token) return redirect(request, "/login?returnTo=/auth/mfa");
  const form = await request.formData();
  const password = typeof form.get("password") === "string"
    ? String(form.get("password"))
    : "";
  const code = typeof form.get("code") === "string"
    ? String(form.get("code")).trim()
    : "";
  const returnTo = safeReturnTo(form.get("returnTo"));
  const tokenHash = await sha256(token);
  if (!(await store(env).verifyPassword(tokenHash, password, requestId(request)))) {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Current password is invalid", 403);
  }
  const factor = await store(env).loadFactor(tokenHash, "active");
  if (!factor) throw new PlatformError("PERMISSION_DENIED", "Active MFA is required", 403);
  const counter = await verifyTotpCode(
    await decryptTotpSecret(factor, password),
    code,
  );
  if (counter === null) {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Authenticator code is invalid", 403);
  }
  const grantToken = randomToken();
  const expiresAt = new Date(Date.now() + STEP_UP_SECONDS * 1_000);
  const issued = await store(env).issueStepUp({
    sessionTokenHash: tokenHash,
    factorId: factor.id,
    grantId: crypto.randomUUID(),
    grantTokenHash: await sha256(grantToken),
    permission: RESERVATION_PERMISSION,
    counter,
    expiresAt: expiresAt.toISOString(),
    requestId: requestId(request),
  });
  if (!issued) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Authenticator code was already used or authorization changed",
      403,
    );
  }
  const target = new URL(returnTo, request.url);
  target.searchParams.set("stepUp", "1");
  return redirect(
    request,
    `${target.pathname}${target.search}`,
    stepUpCookie(grantToken, expiresAt),
  );
}

export async function consumeStagingStepUp(
  request: Request,
  env: StagingMfaEnvironment,
  permission: typeof RESERVATION_PERMISSION = RESERVATION_PERMISSION,
): Promise<boolean> {
  const session = sessionToken(request);
  const grant = stepUpToken(request);
  if (!session || !grant || permission !== RESERVATION_PERMISSION) return false;
  return await store(env).consumeStepUp(
    await sha256(session),
    await sha256(grant),
    permission,
  );
}

export async function handleStagingMfaRequest(
  request: Request,
  url: URL,
  env: StagingMfaEnvironment,
): Promise<Response | null> {
  try {
    if (
      url.pathname === "/auth/mfa" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return await mfaPage(request, env);
    }
    if (url.pathname === "/auth/mfa/status" && request.method === "GET") {
      const context = await resolveStagingReadContext(request, env);
      const token = sessionToken(request);
      if (!context || !token) {
        return Response.json(
          { enrolled: false },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }
      const factor = await store(env).loadFactor(await sha256(token), "active");
      return Response.json(
        {
          enrolled: factor !== null,
          factor: factor
            ? { label: factor.label, confirmedAt: factor.confirmedAt }
            : null,
          stepUpPermission: RESERVATION_PERMISSION,
          grantLifetimeSeconds: STEP_UP_SECONDS,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (url.pathname === "/auth/mfa/enroll" && request.method === "POST") {
      return await enroll(request, env);
    }
    if (url.pathname === "/auth/mfa/confirm" && request.method === "POST") {
      return await confirm(request, env);
    }
    if (url.pathname === "/auth/mfa/step-up" && request.method === "POST") {
      return await issueStepUp(request, env);
    }
    return null;
  } catch (error) {
    return errorResponse(error, requestId(request));
  }
}

export const STAGING_RESERVATION_PERMISSION = RESERVATION_PERMISSION;
export const STAGING_STEP_UP_SECONDS = STEP_UP_SECONDS;
export const STAGING_TOTP_PERIOD_SECONDS = TOTP_PERIOD_SECONDS;
export const STAGING_TOTP_PBKDF2_ITERATIONS = PBKDF2_ITERATIONS;
export const stagingTotpBase32 = {
  encode: base32Encode,
  decode: base32Decode,
};
