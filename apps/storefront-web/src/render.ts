import type { StorefrontBootstrapV1 } from "../../../packages/storefront-contracts/src/index.js";
import type {
  StorefrontNavigationItemV1,
  StorefrontPublicContentBundleV1,
} from "../../../packages/storefront-contracts/src/public-content.js";
import {
  buildStorefrontThemeTokensV1,
  DEFAULT_STOREFRONT_THEME_V1,
} from "../../../packages/storefront-theme/src/index.js";
import { createStorefrontPublicCacheScope } from "./cache-scope.js";

export interface StorefrontShellRenderOptions {
  readonly buildId: string;
  readonly content?: StorefrontPublicContentBundleV1;
  readonly theme?: unknown;
  readonly headOnly?: boolean;
}

const RTL_LANGUAGES = new Set(["ar", "dv", "fa", "he", "ku", "ps", "ur"]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function localeDirection(locale: string): "ltr" | "rtl" {
  const language = locale.toLowerCase().split(/[-_]/, 1)[0] ?? "en";
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}

function canonicalUrl(request: Request, hostname: string): string {
  const source = new URL(request.url);
  const target = new URL(`https://${hostname}`);
  target.pathname = source.pathname;
  target.search = source.search;
  return target.toString();
}

function themeStyle(value: unknown): string {
  const tokens = buildStorefrontThemeTokensV1(
    value ?? DEFAULT_STOREFRONT_THEME_V1,
  );
  return Object.entries(tokens)
    .map(([key, token]) => `${key}:${token}`)
    .join(";");
}

async function cacheEtag(scope: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scope),
  );
  const prefix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `W/\"${prefix}\"`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function blocks(document: Readonly<Record<string, unknown>>): readonly unknown[] {
  return Array.isArray(document.blocks) ? document.blocks : [];
}

function renderNavigationItems(
  items: readonly StorefrontNavigationItemV1[],
): string {
  return items.map((item) => {
    const children = item.children.length === 0
      ? ""
      : `<ul>${renderNavigationItems(item.children)}</ul>`;
    return `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>${children}</li>`;
  }).join("");
}

function renderPrimaryNavigation(
  content: StorefrontPublicContentBundleV1 | undefined,
): string {
  const items = content?.navigation.header?.items ?? [];
  if (items.length === 0) {
    return '<ul><li><a href="/">Home</a></li><li><a href="/search">Browse</a></li><li><a href="/cart">Cart</a></li></ul>';
  }
  return `<ul>${renderNavigationItems(items)}</ul>`;
}

function renderFooterNavigation(
  content: StorefrontPublicContentBundleV1 | undefined,
): string {
  const items = content?.navigation.footer?.items ?? [];
  return items.length === 0
    ? ""
    : `<nav aria-label="Footer navigation"><ul>${renderNavigationItems(items)}</ul></nav>`;
}

function renderContentBlocks(
  document: Readonly<Record<string, unknown>>,
  headingId: string,
): string {
  const rendered = blocks(document).map((entry, index) => {
    const block = asRecord(entry);
    if (!block) return "";
    const type = text(block.type).toLowerCase();
    if (type === "hero") {
      const eyebrow = text(block.eyebrow);
      const title = text(block.title, "Welcome");
      const body = text(block.body, text(block.value));
      return `<section class="hero" aria-labelledby="${headingId}-${index}">${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""}<h1 id="${headingId}-${index}">${escapeHtml(title)}</h1>${body ? `<p>${escapeHtml(body)}</p>` : ""}</section>`;
    }
    if (type === "text") {
      const title = text(block.title, text(block.heading));
      const value = text(block.value, text(block.body));
      if (!title && !value) return "";
      return `<section class="content-block"${title ? ` aria-labelledby="${headingId}-${index}"` : ""}>${title ? `<h2 id="${headingId}-${index}">${escapeHtml(title)}</h2>` : ""}${value ? `<p>${escapeHtml(value)}</p>` : ""}</section>`;
    }
    return "";
  }).filter(Boolean).join("");
  return rendered;
}

