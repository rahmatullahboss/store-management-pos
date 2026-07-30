import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import {
  handleStagingProtectedApi,
  type StagingProtectedApiEnvironment,
} from "./staging-protected-api.js";
import {
  resolveStagingReadContext,
  type StagingReadContext,
} from "./staging-read-context.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKSPACE_PATH = "/admin/inventory/reservations";
const CREATE_PATH = "/admin/inventory/reservations/create";
const RELEASE_PATH = /^\/admin\/inventory\/reservations\/([0-9a-f-]+)\/release$/iu;

interface VariantRow extends Record<string, unknown> {
  readonly variant_id: string;
  readonly product_name: string;
  readonly variant_title: string;
  readonly sku: string;
  readonly available: string;
}

interface ReservationRow extends Record<string, unknown> {
  readonly reservation_id: string;
  readonly source_id: string;
  readonly state: string;
  readonly version: string;
  readonly created_at: string;
  readonly line_id: string;
  readonly variant_id: string;
  readonly sku: string;
  readonly requested_quantity: string;
  readonly reserved_quantity: string;
  readonly consumed_quantity: string;
  readonly released_quantity: string;
  readonly quantity_scale: number;
  readonly unit_code: string;
}

interface ReservationWorkspaceData {
  readonly context: StagingReadContext;
  readonly variants: readonly VariantRow[];
  readonly reservations: readonly ReservationRow[];
  readonly mfaEnrolled: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

function exactOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function validateActionOrigin(request: Request): void {
  const expected = exactOrigin(request);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const opaqueOrigin = origin === "null";
  if (origin !== null && !opaqueOrigin && origin !== expected) {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Reservation request origin is invalid", 403);
  }
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Cross-site reservation request is not allowed", 403);
  }
  if ((origin === null || opaqueOrigin) && fetchSite !== "same-origin") {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Reservation origin evidence is missing", 403);
  }
}

function htmlResponse(request: Request, body: string, status = 200): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function redirectToLogin(request: Request): Response {
  const target = new URL("/login", request.url);
  target.searchParams.set("returnTo", WORKSPACE_PATH);
  return new Response(null, {
    status: 302,
    headers: { "Cache-Control": "no-store", Location: target.toString() },
  });
}

