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

const UNIT = "EA";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKSPACE = "/admin/inventory/reservations";
const CREATE = `${WORKSPACE}/create`;
const RELEASE = /^\/admin\/inventory\/reservations\/([0-9a-f-]+)\/release$/iu;

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
  readonly sku: string;
  readonly requested_quantity: string;
  readonly reserved_quantity: string;
  readonly quantity_scale: number;
  readonly unit_code: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function validateOrigin(request: Request): void {
  const url = new URL(request.url);
  const expected = `${url.protocol}//${url.host}`;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== null && origin !== "null" && origin !== expected) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Reservation request origin is invalid",
      403,
    );
  }
  if (site !== null && site !== "same-origin") {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Cross-site reservation request is not allowed",
      403,
    );
  }
  if ((origin === null || origin === "null") && site !== "same-origin") {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Reservation origin evidence is missing",
      403,
    );
  }
}

function htmlResponse(request: Request, body: string): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
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

function redirect(
  request: Request,
  pathname: string,
  cookie?: string | null,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: new URL(pathname, request.url).toString(),
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function exactQuantity(raw: string, scale: number): string {
  const amount = BigInt(raw || "0");
  if (scale <= 0) return amount.toString();
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount)
    .toString()
    .padStart(scale + 1, "0");
  const fraction = digits.slice(-scale).replace(/0+$/u, "");
  return `${negative ? "-" : ""}${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}

async function loadWorkspace(
  env: StagingProtectedApiEnvironment,
  context: StagingReadContext,
): Promise<{
  readonly variants: readonly VariantRow[];
  readonly reservations: readonly ReservationRow[];
  readonly mfaEnrolled: boolean;
}> {
  const warehouseId = context.scope.warehouseId;
  if (!warehouseId) {
    throw new PlatformError("PERMISSION_DENIED", "Warehouse scope is required", 403);
  }
  const database = new NeonDatabase({
    connectionString: env.DATABASE_URL,
    statementTimeoutMs: 8_000,
    lockTimeoutMs: 1_000,
  });
  const [variants, reservations, factors] = await Promise.all([
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
               AND balance.unit_code = $3
               AND balance.quantity_scale = 0
           ), 0)
           - COALESCE((
             SELECT SUM(
               line.reserved_quantity
               - line.consumed_quantity
               - line.released_quantity
             )
             FROM inventory.stock_reservation_lines AS line
             JOIN inventory.stock_reservations AS reservation
               ON reservation.tenant_id = line.tenant_id
              AND reservation.id = line.reservation_id
             WHERE line.tenant_id = variant.tenant_id
               AND line.variant_id = variant.id
               AND line.warehouse_id = $2::uuid
               AND line.unit_code = $3
               AND line.quantity_scale = 0
               AND reservation.state IN (
                 'fully_reserved',
                 'partially_reserved',
                 'partially_consumed'
               )
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
      [context.tenant.id, warehouseId, UNIT],
    ),
    database.httpQuery<ReservationRow>(
      `SELECT
         reservation.id::text AS reservation_id,
         reservation.source_id,
         reservation.state,
         reservation.version::text,
         variant.sku,
         line.requested_quantity::text,
         line.reserved_quantity::text,
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
      [context.tenant.id, context.user.id, warehouseId],
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
  return { variants, reservations, mfaEnrolled: factors.length === 1 };
}

function feedback(url: URL): string {
  const error = url.searchParams.get("error");
  if (error) {
    return `<p class="error" role="alert">${escapeHtml(error.slice(0, 180))}</p>`;
  }
  for (const key of ["created", "released"] as const) {
    const id = url.searchParams.get(key);
    if (id && UUID.test(id)) {
      const action = key === "created" ? "created" : "released";
      return `<p class="success" role="status">Reservation ${escapeHtml(id)} was ${action}. The step-up grant was consumed.</p>`;
    }
  }
  if (url.searchParams.get("stepUp") === "1") {
    return '<p class="success" role="status">MFA step-up is ready for one command and expires within five minutes.</p>';
  }
  return "";
}

