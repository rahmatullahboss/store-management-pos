import {
  renderAdminFoundationPreview,
  renderAdminShell,
  renderInventoryAdminPage,
  renderProcurementAdminPage,
  type AdminShellInput,
} from "../../admin-web/src/app-shell/index.js";
import { renderRegisterWorkspace } from "../../pos-web/src/modules/register/surface.js";
import apiWorker, { type ApiEnvironment } from "./index.js";
import {
  getStagingAuthSession,
  handleStagingAuthRequest,
  stagingAuthIsRequired,
  type StagingAuthEnvironment,
  type StagingAuthSession,
} from "./staging-auth.js";

export interface StagingEnvironment extends ApiEnvironment, StagingAuthEnvironment {
  readonly STAGING_GIT_SHA?: string;
}

const ADMIN_PERMISSIONS = new Set([
  "catalog.product.read",
  "catalog.import.execute",
  "catalog.unit.manage",
  "pricing.price.read",
  "pricing.promotion.manage",
  "pricing.discount.approve",
  "tax.calculation.read",
  "tax.exemption.manage",
  "inventory.stock.read",
  "procurement.purchase_order.read",
  "customer.profile.read",
  "sales.order.read",
  "fulfillment.plan.read",
  "payment.read",
  "accounting.read",
  "banking.read",
  "platform.audit.read",
  "pos.sync.read",
  "localization.pack.read",
  "localization.document.read",
  "reporting.metric.read",
  "integration.connector.read",
  "saas.subscription.read",
]);