function renderHomepage(
  hostname: string,
  content: StorefrontPublicContentBundleV1 | undefined,
): string {
  const rendered = content ? renderContentBlocks(content.homepage, "homepage-block") : "";
  if (rendered) return rendered;
  return `<section class="hero" aria-labelledby="storefront-heading"><p class="eyebrow">Online storefront</p><h1 id="storefront-heading">Shop from ${escapeHtml(hostname)}</h1><p>Published products and collections will appear here as the merchant completes storefront setup.</p><form class="search" action="/search" method="get" role="search"><label for="storefront-search">Search products</label><input id="storefront-search" name="q" type="search" autocomplete="off" placeholder="Search products"><button type="submit">Search</button></form></section><section class="status-card" aria-labelledby="publication-status-heading"><h2 id="publication-status-heading">Storefront channel ready</h2><p>The public catalog remains empty until products are explicitly published to this sales channel.</p></section>`;
}

function renderPage(content: StorefrontPublicContentBundleV1): string {
  const page = content.page;
  if (!page) return "";
  const rendered = renderContentBlocks(page.content, "content-block");
  return `<article class="content-page" aria-labelledby="content-page-title"><header><p class="eyebrow">Information</p><h1 id="content-page-title">${escapeHtml(page.title)}</h1></header>${rendered || '<p>Published content is available for this page.</p>'}</article>`;
}

function seoText(
  value: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
): string {
  const candidate = text(value[key]);
  return candidate ? candidate.slice(0, key === "title" ? 240 : 500) : fallback;
}