function redirectWithCookie(
  request: Request,
  target: URL,
  cookie: string | null,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: target.toString(),
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function displayQuantity(raw: string, scale: number): string {
  const amount = BigInt(raw || "0");
  if (scale <= 0) return amount.toString();
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const digits = absolute.toString().padStart(scale + 1, "0");
  const fraction = digits.slice(-scale).replace(/0+$/u, "");
  return `${negative ? "-" : ""}${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}

function stateLabel(state: string): string {
  return state.replaceAll("_", " ");
}

async function loadWorkspace(
  env: StagingProtectedApiEnvironment,
  context: StagingReadContext,
): Promise<ReservationWorkspaceData> {
  if (!context.scope.warehouseId) {
    throw new PlatformError("PERMISSION_DENIED", "Warehouse scope is required", 403);
  }
  const database = new NeonDatabase({
    connectionString: env.DATABASE_URL,
    statementTimeoutMs: 8_000,
    lockTimeoutMs: 1_000,
  });
  const [variants, reservations, factorRows] = await Promise.all([
    database.httpQuery<VariantRow>(
      `SELECT
         variant.id::text AS variant_id,
         COALESCE(product.metadata->>'displayName', product.code) AS product_name,
         variant.title AS variant_title,
         variant.sku,
         (
           COALESCE((
             SELECT SUM(balance.quantity_amount)
             FROM inventory.stock_balances AS balance
             WHERE balance.tenant_id = variant.tenant_id
               AND balance.variant_id = variant.id
               AND balance.warehouse_id = $2::uuid
               AND balance.stock_status = 'sellable'
               AND balance.unit_code = 'EACH'
               AND balance.quantity_scale = 0
           ), 0)
           - COALESCE((
             SELECT SUM(line.reserved_quantity - line.consumed_quantity - line.released_quantity)
             FROM inventory.stock_reservation_lines AS line
             JOIN inventory.stock_reservations AS reservation
               ON reservation.tenant_id = line.tenant_id
              AND reservation.id = line.reservation_id
             WHERE line.tenant_id = variant.tenant_id
               AND line.variant_id = variant.id
               AND line.warehouse_id = $2::uuid
               AND line.unit_code = 'EACH'
               AND line.quantity_scale = 0
               AND reservation.state IN ('fully_reserved','partially_reserved','partially_consumed')
           ), 0)
         )::text AS available
       FROM catalog.variants AS variant
       JOIN catalog.products AS product
         ON product.tenant_id = variant.tenant_id
        AND product.id = variant.product_id
       WHERE variant.tenant_id = $1::uuid
         AND variant.status = 'active'
         AND product.status = 'active'
       ORDER BY product.code, variant.sku`,
      [context.tenant.id, context.scope.warehouseId],
    ),
    database.httpQuery<ReservationRow>(
      `SELECT
         reservation.id::text AS reservation_id,
         reservation.source_id,
         reservation.state,
         reservation.version::text,
         reservation.created_at::text,
         line.id::text AS line_id,
         line.variant_id::text AS variant_id,
         variant.sku,
         line.requested_quantity::text,
         line.reserved_quantity::text,
         line.consumed_quantity::text,
         line.released_quantity::text,
         line.quantity_scale,
         line.unit_code
       FROM inventory.stock_reservations AS reservation
       JOIN inventory.stock_reservation_lines AS line
         ON line.tenant_id = reservation.tenant_id
        AND line.reservation_id = reservation.id
       JOIN catalog.variants AS variant
         ON variant.tenant_id = line.tenant_id
        AND variant.id = line.variant_id
       WHERE reservation.tenant_id = $1::uuid
         AND reservation.created_by = $2::uuid
         AND reservation.source_type = 'staging_manual'
         AND line.warehouse_id = $3::uuid
       ORDER BY reservation.created_at DESC
       LIMIT 20`,
      [context.tenant.id, context.user.id, context.scope.warehouseId],
    ),
    database.httpQuery(
      `SELECT factor.id
       FROM platform.auth_mfa_factors AS factor
       WHERE factor.user_id = $1::uuid
         AND factor.status = 'active'
       LIMIT 1`,
      [context.user.id],
    ),
  ]);
  return {
    context,
    variants,
    reservations,
    mfaEnrolled: factorRows.length === 1,
  };
}

function notice(url: URL): string {
  const error = url.searchParams.get("error");
  if (error) {
    return `<p class="error" role="alert">${escapeHtml(error.slice(0, 180))}</p>`;
  }
  const created = url.searchParams.get("created");
  if (created && UUID.test(created)) {
    return `<p class="success" role="status">Reservation ${escapeHtml(created)} was created. Its step-up grant was consumed.</p>`;
  }
  const released = url.searchParams.get("released");
  if (released && UUID.test(released)) {
    return `<p class="success" role="status">Reservation ${escapeHtml(released)} was released. Availability was restored.</p>`;
  }
  if (url.searchParams.get("stepUp") === "1") {
    return '<p class="success" role="status">MFA step-up is ready for one reservation command and expires within five minutes.</p>';
  }
  return "";
}

function renderWorkspace(url: URL, data: ReservationWorkspaceData): string {
  const enabledVariants = data.variants.filter((variant) => BigInt(variant.available || "0") > 0n);
  const variantOptions = enabledVariants.length === 0
    ? '<option value="">No available EACH variants</option>'
    : enabledVariants.map((variant) =>
      `<option value="${escapeHtml(variant.variant_id)}">${escapeHtml(variant.product_name)} · ${escapeHtml(variant.variant_title)} · ${escapeHtml(variant.sku)} · ${escapeHtml(variant.available)} available</option>`,
    ).join("");
  const rows = data.reservations.length === 0
    ? '<tr><td colspan="7">No controlled reservations have been created by this account.</td></tr>'
    : data.reservations.map((reservation) => {
      const releasable = ["fully_reserved", "partially_reserved", "partially_consumed"].includes(reservation.state);
      return `<tr><td><code>${escapeHtml(reservation.source_id)}</code></td><td>${escapeHtml(reservation.sku)}</td><td>${escapeHtml(displayQuantity(reservation.requested_quantity, reservation.quantity_scale))} ${escapeHtml(reservation.unit_code)}</td><td>${escapeHtml(displayQuantity(reservation.reserved_quantity, reservation.quantity_scale))}</td><td>${escapeHtml(stateLabel(reservation.state))}</td><td>${escapeHtml(reservation.version)}</td><td>${releasable ? `<form action="${WORKSPACE_PATH}/${escapeHtml(reservation.reservation_id)}/release" method="post"><input type="hidden" name="expectedVersion" value="${escapeHtml(reservation.version)}"><button class="danger" type="submit">Release with step-up</button></form>` : "Completed"}</td></tr>`;
    }).join("");
  const mfa = data.mfaEnrolled
    ? '<span class="badge good">TOTP MFA active</span>'
    : '<span class="badge warn">MFA setup required</span>';
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Controlled reservations</title><style>:root{font-family:ui-sans-serif,system-ui;color:#17231e;background:#f5f3ec}*{box-sizing:border-box}body{margin:0}.top{padding:1rem;background:#14251e;color:#fff}.top a{color:#f0d36d}.shell{width:min(100%,76rem);margin:0 auto;padding:clamp(1rem,3vw,2rem)}h1{font-size:clamp(2rem,6vw,4rem);line-height:.95;letter-spacing:-.04em;margin:.5rem 0}p{line-height:1.55}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(18rem,.7fr);gap:1rem}.card{background:#fffefa;border:1px solid #d7ddd8;border-radius:1rem;padding:clamp(1rem,2vw,1.5rem);box-shadow:0 10px 26px rgba(23,35,30,.08)}.notice{border:2px solid #1f6a51;background:#edf8f3;padding:.8rem 1rem;border-radius:.65rem}.error{border:2px solid #9b2c2c;background:#fff2f0;color:#762020;padding:.75rem;border-radius:.5rem}.success{border:2px solid #1f6a51;background:#edf8f3;color:#153e31;padding:.75rem;border-radius:.5rem}.badge{display:inline-block;padding:.3rem .55rem;border-radius:999px;font-weight:800}.good{background:#d9f2e7;color:#174b38}.warn{background:#fff0c7;color:#6a4300}form{display:grid;gap:.8rem}label{font-weight:800}input,select{width:100%;min-height:48px;padding:.7rem .8rem;border:1px solid #87928b;border-radius:.45rem;font:inherit}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:0;border-radius:.45rem;background:#14251e;color:#fff;padding:.6rem .9rem;font:800 .9rem/1 system-ui;cursor:pointer;text-decoration:none}.secondary{background:#fff;color:#14251e;border:1px solid #14251e}.danger{background:#7b2d26}.actions{display:flex;gap:.65rem;flex-wrap:wrap;margin:1rem 0}.table-wrap{overflow-x:auto;background:#fffefa;border:1px solid #d7ddd8;border-radius:1rem}table{width:100%;border-collapse:collapse;min-width:54rem}th,td{text-align:left;padding:.75rem;border-bottom:1px solid #e2e6e3;vertical-align:top}th{background:#eef1ee}td form{display:block}code{overflow-wrap:anywhere}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="shell"><strong>Persistent staging · controlled reservation checkpoint</strong><nav><a href="/admin">Dashboard</a> · <a href="/admin/inventory">Inventory</a> · <a href="/auth/mfa">MFA settings</a></nav></div></header><main class="shell"><p>${escapeHtml(data.context.tenant.name)} · ${escapeHtml(data.context.user.name)} · warehouse-scoped</p><h1>Controlled reservations</h1><p class="notice">This is the only enabled sensitive command. Every create or release requires current password + TOTP, a single-use grant and a 60-second internal command token. Payments, stock postings, transfers, accounting and banking remain disabled.</p>${notice(url)}<div class="actions">${mfa}<a class="button secondary" href="/auth/mfa">${data.mfaEnrolled ? "Verify MFA step-up" : "Set up MFA"}</a></div><section class="grid"><div class="card"><h2>Create one reservation</h2><p>Quantity is limited to 1–5 EACH and the server forces the authenticated warehouse.</p><form action="${CREATE_PATH}" method="post"><div><label for="reservation-variant">Variant</label><select id="reservation-variant" name="variantId" required>${variantOptions}</select></div><div><label for="reservation-source">Reference</label><input id="reservation-source" name="sourceId" value="manual-${Date.now()}" maxlength="100" required></div><div><label for="reservation-quantity">Quantity</label><input id="reservation-quantity" name="quantity" type="number" min="1" max="5" step="1" value="1" required></div><button type="submit" ${enabledVariants.length === 0 ? "disabled" : ""}>Create with step-up</button></form></div><div class="card"><h2>Security state</h2><dl><dt>Session role</dt><dd>${escapeHtml(data.context.role)}</dd><dt>Read permissions</dt><dd>${data.context.permissions.length}</dd><dt>MFA</dt><dd>${data.mfaEnrolled ? "Active" : "Not enrolled"}</dd><dt>Command permission</dt><dd><code>inventory.reservation.manage</code></dd><dt>Grant</dt><dd>Single-use, max 5 minutes</dd><dt>Command token</dt><dd>Internal only, max 60 seconds</dd></dl></div></section><h2>Recent reservations</h2><div class="table-wrap"><table><thead><tr><th>Reference</th><th>SKU</th><th>Requested</th><th>Reserved</th><th>State</th><th>Version</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></main></body></html>`;
}

async function protectedJsonRequest(
  request: Request,
  env: StagingProtectedApiEnvironment,
  pathname: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const headers = new Headers();
  for (const name of ["cookie", "origin", "sec-fetch-site", "user-agent", "cf-connecting-ip", "x-forwarded-for"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-request-id", requestId(request));
  return await handleStagingProtectedApi(
    new Request(new URL(pathname, request.url), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    env,
  ) ?? new Response(null, { status: 500 });
}

async function actionRedirect(
  request: Request,
  response: Response,
  successKey: "created" | "released",
): Promise<Response> {
  const body = await response.text();
  const target = new URL(WORKSPACE_PATH, request.url);
  const cookie = response.headers.get("set-cookie");
  if (response.ok) {
    try {
      const parsed = JSON.parse(body) as { id?: unknown };
      const id = typeof parsed.id === "string" && UUID.test(parsed.id) ? parsed.id : "";
      if (!id) throw new Error("missing id");
      target.searchParams.set(successKey, id);
    } catch {
      target.searchParams.set("error", "Command succeeded but its response was invalid.");
    }
  } else {
    let message = "The reservation command failed.";
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown } };
      if (typeof parsed.error?.message === "string") message = parsed.error.message;
    } catch {
      // Keep the bounded generic message.
    }
    target.searchParams.set("error", message.slice(0, 180));
  }
  return redirectWithCookie(request, target, cookie);
}

async function createReservation(
  request: Request,
  env: StagingProtectedApiEnvironment,
  context: StagingReadContext,
): Promise<Response> {
  validateActionOrigin(request);
  if (!context.scope.warehouseId) {
    throw new PlatformError("PERMISSION_DENIED", "Warehouse scope is required", 403);
  }
  const form = await request.formData();
  const variantId = typeof form.get("variantId") === "string" ? String(form.get("variantId")) : "";
  const sourceId = typeof form.get("sourceId") === "string" ? String(form.get("sourceId")).trim() : "";
  const quantity = Number(form.get("quantity"));
  if (!UUID.test(variantId) || sourceId.length < 1 || sourceId.length > 100 || !Number.isInteger(quantity) || quantity < 1 || quantity > 5) {
    throw new PlatformError("VALIDATION_FAILED", "Reservation form input is invalid", 400);
  }
  const reservationId = crypto.randomUUID();
  const response = await protectedJsonRequest(request, env, "/api/v1/inventory/reservations", {
    id: reservationId,
    sourceId,
    lines: [{
      id: crypto.randomUUID(),
      variantId,
      warehouseId: context.scope.warehouseId,
      quantity: { amount: String(quantity), unit: "EACH", scale: 0 },
    }],
  });
  return await actionRedirect(request, response, "created");
}

async function releaseReservation(
  request: Request,
  env: StagingProtectedApiEnvironment,
  reservationId: string,
): Promise<Response> {
  validateActionOrigin(request);
  const form = await request.formData();
  const expectedVersion = Number(form.get("expectedVersion"));
  if (!UUID.test(reservationId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new PlatformError("VALIDATION_FAILED", "Reservation release input is invalid", 400);
  }
  const response = await protectedJsonRequest(
    request,
    env,
    `/api/v1/inventory/reservations/${reservationId}/release`,
    { expectedVersion },
  );
  return await actionRedirect(request, response, "released");
}

export async function handleStagingReservationUi(
  request: Request,
  url: URL,
  env: StagingProtectedApiEnvironment,
): Promise<Response | null> {
  const workspace = url.pathname === WORKSPACE_PATH || url.pathname === `${WORKSPACE_PATH}/`;
  const create = url.pathname === CREATE_PATH;
  const release = RELEASE_PATH.exec(url.pathname);
  if (!workspace && !create && !release) return null;
  try {
    const context = await resolveStagingReadContext(request, env);
    if (!context) return redirectToLogin(request);
    if (workspace && (request.method === "GET" || request.method === "HEAD")) {
      return htmlResponse(request, renderWorkspace(url, await loadWorkspace(env, context)));
    }
    if (create && request.method === "POST") {
      return await createReservation(request, env, context);
    }
    if (release && request.method === "POST") {
      return await releaseReservation(request, env, release[1] ?? "");
    }
    return new Response(null, {
      status: 405,
      headers: { "Cache-Control": "no-store", Allow: workspace ? "GET, HEAD" : "POST" },
    });
  } catch (error) {
    const target = new URL(WORKSPACE_PATH, request.url);
    const message = error instanceof Error ? error.message : "Reservation workflow failed";
    target.searchParams.set("error", message.slice(0, 180));
    return redirectWithCookie(request, target, null);
  }
}