const ADMIN_MODULES = new Map<string, readonly [string, string]>([
  ["/catalog", ["Catalog", "Published product, variant, unit and barcode administration surface."]],
  ["/catalog/imports", ["Catalog imports", "Import validation and review surface. No file is accepted in read-only staging."]],
  ["/catalog/units", ["Units and conversions", "Unit and conversion governance surface."]],
  ["/pricing", ["Pricing", "Price-list and effective-date administration surface."]],
  ["/pricing/promotions", ["Promotions", "Promotion lifecycle and eligibility surface."]],
  ["/pricing/discount-approvals", ["Discount approvals", "Controlled discount approval queue."]],
  ["/tax", ["Tax", "Tax calculation configuration and country-pack boundary."]],
  ["/tax/exemptions", ["Tax exemptions", "Exemption evidence and review surface."]],
  ["/customers", ["Customers", "Customer directory and account workspace."]],
  ["/sales", ["Sales", "Quotation, order, invoice and return operations."]],
  ["/fulfillment", ["Fulfillment", "Reservation, picking, packing and delivery operations."]],
  ["/finance/payments", ["Payments", "Payment intent, capture, refund and settlement operations."]],
  ["/finance/accounting", ["Accounting", "Journal, ledger, receivable and payable controls."]],
  ["/finance/banking", ["Banking", "Statement import and reconciliation operations."]],
  ["/finance/readiness", ["Finance readiness", "Control totals, close readiness and exception evidence."]],
  ["/pos/reconciliation", ["POS reconciliation", "Register, cash and offline synchronization review."]],
  ["/localization", ["Country packs", "Locale, currency and country-pack lifecycle controls."]],
  ["/compliance", ["Compliance", "Fiscal document and regulatory evidence surface."]],
  ["/reporting", ["Reporting", "Operational metrics, reconciliation and bounded export controls."]],
  ["/integrations", ["Integrations", "Connector, webhook and partner API operations."]],
  ["/platform/saas", ["SaaS administration", "Plan, subscription, usage and support-access controls."]],
]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stagingHeaders(contentType: string): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

function htmlResponse(request: Request, html: string, status = 200): Response {
  return new Response(request.method === "HEAD" ? null : html, {
    status,
    headers: stagingHeaders("text/html; charset=utf-8"),
  });
}

function stagingNotice(
  version: string,
  session?: StagingAuthSession | null,
): string {
  const identity = session
    ? `<span style="display:block;margin-top:.2rem">Signed in as <strong>${escapeHtml(session.user.name)}</strong> · ${escapeHtml(session.user.email)}</span><form action="/auth/sign-out" method="post" style="margin-top:.55rem"><button type="submit" style="min-height:36px;border:1px solid currentColor;background:transparent;color:inherit;padding:.35rem .7rem;font:700 .85rem system-ui;cursor:pointer">Sign out</button></form>`
    : "";
  return `<section data-staging-notice role="status" style="margin:0 0 1rem;padding:.8rem 1rem;border:2px solid #8a5a00;background:#fff0c7;color:#4c3100;border-radius:.65rem"><strong>Persistent staging · synthetic data</strong><span style="display:block;margin-top:.2rem">Read-only browser milestone. Authoritative commands remain protected until controlled-write journeys are enabled.</span>${identity}<small style="display:block;margin-top:.35rem">Build ${escapeHtml(version)}</small></section>`;
}

function prefixAdminLinks(html: string): string {
  return html.replaceAll('href="/', 'href="/admin/');
}

function addAdminNotice(
  html: string,
  version: string,
  session?: StagingAuthSession | null,
): string {
  return html.replace(
    '<div class="workspace">',
    `<div class="workspace">${stagingNotice(version, session)}`,
  );
}

function adminBaseInput(
  localPath: string,
  session?: StagingAuthSession | null,
): AdminShellInput {
  return {
    displayName: session?.user.name ?? "Staging Operator",
    tenantName: "Ozzyl Demo Store",
    permissions: ADMIN_PERMISSIONS,
    currentPath: localPath,
    content: "",
    direction: "ltr",
    location: "Dhaka Demo Outlet",
    businessDate: "Non-production business date",
    locale: "en-GB",
    offline: false,
  };
}

function renderGenericAdminPage(
  localPath: string,
  version: string,
  session?: StagingAuthSession | null,
): string {
  const [title, description] = ADMIN_MODULES.get(localPath) ?? [
    "Admin staging",
    "This route is not part of the current persistent staging navigation.",
  ];
  const content = `${stagingNotice(version, session)}<section data-staging-page="admin-module"><header class="page-heading"><div><p class="fixture-notice"><strong>Synthetic fixture</strong><span>No customer or production data</span></p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div></header><section class="system-state system-state--empty" role="status"><span class="system-state__mark" aria-hidden="true">S</span><div class="system-state__copy"><strong>Browser surface is ready for review</strong><span>Navigation, responsive layout and accessibility can be tested now. Live mutations will be enabled only after repeatable seed data and controlled-write authorization are verified.</span></div></section></section>`;
  return prefixAdminLinks(
    renderAdminShell({ ...adminBaseInput(localPath, session), content }),
  );
}

function renderAdmin(
  request: Request,
  pathname: string,
  version: string,
  session?: StagingAuthSession | null,
): Response {
  const localPath = pathname.slice("/admin".length) || "/";
  const base = adminBaseInput(localPath, session);
  let html: string;
  if (localPath === "/" || localPath === "") {
    html = renderAdminFoundationPreview(base);
  } else if (localPath === "/inventory") {
    html = renderInventoryAdminPage(base);
  } else if (localPath === "/procurement") {
    html = renderProcurementAdminPage(base);
  } else {
    return htmlResponse(
      request,
      renderGenericAdminPage(localPath, version, session),
      ADMIN_MODULES.has(localPath) ? 200 : 404,
    );
  }
  return htmlResponse(
    request,
    prefixAdminLinks(addAdminNotice(html, version, session)),
  );
}

function renderPos(
  version: string,
  session?: StagingAuthSession | null,
): string {
  const register = renderRegisterWorkspace({
    locale: "en-GB",
    currency: "BDT",
    scale: 2,
    online: true,
    pendingOperations: 0,
    registerLabel: "Register 01",
    shiftStatus: "open",
    cashierName: session?.user.name ?? "Staging Cashier",
    cartReference: "STG-0001",
    lines: [
      {
        lineId: "staging-line-1",
        name: "Demo Linen Shirt",
        variant: "Natural / Medium",
        quantity: "2",
        lineTotalMinor: 250000n,
      },
      {
        lineId: "staging-line-2",
        name: "Demo Canvas Bag",
        variant: "Olive",
        quantity: "1",
        lineTotalMinor: 95000n,
      },
    ],
    subtotalMinor: 345000n,
    discountMinor: 15000n,
    taxMinor: 16500n,
    payableMinor: 346500n,
    tenders: [],
    canCheckout: false,
    checkoutBlockReason:
      "Read-only persistent staging: payment and checkout commands are intentionally disabled.",
  });
  const identity = session
    ? `<span>Signed in as ${escapeHtml(session.user.name)}</span><form action="/auth/sign-out" method="post"><button type="submit">Sign out</button></form>`
    : "";
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Persistent POS staging</title><style>html,body{max-width:100%;overflow-x:hidden}body{margin:0;background:#f5f3ec}.staging-top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 1rem;background:#14251e;color:#fff;font:600 .9rem/1.4 system-ui}.staging-top a{color:#f0d36d}.staging-top small{display:block;color:#bed0c7}.staging-top nav,.staging-top form{display:flex;align-items:center;gap:.5rem}.staging-top button{min-height:36px;border:1px solid #f0d36d;background:transparent;color:#f0d36d;padding:.3rem .65rem;font:700 .85rem system-ui;cursor:pointer}.modd-register,.modd-workspace,.modd-cart,.modd-checkout,.modd-table-wrap{min-width:0;max-width:100%}.modd-table-wrap{overflow-x:auto;overscroll-behavior-x:contain}@media(max-width:560px){.staging-top{align-items:flex-start;flex-direction:column}.staging-top nav{width:100%;flex-wrap:wrap}}</style></head><body><header class="staging-top" data-staging-notice><div><strong>Persistent staging · synthetic POS</strong><small>Build ${escapeHtml(version)} · authoritative checkout disabled</small></div><nav aria-label="Staging"><a href="/admin">Admin</a><a href="/api/health">API health</a>${identity}</nav></header>${register}</body></html>`;
}

function uiMethodAllowed(request: Request): boolean {
  return request.method === "GET" || request.method === "HEAD";
}

function authenticationRedirect(request: Request, pathname: string): Response {
  const target = new URL("/login", request.url);
  target.searchParams.set("returnTo", pathname);
  return new Response(null, {
    status: 302,
    headers: { "Cache-Control": "no-store", Location: target.toString() },
  });
}

async function delegateApi(
  request: Request,
  env: StagingEnvironment,
): Promise<Response> {
  const source = new URL(request.url);
  source.pathname = source.pathname.slice("/api".length) || "/";
  return await apiWorker.fetch(new Request(source, request), env);
}

export default {
  async fetch(request: Request, env: StagingEnvironment): Promise<Response> {
    const url = new URL(request.url);
    const version = env.STAGING_GIT_SHA?.slice(0, 12) || "local";

    const authResponse = await handleStagingAuthRequest(request, url, env);
    if (authResponse) return authResponse;

    if (url.pathname.startsWith("/api/")) {
      return await delegateApi(request, env);
    }

    if (!uiMethodAllowed(request)) {
      return new Response(null, {
        status: 405,
        headers: {
          ...stagingHeaders("text/plain; charset=utf-8"),
          Allow: "GET, HEAD",
        },
      });
    }

    if (url.pathname === "/") {
      return Response.redirect(new URL("/admin", request.url).toString(), 302);
    }
    if (url.pathname === "/staging/status") {
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({
              status: "healthy",
              service: "persistent-admin-pos-staging",
              version,
              database: "dedicated-neon-staging",
              browserMode: "synthetic-read-only",
              authentication: stagingAuthIsRequired(env)
                ? "neon-auth-required"
                : "not-required",
            }),
        {
          status: 200,
          headers: stagingHeaders("application/json; charset=utf-8"),
        },
      );
    }

    const protectedUi =
      url.pathname === "/pos" ||
      url.pathname === "/pos/" ||
      url.pathname === "/admin" ||
      url.pathname === "/admin/" ||
      url.pathname.startsWith("/admin/");
    const session = protectedUi && stagingAuthIsRequired(env)
      ? await getStagingAuthSession(request, env)
      : null;
    if (protectedUi && stagingAuthIsRequired(env) && !session) {
      return authenticationRedirect(request, `${url.pathname}${url.search}`);
    }

    if (url.pathname === "/pos" || url.pathname === "/pos/") {
      return htmlResponse(request, renderPos(version, session));
    }
    if (
      url.pathname === "/admin" ||
      url.pathname === "/admin/" ||
      url.pathname.startsWith("/admin/")
    ) {
      return renderAdmin(request, url.pathname, version, session);
    }

    return htmlResponse(
      request,
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title></head><body><main><h1>Staging route not found</h1><p><a href="/admin">Open Admin staging</a></p></main></body></html>`,
      404,
    );
  },
};
