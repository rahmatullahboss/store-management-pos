import { renderRegisterWorkspace } from "../../pos-web/src/modules/register/surface.js";
import {
  loadReleaseCandidateOperationalData,
} from "./staging-operational-release-data.js";
import {
  resolveStagingReadContext,
  type StagingReadContextEnvironment,
} from "./staging-read-context.js";

export interface StagingPosReleaseEnvironment
  extends StagingReadContextEnvironment {
  readonly STAGING_GIT_SHA?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function headers(): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

function redirect(request: Request): Response {
  const target = new URL("/login", request.url);
  target.searchParams.set("returnTo", "/pos");
  return new Response(null, {
    status: 302,
    headers: { "Cache-Control": "no-store", Location: target.toString() },
  });
}

export async function handleExactStagingPos(
  request: Request,
  env: StagingPosReleaseEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/pos" && url.pathname !== "/pos/") return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { ...headers(), Allow: "GET, HEAD" },
    });
  }
  const context = await resolveStagingReadContext(request, env);
  if (!context) return redirect(request);
  const data = await loadReleaseCandidateOperationalData(env.DATABASE_URL, context);
  const version = env.STAGING_GIT_SHA?.slice(0, 12) || "local";
  const register = renderRegisterWorkspace(data.pos);
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Store POS release candidate</title><style>html,body{max-width:100%;overflow-x:hidden}body{margin:0;background:#f5f3ec}.rc-pos-top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1rem;background:#14251e;color:#fff;font:600 .9rem/1.4 system-ui}.rc-pos-top strong,.rc-pos-top small{display:block}.rc-pos-top small{color:#bed0c7}.rc-pos-top nav,.rc-pos-top form{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}.rc-pos-top a{color:#f0d36d}.rc-pos-top button{min-height:38px;border:1px solid #f0d36d;background:transparent;color:#f0d36d;padding:.35rem .7rem;font:800 .85rem system-ui;cursor:pointer}.modd-register,.modd-workspace,.modd-cart,.modd-checkout,.modd-table-wrap{min-width:0;max-width:100%}.modd-table-wrap{overflow-x:auto;overscroll-behavior-x:contain}@media(max-width:600px){.rc-pos-top{align-items:flex-start;flex-direction:column}.rc-pos-top nav{width:100%}}</style></head><body><header class="rc-pos-top" data-staging-notice><div><strong>Persistent staging · synthetic POS · exact database-backed totals</strong><small>${data.catalog.length} active variants · ${escapeHtml(data.dashboard.availableUnits)} available · build ${escapeHtml(version)}</small></div><nav aria-label="Release candidate navigation"><a href="/admin">Admin dashboard</a><a href="/admin/catalog">Catalog</a><a href="/api/health">API health</a><span>${escapeHtml(data.context.user.name)}</span><form action="/auth/sign-out" method="post"><button type="submit">Sign out</button></form></nav></header>${register}</body></html>`;
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: headers(),
  });
}
