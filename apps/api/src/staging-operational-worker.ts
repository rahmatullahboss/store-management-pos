import {
  renderAdminShell,
  renderCustomerAdminPage,
  renderInventoryAdminPage,
  renderProcurementAdminPage,
  renderSalesAdminPage,
  type AdminShellInput,
} from "../../admin-web/src/app-shell/index.js";
import { renderRegisterWorkspace } from "../../pos-web/src/modules/register/surface.js";
import type { StagingOperationalData } from "./staging-operational-data.js";
import { loadReleaseCandidateOperationalData } from "./staging-operational-release-data.js";
import {
  resolveStagingReadContext,
  type StagingReadContextEnvironment,
} from "./staging-read-context.js";
import {
  renderStagingCatalog,
  renderStagingDashboard,
} from "./staging-operational-ui.js";

export interface OperationalStagingEnvironment
  extends StagingReadContextEnvironment {
  readonly STAGING_GIT_SHA?: string;
  readonly STAGING_AUTH_REQUIRED?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function headers(contentType: string): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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
    headers: headers("text/html; charset=utf-8"),
  });
}

function authenticationRedirect(request: Request): Response {
  const url = new URL(request.url);
  const target = new URL("/login", request.url);
  target.searchParams.set("returnTo", `${url.pathname}${url.search}`);
  return new Response(null, {
    status: 302,
    headers: { "Cache-Control": "no-store", Location: target.toString() },
  });
}

function releaseNotice(data: StagingOperationalData, version: string): string {
  return `<section data-staging-notice role="status" style="margin:0 0 1rem;padding:.85rem 1rem;background:#fff0c7;color:#4c3100;border-radius:14px"><strong>Persistent staging · usable release candidate · synthetic data</strong><span style="display:block;margin-top:.25rem">Signed in as <strong>${escapeHtml(data.context.user.name)}</strong> · ${escapeHtml(data.context.role)} · ${data.context.permissions.length} database-resolved read permissions</span><span style="display:block;margin-top:.2rem">Operational reads are live. Checkout, payment, stock, order, accounting and banking commands remain disabled.</span><form action="/auth/sign-out" method="post" style="margin-top:.6rem"><button type="submit" style="min-height:40px;border:1px solid currentColor;background:transparent;color:inherit;padding:.4rem .75rem;font:800 .86rem system-ui;cursor:pointer">Sign out</button></form><small style="display:block;margin-top:.4rem">Build ${escapeHtml(version)}</small></section>`;
}

function addNotice(html: string, notice: string): string {
  return html.replace('<div class="workspace">', `<div class="workspace">${notice}`);
}

function prefixAdminLinks(html: string): string {
  return html
    .replaceAll('href="/', 'href="/admin/')
    .replaceAll('href="/admin/auth/context"', 'href="/auth/context"')
    .replaceAll('href="/admin/api/health"', 'href="/api/health"')
    .replaceAll('href="/admin/admin/', 'href="/admin/');
}

function adminInput(
  localPath: string,
  data: StagingOperationalData,
): AdminShellInput {
  return {
    displayName: data.context.user.name,
    tenantName: data.context.tenant.name,
    permissions: new Set(data.context.permissions),
    currentPath: localPath,
    content: "",
    direction: "ltr",
    location: "Synthetic Dhaka Store",
    businessDate: "Release candidate · 30 Jul 2026",
    locale: "en-GB",
    offline: false,
  };
}

function genericPage(localPath: string): string {
  const label = localPath
    .split("/")
    .filter(Boolean)
    .map((item) => item.replaceAll("-", " "))
    .join(" / ") || "Operations";
  return `<style>.rc-next{padding:clamp(1rem,2.4vw,2rem);background:#f5f3ec;color:#17231e}.rc-next h1{max-width:16ch;margin:0;font-size:clamp(2rem,4vw,3.7rem);line-height:1;letter-spacing:-.035em;text-wrap:balance}.rc-next p{max-width:72ch;line-height:1.6;color:#405049}.rc-next__flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:1.4rem;background:#fffefa;border-radius:14px;box-shadow:0 10px 24px rgba(23,35,30,.08);overflow:hidden}.rc-next__flow div{padding:1rem 1.1rem;border-inline-end:1px solid #d7ddd8}.rc-next__flow div:last-child{border:0}.rc-next__flow strong,.rc-next__flow span{display:block}.rc-next__flow span{margin-top:.3rem;color:#59675f}@media(max-width:720px){.rc-next__flow{grid-template-columns:1fr}.rc-next__flow div{border-inline-end:0;border-bottom:1px solid #d7ddd8}}</style><section class="rc-next" data-staging-page="connected-next"><h1>${escapeHtml(label)} is the next connected workflow.</h1><p>The module schema and navigation are present, but this page is intentionally not pretending that command processing is production-ready. Read journeys for dashboard, catalog, inventory, procurement, customers and sales are connected now.</p><div class="rc-next__flow"><div><strong>Current evidence</strong><span>Authenticated tenant and scoped permissions are database-resolved.</span></div><div><strong>Next gate</strong><span>Connect authoritative read APIs and prove cross-tenant failure.</span></div><div><strong>Command boundary</strong><span>Mutations stay disabled until idempotency, audit, outbox and reversal evidence pass.</span></div></div></section>`;
}