function renderDocument(
  request: Request,
  bootstrap: StorefrontBootstrapV1,
  content: StorefrontPublicContentBundleV1 | undefined,
  theme: unknown,
): string {
  const context = bootstrap.context;
  const locale = escapeHtml(context.locale);
  const direction = localeDirection(context.locale);
  const hostname = context.canonicalHostname;
  const canonical = escapeHtml(canonicalUrl(request, hostname));
  const style = escapeHtml(themeStyle(theme));
  const page = content?.page;
  const seo = page?.seo ?? content?.homepageSeo ?? {};
  const title = escapeHtml(seoText(seo, "title", page?.title ?? hostname));
  const description = escapeHtml(seoText(seo, "description", `Published storefront content for ${hostname}.`));
  const main = page && new URL(request.url).pathname.startsWith("/pages/")
    ? renderPage(content)
    : renderHomepage(hostname, content);

  return `<!doctype html>
<html lang="${locale}" dir="${direction}" style="${style}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="robots" content="noindex,follow">
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <title>${title}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    html{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--storefront-background);color:var(--storefront-foreground)}
    body{margin:0;min-height:100vh;background:linear-gradient(180deg,var(--storefront-surface-muted),var(--storefront-background) 28rem);font-size:calc(1rem * var(--storefront-density));line-height:1.5}
    a{color:inherit}.skip-link{position:absolute;inset-inline-start:1rem;top:-5rem;padding:.75rem 1rem;background:var(--storefront-foreground);color:var(--storefront-background);border-radius:var(--storefront-radius);z-index:10}.skip-link:focus{top:1rem;outline:3px solid var(--storefront-focus);outline-offset:3px}
    .container{width:min(calc(100% - 2rem),var(--storefront-container));margin-inline:auto}
    header{border-bottom:1px solid var(--storefront-border);background:color-mix(in srgb,var(--storefront-surface) 92%,transparent);backdrop-filter:blur(12px)}
    .header-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:4.5rem}.brand{font-weight:750;text-decoration:none;letter-spacing:-.02em}.nav ul,footer ul{display:flex;gap:1rem;align-items:center;list-style:none;margin:0;padding:0}.nav li{position:relative}.nav li ul{display:none}.nav a,footer a{padding:.5rem;border-radius:var(--storefront-radius)}.nav a:focus-visible,footer a:focus-visible,.search input:focus-visible,.search button:focus-visible{outline:3px solid var(--storefront-focus);outline-offset:3px}
    main{padding-block:clamp(3rem,8vw,7rem)}.hero{display:grid;gap:1.5rem;max-width:48rem}.eyebrow{margin:0;color:var(--storefront-primary);font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:.78rem}.hero h1,.content-page h1{margin:0;font-size:clamp(2.4rem,8vw,5.5rem);line-height:.98;letter-spacing:-.055em}.hero p,.content-block p,.content-page>p{margin:0;max-width:48rem;color:color-mix(in srgb,var(--storefront-foreground) 72%,transparent);font-size:clamp(1.05rem,2vw,1.25rem)}
    .content-page{display:grid;gap:2rem}.content-page>header{display:grid;gap:1rem;border:0;background:none;backdrop-filter:none}.content-block{display:grid;gap:.65rem;max-width:48rem}.content-block h2{margin:0;font-size:clamp(1.4rem,3vw,2rem)}
    .search{display:flex;gap:.65rem;max-width:38rem;margin-top:.75rem}.search label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.search input{min-width:0;flex:1;padding:.85rem 1rem;border:1px solid var(--storefront-border);border-radius:var(--storefront-radius);background:var(--storefront-surface);color:var(--storefront-foreground);font:inherit}.search button{border:0;border-radius:var(--storefront-radius);padding:.85rem 1.15rem;background:var(--storefront-primary);color:var(--storefront-primary-foreground);font:inherit;font-weight:700;cursor:pointer}
    .status-card{margin-top:clamp(3rem,7vw,6rem);padding:clamp(1.25rem,3vw,2rem);border:1px solid var(--storefront-border);border-radius:calc(var(--storefront-radius) * 1.4);background:var(--storefront-surface);box-shadow:0 1.5rem 4rem color-mix(in srgb,var(--storefront-foreground) 8%,transparent)}.status-card h2{margin:0 0 .5rem;font-size:1.2rem}.status-card p{margin:0;color:color-mix(in srgb,var(--storefront-foreground) 68%,transparent)}
    footer{padding-block:2rem;border-top:1px solid var(--storefront-border);color:color-mix(in srgb,var(--storefront-foreground) 62%,transparent)}footer .container{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}
    @media (max-width:40rem){.header-row{align-items:flex-start;flex-direction:column;padding-block:1rem}.nav,.nav ul{width:100%}.nav ul{justify-content:space-between;overflow:auto}.search{flex-direction:column}.search button{width:100%}footer .container{display:grid}footer ul{flex-wrap:wrap}}
    @media (prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header><div class="container header-row"><a class="brand" href="/" aria-label="Storefront home">${escapeHtml(hostname)}</a><nav class="nav" aria-label="Primary navigation">${renderPrimaryNavigation(content)}</nav></div></header>
  <main id="main-content" class="container" tabindex="-1">${main}</main>
  <footer><div class="container"><span>Secure storefront commerce powered by the merchant's operational platform.</span>${renderFooterNavigation(content)}</div></footer>
</body>
</html>`;
}

export async function storefrontShellResponse(
  request: Request,
  bootstrap: StorefrontBootstrapV1,
  options: StorefrontShellRenderOptions,
): Promise<Response> {
  const cacheScope = createStorefrontPublicCacheScope(
    bootstrap.context,
    options.buildId,
  );
  const headers = new Headers({
    "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    "Content-Language": bootstrap.context.locale,
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    Vary: "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  headers.set("ETag", await cacheEtag(cacheScope));

  const body = options.headOnly
    ? null
    : renderDocument(
        request,
        bootstrap,
        options.content,
        options.theme ?? options.content?.theme,
      );
  return new Response(body, { status: 200, headers });
}