function renderWorkspace(
  url: URL,
  context: StagingReadContext,
  data: Awaited<ReturnType<typeof loadWorkspace>>,
): string {
  const available = data.variants.filter(
    (variant) => BigInt(variant.available || "0") > 0n,
  );
  const options = available.length === 0
    ? `<option value="">No available ${UNIT} variants</option>`
    : available.map((variant) =>
      `<option value="${escapeHtml(variant.variant_id)}">${escapeHtml(variant.product_name)} · ${escapeHtml(variant.variant_title)} · ${escapeHtml(variant.sku)} · ${escapeHtml(variant.available)} ${UNIT} available</option>`,
    ).join("");
  const rows = data.reservations.length === 0
    ? '<tr><td colspan="7">No controlled reservations created by this account.</td></tr>'
    : data.reservations.map((reservation) => {
      const releasable = [
        "fully_reserved",
        "partially_reserved",
        "partially_consumed",
      ].includes(reservation.state);
      const action = releasable
        ? `<form action="${WORKSPACE}/${escapeHtml(reservation.reservation_id)}/release" method="post"><input type="hidden" name="expectedVersion" value="${escapeHtml(reservation.version)}"><button class="danger" type="submit">Release with step-up</button></form>`
        : "Completed";
      return `<tr><td><code>${escapeHtml(reservation.source_id)}</code></td><td>${escapeHtml(reservation.sku)}</td><td>${escapeHtml(exactQuantity(reservation.requested_quantity, reservation.quantity_scale))} ${escapeHtml(reservation.unit_code)}</td><td>${escapeHtml(exactQuantity(reservation.reserved_quantity, reservation.quantity_scale))}</td><td>${escapeHtml(reservation.state.replaceAll("_", " "))}</td><td>${escapeHtml(reservation.version)}</td><td>${action}</td></tr>`;
    }).join("");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Controlled reservations</title><style>:root{font-family:ui-sans-serif,system-ui;color:#17231e;background:#f5f3ec}*{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}body{margin:0}.top{padding:1rem;background:#14251e;color:#fff}.top a{color:#f0d36d}.shell{width:min(100%,76rem);margin:0 auto;padding:clamp(1rem,3vw,2rem)}.shell,.grid,.card,.table-wrap{min-width:0;max-width:100%}h1{font-size:clamp(2rem,6vw,4rem);line-height:.95;letter-spacing:-.04em}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(18rem,.7fr);gap:1rem}.card{background:#fffefa;border:1px solid #d7ddd8;border-radius:1rem;padding:1.25rem}.notice,.success,.error{padding:.8rem 1rem;border-radius:.65rem}.notice,.success{border:2px solid #1f6a51;background:#edf8f3}.error{border:2px solid #9b2c2c;background:#fff2f0;color:#762020}.badge{display:inline-block;padding:.3rem .55rem;border-radius:999px;font-weight:800;background:#fff0c7}.badge.good{background:#d9f2e7}form{display:grid;gap:.75rem}label{font-weight:800}input,select{width:100%;min-width:0;min-height:48px;padding:.7rem;border:1px solid #87928b;border-radius:.45rem;font:inherit}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:0;border-radius:.45rem;background:#14251e;color:#fff;padding:.6rem .9rem;font-weight:800;text-decoration:none;cursor:pointer}.secondary{background:#fff;color:#14251e;border:1px solid #14251e}.danger{background:#7b2d26}.actions{display:flex;gap:.65rem;flex-wrap:wrap;margin:1rem 0}.table-wrap{overflow-x:auto;background:#fffefa;border:1px solid #d7ddd8;border-radius:1rem}.table-wrap:focus{outline:3px solid #1f6a51;outline-offset:2px}table{width:100%;border-collapse:collapse;min-width:54rem}th,td{text-align:left;padding:.75rem;border-bottom:1px solid #e2e6e3;vertical-align:top}th{background:#eef1ee}td form{display:block}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="shell"><strong>Persistent staging · controlled reservation checkpoint</strong><nav><a href="/admin">Dashboard</a> · <a href="/admin/inventory">Inventory</a> · <a href="/auth/mfa">MFA settings</a></nav></div></header><main class="shell"><p>Signed in as ${escapeHtml(context.user.name)} · ${escapeHtml(context.tenant.name)} · warehouse-scoped</p><h1>Controlled reservations</h1><p class="notice">This is the only enabled sensitive command. Every create or release requires current password + TOTP and a single-use grant. Payments, stock postings, transfers, accounting and banking remain disabled.</p>${feedback(url)}<div class="actions"><span class="badge ${data.mfaEnrolled ? "good" : ""}">${data.mfaEnrolled ? "TOTP MFA active" : "MFA setup required"}</span><a class="button secondary" href="/auth/mfa">${data.mfaEnrolled ? "Verify MFA step-up" : "Set up MFA"}</a></div><section class="grid"><div class="card"><h2>Create one reservation</h2><p>Quantity is limited to 1–5 ${UNIT}; the server forces the authenticated warehouse.</p><form action="${CREATE}" method="post"><div><label for="variant">Variant</label><select id="variant" name="variantId" required>${options}</select></div><div><label for="source">Reference</label><input id="source" name="sourceId" value="manual-${Date.now()}" maxlength="100" required></div><div><label for="quantity">Quantity (${UNIT})</label><input id="quantity" name="quantity" type="number" min="1" max="5" step="1" value="1" required></div><button type="submit" ${available.length === 0 ? "disabled" : ""}>Create with step-up</button></form></div><div class="card"><h2>Security state</h2><dl><dt>Session role</dt><dd>${escapeHtml(context.role)}</dd><dt>Read permissions</dt><dd>${context.permissions.length}</dd><dt>MFA</dt><dd>${data.mfaEnrolled ? "Active" : "Not enrolled"}</dd><dt>Command</dt><dd><code>inventory.reservation.manage</code></dd><dt>Grant</dt><dd>Single-use, max 5 minutes</dd><dt>Command token</dt><dd>Internal only, max 60 seconds</dd></dl></div></section><h2>Recent reservations</h2><div class="table-wrap" role="region" aria-label="Recent reservations" tabindex="0"><table><thead><tr><th>Reference</th><th>SKU</th><th>Requested</th><th>Reserved</th><th>State</th><th>Version</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></main></body></html>`;
}

async function protectedRequest(
  request: Request,
  env: StagingProtectedApiEnvironment,
  pathname: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
  });
  for (const name of [
    "cookie",
    "origin",
    "sec-fetch-site",
    "user-agent",
    "cf-connecting-ip",
    "x-forwarded-for",
  ]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return await handleStagingProtectedApi(
    new Request(new URL(pathname, request.url), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    env,
  ) ?? new Response(null, { status: 500 });
}

async function commandRedirect(
  request: Request,
  response: Response,
  key: "created" | "released",
): Promise<Response> {
  const text = await response.text();
  const target = new URL(WORKSPACE, request.url);
  if (response.ok) {
    try {
      const result = JSON.parse(text) as { id?: unknown };
      if (typeof result.id !== "string" || !UUID.test(result.id)) {
        throw new Error("invalid command response");
      }
      target.searchParams.set(key, result.id);
    } catch {
      target.searchParams.set("error", "Command succeeded but its response was invalid.");
    }
  } else {
    let message = "The reservation command failed.";
    try {
      const result = JSON.parse(text) as { error?: { message?: unknown } };
      if (typeof result.error?.message === "string") message = result.error.message;
    } catch {
      // Preserve the bounded generic message.
    }
    target.searchParams.set("error", message.slice(0, 180));
  }
  return redirect(
    request,
    `${target.pathname}${target.search}`,
    response.headers.get("set-cookie"),
  );
}

async function createReservation(
  request: Request,
  env: StagingProtectedApiEnvironment,
  context: StagingReadContext,
): Promise<Response> {
  validateOrigin(request);
  const warehouseId = context.scope.warehouseId;
  if (!warehouseId) {
    throw new PlatformError("PERMISSION_DENIED", "Warehouse scope is required", 403);
  }
  const form = await request.formData();
  const variantId = typeof form.get("variantId") === "string"
    ? String(form.get("variantId"))
    : "";
  const sourceId = typeof form.get("sourceId") === "string"
    ? String(form.get("sourceId")).trim()
    : "";
  const requested = Number(form.get("quantity"));
  if (
    !UUID.test(variantId) ||
    sourceId.length < 1 ||
    sourceId.length > 100 ||
    !Number.isInteger(requested) ||
    requested < 1 ||
    requested > 5
  ) {
    throw new PlatformError("VALIDATION_FAILED", "Reservation form input is invalid", 400);
  }
  return await commandRedirect(
    request,
    await protectedRequest(request, env, "/api/v1/inventory/reservations", {
      id: crypto.randomUUID(),
      sourceId,
      lines: [{
        id: crypto.randomUUID(),
        variantId,
        warehouseId,
        quantity: { amount: String(requested), unit: UNIT, scale: 0 },
      }],
    }),
    "created",
  );
}

async function releaseReservation(
  request: Request,
  env: StagingProtectedApiEnvironment,
  reservationId: string,
): Promise<Response> {
  validateOrigin(request);
  const form = await request.formData();
  const expectedVersion = Number(form.get("expectedVersion"));
  if (!UUID.test(reservationId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new PlatformError("VALIDATION_FAILED", "Reservation release input is invalid", 400);
  }
  return await commandRedirect(
    request,
    await protectedRequest(
      request,
      env,
      `/api/v1/inventory/reservations/${reservationId}/release`,
      { expectedVersion },
    ),
    "released",
  );
}

export async function handleStagingReservationUi(
  request: Request,
  url: URL,
  env: StagingProtectedApiEnvironment,
): Promise<Response | null> {
  const workspace = url.pathname === WORKSPACE || url.pathname === `${WORKSPACE}/`;
  const create = url.pathname === CREATE;
  const release = RELEASE.exec(url.pathname);
  if (!workspace && !create && !release) return null;
  try {
    const context = await resolveStagingReadContext(request, env);
    if (!context) {
      return redirect(request, `/login?returnTo=${encodeURIComponent(WORKSPACE)}`);
    }
    if (workspace && (request.method === "GET" || request.method === "HEAD")) {
      return htmlResponse(
        request,
        renderWorkspace(url, context, await loadWorkspace(env, context)),
      );
    }
    if (create && request.method === "POST") {
      return await createReservation(request, env, context);
    }
    if (release && request.method === "POST") {
      return await releaseReservation(request, env, release[1] ?? "");
    }
    return new Response(null, {
      status: 405,
      headers: {
        "Cache-Control": "no-store",
        Allow: workspace ? "GET, HEAD" : "POST",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reservation workflow failed";
    return redirect(
      request,
      `${WORKSPACE}?error=${encodeURIComponent(message.slice(0, 180))}`,
    );
  }
}