function adminHtml(
  pathname: string,
  data: StagingOperationalData,
  version: string,
): { readonly html: string; readonly status: number } {
  const localPath = pathname.slice("/admin".length) || "/";
  const base = adminInput(localPath, data);
  let html: string;
  let status = 200;
  if (localPath === "/" || localPath === "") {
    html = renderAdminShell({
      ...base,
      currentPath: "/",
      content: renderStagingDashboard(data.dashboard),
    });
  } else if (localPath === "/catalog") {
    html = renderAdminShell({
      ...base,
      currentPath: "/catalog",
      content: renderStagingCatalog(data.catalog),
    });
  } else if (localPath === "/inventory") {
    html = renderInventoryAdminPage(base, data.inventory);
  } else if (localPath === "/procurement") {
    html = renderProcurementAdminPage(base, data.procurement);
  } else if (localPath === "/customers") {
    html = renderCustomerAdminPage(base, data.customers);
  } else if (localPath === "/sales") {
    html = renderSalesAdminPage(base, data.sales);
  } else {
    html = renderAdminShell({ ...base, content: genericPage(localPath) });
    status = 200;
  }
  return {
    html: prefixAdminLinks(addNotice(html, releaseNotice(data, version))),
    status,
  };
}

function posHtml(data: StagingOperationalData, version: string): string {
  const register = renderRegisterWorkspace(data.pos);
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Store POS release candidate</title><style>html,body{max-width:100%;overflow-x:hidden}body{margin:0;background:#f5f3ec}.rc-pos-top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1rem;background:#14251e;color:#fff;font:600 .9rem/1.4 system-ui}.rc-pos-top strong,.rc-pos-top small{display:block}.rc-pos-top small{color:#bed0c7}.rc-pos-top nav,.rc-pos-top form{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}.rc-pos-top a{color:#f0d36d}.rc-pos-top button{min-height:38px;border:1px solid #f0d36d;background:transparent;color:#f0d36d;padding:.35rem .7rem;font:800 .85rem system-ui;cursor:pointer}.modd-register,.modd-workspace,.modd-cart,.modd-checkout,.modd-table-wrap{min-width:0;max-width:100%}.modd-table-wrap{overflow-x:auto;overscroll-behavior-x:contain}@media(max-width:600px){.rc-pos-top{align-items:flex-start;flex-direction:column}.rc-pos-top nav{width:100%}}</style></head><body><header class="rc-pos-top" data-staging-notice><div><strong>Persistent staging · synthetic POS · database-backed release candidate</strong><small>${escapeHtml(data.catalog.length.toString())} active variants · ${escapeHtml(data.dashboard.availableUnits)} available · build ${escapeHtml(version)}</small></div><nav aria-label="Release candidate navigation"><a href="/admin">Admin dashboard</a><a href="/admin/catalog">Catalog</a><a href="/api/health">API health</a><span>Signed in as ${escapeHtml(data.context.user.name)}</span><form action="/auth/sign-out" method="post"><button type="submit">Sign out</button></form></nav></header>${register}</body></html>`;
}

export async function handleOperationalStagingRequest(
  request: Request,
  env: OperationalStagingEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  const admin = url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname.startsWith("/admin/");
  const pos = url.pathname === "/pos" || url.pathname === "/pos/";
  if (!admin && !pos) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { ...headers("text/plain; charset=utf-8"), Allow: "GET, HEAD" },
    });
  }
  const context = await resolveStagingReadContext(request, env);
  if (!context) return authenticationRedirect(request);
  const data = await loadReleaseCandidateOperationalData(env.DATABASE_URL, context);
  const version = env.STAGING_GIT_SHA?.slice(0, 12) || "local";
  if (pos) return htmlResponse(request, posHtml(data, version));
  const rendered = adminHtml(url.pathname, data, version);
  return htmlResponse(request, rendered.html, rendered.status);
}
