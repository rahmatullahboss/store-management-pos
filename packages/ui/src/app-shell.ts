export interface AppRoute {
  readonly path: string;
  readonly label: string;
  readonly permission?: string;
  readonly icon?: string;
  readonly offlineAvailable?: boolean;
}

export interface ShellIdentity {
  readonly displayName: string;
  readonly tenantName: string;
  readonly permissions: ReadonlySet<string>;
}

export interface ShellContext {
  readonly workspace?: string;
  readonly location?: string;
  readonly businessDate?: string;
  readonly locale?: string;
}

export function canAccessRoute(route: AppRoute, permissions: ReadonlySet<string>): boolean {
  return route.permission === undefined || permissions.has(route.permission);
}

export function permittedRoutes(routes: readonly AppRoute[], permissions: ReadonlySet<string>): readonly AppRoute[] {
  return routes.filter((route) => canAccessRoute(route, permissions));
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function routeMark(route: AppRoute): string {
  const mark = route.icon ?? route.label.trim().slice(0, 1).toUpperCase();
  return `<span class="nav-mark" aria-hidden="true">${escapeHtml(mark)}</span>`;
}

const shellStyles = `<style>
:root{color-scheme:light;--ink:#17231e;--ink-soft:#405049;--muted:#68766f;--paper:#f5f3ec;--surface:#fffefa;--surface-raised:#ffffff;--rail:#14251e;--rail-soft:#20372d;--line:#d7ddd8;--line-strong:#aab6af;--accent:#1f6a51;--accent-strong:#15523d;--accent-soft:#dcece5;--attention:#8a5a00;--attention-soft:#fff0c7;--danger:#9b2c2c;--danger-soft:#fbe1df;--success:#1f6a51;--shadow:0 12px 30px rgba(23,35,30,.09);--radius:14px;--radius-small:9px;--focus:#e09a13;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-synthesis:none}
*{box-sizing:border-box}
html{background:var(--paper);color:var(--ink);font-size:16px}
body{margin:0;min-width:320px;background:var(--paper);line-height:1.45}
button,input{font:inherit}
button{color:inherit}
a{color:inherit}
.skip-link{position:fixed;inset-block-start:.75rem;inset-inline-start:.75rem;z-index:100;transform:translateY(-180%);background:var(--surface);border:2px solid var(--focus);border-radius:var(--radius-small);padding:.7rem 1rem;font-weight:750;box-shadow:var(--shadow)}
.skip-link:focus{transform:translateY(0)}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.app-shell{min-height:100vh;display:grid;grid-template-columns:16.5rem minmax(0,1fr);grid-template-rows:auto 1fr;grid-template-areas:"rail top" "rail main"}
.shell-rail{grid-area:rail;position:sticky;inset-block-start:0;height:100vh;display:flex;flex-direction:column;background:var(--rail);color:#f5faf7;padding:1.25rem 1rem;overflow:auto}
.product-lockup{display:flex;align-items:center;gap:.75rem;padding:.25rem .5rem 1.35rem;border-bottom:1px solid rgba(255,255,255,.14)}
.product-lockup__mark{display:grid;place-items:center;width:2.25rem;height:2.25rem;border-radius:10px;background:#f0d36d;color:#1b2a23;font-weight:900;letter-spacing:-.03em}
.product-lockup strong{display:block;font-size:.95rem;line-height:1.2}
.product-lockup span{display:block;margin-top:.18rem;color:#b8c9c0;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}
.primary-nav{margin-top:1.3rem}
.primary-nav ul{list-style:none;margin:0;padding:0;display:grid;gap:.32rem}
.primary-nav a{display:flex;align-items:center;gap:.75rem;min-height:2.75rem;padding:.55rem .65rem;border-radius:10px;color:#cad7d0;text-decoration:none;font-weight:650;font-size:.9rem}
.primary-nav a:hover{background:rgba(255,255,255,.08);color:#fff}
.primary-nav a[aria-current="page"]{background:#f5f3ec;color:#17231e;box-shadow:0 6px 18px rgba(0,0,0,.16)}
.nav-mark{display:grid;place-items:center;flex:0 0 1.75rem;height:1.75rem;border-radius:7px;background:rgba(255,255,255,.1);font-size:.72rem;font-weight:850}
.primary-nav a[aria-current="page"] .nav-mark{background:var(--accent-soft);color:var(--accent-strong)}
.rail-footer{margin-top:auto;padding:1.1rem .5rem .35rem;color:#aebfb6;font-size:.76rem}
.rail-footer strong{display:block;color:#f5faf7;font-size:.78rem;margin-bottom:.15rem}
.shell-topbar{grid-area:top;display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:4.65rem;padding:.8rem clamp(1rem,3vw,2.25rem);background:rgba(245,243,236,.96);border-bottom:1px solid var(--line);position:sticky;inset-block-start:0;z-index:20;backdrop-filter:blur(14px)}
.context-trail{display:flex;align-items:center;gap:.65rem;min-width:0}
.context-trail__tenant{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.context-trail__separator{color:var(--line-strong)}
.context-trail__location{color:var(--ink-soft);font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-cluster{display:flex;align-items:center;gap:.8rem}
.user-cluster__copy{text-align:end;line-height:1.2}
.user-cluster__copy strong{display:block;font-size:.86rem}
.user-cluster__copy span{display:block;margin-top:.2rem;color:var(--muted);font-size:.72rem}
.user-avatar{display:grid;place-items:center;width:2.25rem;height:2.25rem;border:1px solid var(--line-strong);border-radius:50%;background:var(--surface);font-weight:850;color:var(--accent-strong)}
.offline-banner{grid-column:1/-1;display:flex;justify-content:center;gap:.6rem;padding:.48rem 1rem;background:var(--attention-soft);color:#5c3b00;border-bottom:1px solid #e7c86d;font-size:.82rem;font-weight:700}
.shell-main{grid-area:main;min-width:0;padding:clamp(1.25rem,3vw,2.4rem)}
.workspace{max-width:92rem;margin:0 auto}
.fixture-notice{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;width:max-content;max-width:100%;margin-bottom:1.2rem;padding:.42rem .65rem;border:1px dashed var(--line-strong);border-radius:8px;background:rgba(255,255,255,.55);color:var(--muted);font-size:.76rem}
.fixture-notice strong{color:var(--ink)}
.page-heading,.pos-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:2rem;margin-bottom:1.7rem}
.page-heading h1,.pos-heading h1{max-width:18ch;margin:0;color:var(--ink);font-size:clamp(2rem,4vw,3.55rem);line-height:1.02;letter-spacing:-.035em;text-wrap:balance}
.page-heading p,.pos-heading p{max-width:68ch;margin:.7rem 0 0;color:var(--ink-soft);font-size:1rem}
.page-actions{display:flex;gap:.65rem;flex-wrap:wrap;justify-content:flex-end}
.button{display:inline-flex;align-items:center;justify-content:center;gap:.65rem;min-height:2.75rem;padding:.64rem .95rem;border-radius:10px;border:1px solid transparent;font-weight:780;cursor:pointer;transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease,transform 150ms ease}
.button:hover{transform:translateY(-1px)}
.button:active{transform:translateY(0)}
.button:disabled{opacity:.55;cursor:not-allowed;transform:none}
.button--primary{background:var(--accent);color:#fff}
.button--primary:hover{background:var(--accent-strong)}
.button--secondary{background:var(--surface);border-color:var(--line-strong)}
.button--secondary:hover{background:#eef1ed;border-color:#84938b}
.button--full{width:100%}
.button--pay{min-height:3.25rem;background:var(--accent);color:#fff;justify-content:space-between;padding-inline:1.1rem}
.button--pay:hover{background:var(--accent-strong)}
kbd{display:inline-flex;align-items:center;justify-content:center;min-width:1.65rem;padding:.12rem .35rem;border:1px solid currentColor;border-bottom-width:2px;border-radius:5px;font-family:inherit;font-size:.68rem;font-weight:800;line-height:1.2;opacity:.75}
.signal-band{display:grid;grid-template-columns:minmax(16rem,1.35fr) minmax(22rem,1fr);gap:1rem;margin-bottom:1.6rem;padding:1.15rem 1.25rem;background:var(--rail);color:#edf6f1;border-radius:var(--radius);box-shadow:0 14px 32px rgba(20,37,30,.18)}
.signal-band__primary{display:grid;align-content:center;gap:.22rem}
.signal-band__primary strong{font-size:1.2rem}
.signal-band__primary>span:last-child{color:#bed0c7;font-size:.82rem}
.signal-band__label{color:#f0d36d;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.signal-band__facts{display:grid;grid-template-columns:repeat(3,1fr);margin:0;border-inline-start:1px solid rgba(255,255,255,.18)}
.signal-band__facts div{padding:.2rem 1rem;border-inline-end:1px solid rgba(255,255,255,.12)}
.signal-band__facts div:last-child{border:0}
.signal-band__facts dt{color:#bed0c7;font-size:.72rem}
.signal-band__facts dd{margin:.2rem 0 0;font-size:1.45rem;font-weight:850;letter-spacing:-.02em}
.operations-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(18rem,.7fr);gap:1.2rem;align-items:start}
.work-queue,.trace-panel,.foundation-states,.product-workspace,.cart-panel{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow)}
.work-queue{overflow:hidden}
.trace-panel{padding:1.15rem}
.section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1.2rem 1.25rem;border-bottom:1px solid var(--line)}
.section-heading--compact{padding:0 0 1rem}
.section-heading h2,.cart-panel h2{margin:0;font-size:1rem;letter-spacing:-.012em}
.section-heading p,.cart-panel p{margin:.25rem 0 0;color:var(--muted);font-size:.78rem}
.text-action,.row-action{border:0;background:transparent;color:var(--accent-strong);font-weight:800;cursor:pointer}
.text-action:hover,.row-action:hover{text-decoration:underline;text-underline-offset:3px}
.table-wrap{overflow:auto}
table{width:100%;border-collapse:collapse;font-size:.84rem}
th,td{padding:.9rem 1.1rem;text-align:start;border-bottom:1px solid var(--line);vertical-align:middle}
th{background:#f1f2ed;color:var(--muted);font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
tbody tr:hover{background:#f7f8f4}
tbody tr:last-child td{border-bottom:0}
td strong{display:block}
.cell-detail{display:block;color:var(--muted);font-size:.72rem;margin-top:.16rem;font-variant-numeric:tabular-nums}
.status-chip{display:inline-flex;align-items:center;gap:.4rem;width:max-content;max-width:100%;padding:.3rem .52rem;border-radius:999px;font-size:.7rem;font-weight:780;white-space:nowrap}
.status-chip__dot{width:.42rem;height:.42rem;border-radius:50%;background:currentColor}
.status-chip--success{background:var(--accent-soft);color:var(--success)}
.status-chip--warning{background:var(--attention-soft);color:var(--attention)}
.status-chip--danger{background:var(--danger-soft);color:var(--danger)}
.status-chip--neutral{background:#e9ece9;color:var(--ink-soft)}
.trace-form{display:grid;gap:.42rem;margin:.15rem 0 1rem}
.trace-form label{font-size:.76rem;font-weight:750}
.input-action{display:grid;grid-template-columns:1fr auto}
.input-action input,.scan-input input{min-width:0;border:1px solid var(--line-strong);background:#fff;color:var(--ink)}
.input-action input{border-radius:9px 0 0 9px;padding:.68rem .72rem}
.input-action button{border:0;border-radius:0 9px 9px 0;background:var(--rail);color:#fff;padding:.6rem .8rem;font-weight:780}
.provenance-chain{list-style:none;margin:0 0 1rem;padding:0;counter-reset:trace}
.provenance-chain li{position:relative;padding:.2rem 0 1rem 1.35rem;border-inline-start:1px solid var(--line-strong)}
.provenance-chain li:last-child{border-inline-start-color:transparent;padding-bottom:.2rem}
.provenance-chain li::before{content:"";position:absolute;inset-inline-start:-.29rem;inset-block-start:.35rem;width:.5rem;height:.5rem;border:2px solid var(--accent);border-radius:50%;background:var(--surface)}
.provenance-chain strong,.provenance-chain span{display:block}
.provenance-chain>li>span:last-child{color:var(--muted);font-size:.75rem;margin-top:.1rem}
.provenance-chain__step{color:var(--accent-strong);font-size:.67rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
.foundation-states{margin-top:1.2rem;overflow:hidden}
.state-list{display:grid}
.state-list article{display:flex;align-items:center;justify-content:space-between;gap:1.25rem;padding:1rem 1.25rem;border-bottom:1px solid var(--line)}
.state-list article:last-child{border-bottom:0}
.state-list p{margin:.2rem 0 0;color:var(--muted);font-size:.78rem}
.pos-heading{align-items:center}
.pos-heading h1{font-size:clamp(2rem,3.6vw,3rem)}
.pos-heading__state{display:flex;align-items:center;gap:.48rem;flex-wrap:wrap;color:var(--muted);font-size:.75rem}
.checkout-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(22rem,.8fr);gap:1rem;min-height:calc(100vh - 12rem)}
.product-workspace,.cart-panel{overflow:hidden}
.scan-panel{padding:1.15rem;border-bottom:1px solid var(--line);background:#f0f2ed}
.scan-panel label{display:block;margin-bottom:.45rem;font-size:.78rem;font-weight:800}
.scan-input{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.6rem;padding:.15rem .7rem;border:2px solid var(--rail);border-radius:11px;background:#fff}
.scan-input>span{font-size:1.35rem;color:var(--accent)}
.scan-input input{height:2.65rem;border:0;outline:0;font-size:1rem}
.filter-row{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.75rem}
.filter-chip{min-height:2rem;padding:.35rem .65rem;border:1px solid var(--line-strong);border-radius:999px;background:transparent;font-size:.74rem;font-weight:750;cursor:pointer}
.filter-chip:hover{background:#fff}
.filter-chip--active{border-color:var(--rail);background:var(--rail);color:#fff}
.product-results{padding:.3rem .65rem .75rem}
.product-row{display:grid;grid-template-columns:6rem minmax(10rem,1fr) 6rem auto;gap:.8rem;align-items:center;width:100%;padding:.82rem .55rem;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:start;cursor:pointer}
.product-row:hover{background:#f3f6f2}
.product-row__code{color:var(--muted);font-size:.7rem;font-variant-numeric:tabular-nums}
.product-row__name{font-weight:760}
.product-row__stock{color:var(--muted);font-size:.75rem}
.product-row strong{font-variant-numeric:tabular-nums;white-space:nowrap}
.empty-inline{display:flex;align-items:center;gap:.65rem;margin:.8rem .2rem 0;padding:.7rem .75rem;background:#f1f2ed;border-radius:9px;color:var(--muted);font-size:.75rem}
.cart-panel{display:flex;flex-direction:column;min-height:100%}
.cart-panel__header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1rem 1.1rem;border-bottom:1px solid var(--line)}
.cart-lines{list-style:none;margin:0;padding:0 1.1rem}
.cart-lines li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.85rem;align-items:center;padding:1rem 0;border-bottom:1px solid var(--line)}
.cart-lines li>div:first-child strong,.cart-lines li>div:first-child span{display:block}
.cart-lines li>div:first-child span{margin-top:.18rem;color:var(--muted);font-size:.72rem}
.cart-lines li>strong{font-size:.82rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.quantity-control{display:grid;grid-template-columns:1.75rem 1.8rem 1.75rem;align-items:center;border:1px solid var(--line-strong);border-radius:8px;overflow:hidden}
.quantity-control button{height:1.9rem;border:0;background:#f0f2ed;cursor:pointer;font-weight:850}
.quantity-control output{text-align:center;font-size:.78rem;font-weight:800}
.cart-note{display:flex;justify-content:space-between;margin:.8rem 1.1rem 0;padding:.65rem .75rem;border:1px dashed var(--line-strong);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;text-align:start}
.cart-note:hover{background:#f5f6f2;color:var(--ink)}
.sale-totals{display:grid;gap:.55rem;margin:auto 1.1rem 0;padding:1.2rem 0 .9rem}
.sale-totals div{display:flex;justify-content:space-between;gap:1rem;color:var(--muted);font-size:.82rem}
.sale-totals dd{margin:0;font-variant-numeric:tabular-nums}
.sale-totals__total{align-items:baseline;padding-top:.7rem;border-top:1px solid var(--line);color:var(--ink)!important;font-size:1rem!important;font-weight:850}
.sale-totals__total dd{font-size:1.55rem;letter-spacing:-.025em}
.checkout-actions{display:grid;grid-template-columns:auto 1fr;gap:.65rem;padding:0 1.1rem 1rem}
.cart-assurance{display:flex;align-items:center;gap:.45rem!important;margin:0!important;padding:.72rem 1.1rem;background:var(--accent-soft);color:var(--accent-strong)!important;font-size:.72rem!important}
.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
@media (max-width:1080px){.operations-layout,.checkout-layout{grid-template-columns:1fr}.trace-panel{order:-1}.checkout-layout{min-height:0}.signal-band{grid-template-columns:1fr}.signal-band__facts{border-inline-start:0;border-top:1px solid rgba(255,255,255,.18);padding-top:.8rem}}
@media (max-width:820px){.app-shell{grid-template-columns:1fr;grid-template-rows:auto auto 1fr;grid-template-areas:"top" "rail" "main"}.shell-rail{position:relative;height:auto;padding:.65rem .8rem;overflow:visible}.product-lockup,.rail-footer{display:none}.primary-nav{margin:0;overflow:auto}.primary-nav ul{display:flex;width:max-content}.primary-nav a{min-height:2.4rem;padding:.42rem .6rem;white-space:nowrap}.nav-mark{display:none}.shell-topbar{position:sticky;min-height:4rem}.shell-main{padding:1rem}.page-heading,.pos-heading{align-items:flex-start;flex-direction:column;gap:1rem}.page-actions{justify-content:flex-start}.product-row{grid-template-columns:5.5rem 1fr auto}.product-row__stock{display:none}}
@media (max-width:620px){.signal-band__facts{grid-template-columns:1fr 1fr}.signal-band__facts div{border:0;padding:.5rem}.signal-band__facts div:last-child{grid-column:1/-1}.page-heading h1,.pos-heading h1{font-size:2.1rem}.user-cluster__copy{display:none}.section-heading{padding:1rem}.state-list article{align-items:flex-start;flex-direction:column}.table-wrap{margin:0 -.1rem}.product-row{grid-template-columns:1fr auto;gap:.25rem .8rem}.product-row__code{grid-column:1}.product-row__name{grid-column:1}.product-row>strong{grid-column:2;grid-row:1/3}.cart-lines li{grid-template-columns:1fr auto}.cart-lines li>strong{grid-column:1/-1;text-align:end}.checkout-actions{grid-template-columns:1fr}.button--pay{order:-1}.context-trail__separator,.context-trail__location{display:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
@media print{.shell-rail,.shell-topbar,.page-actions,.checkout-actions,.filter-row,.fixture-notice{display:none!important}.app-shell{display:block}.shell-main{padding:0}.work-queue,.trace-panel,.foundation-states,.product-workspace,.cart-panel{box-shadow:none;border:1px solid #aaa}}
</style>`;

const directionContract = `<!--
THESIS: Operations Ledger makes state, exceptions and provenance primary; it refuses the generic equal-card dashboard.
OWN-WORLD: Dark stock-room rail, warm ledger paper, ledger-green actions, receipt-like numeric alignment and compact operational controls.
STORY: Operators see where they are, what needs action, whether the system is safe, and how to trace every important effect.
FIRST VIEWPORT: Context bar and task heading lead into an operational status band; work queues dominate while trace or cart controls stay adjacent.
FORM: Restrained operate surface, ranked first for task clarity; shaped from stock cards, cash-register receipts and warehouse control boards.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

export function renderAppShell(input: { title: string; identity: ShellIdentity; routes: readonly AppRoute[]; currentPath: string; content: string; direction?: "ltr" | "rtl"; offline?: boolean; variant?: "admin" | "pos"; context?: ShellContext }): string {
  const visibleRoutes = permittedRoutes(input.routes, input.identity.permissions);
  const navigation = visibleRoutes.map((route) => `<li><a href="${escapeHtml(route.path)}"${route.path === input.currentPath ? ' aria-current="page"' : ""}>${routeMark(route)}<span>${escapeHtml(route.label)}</span></a></li>`).join("");
  const initials = input.identity.displayName.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
  const workspace = input.context?.workspace ?? (input.variant === "pos" ? "Point of sale" : "Operations admin");
  const location = input.context?.location ?? "All locations";
  const businessDate = input.context?.businessDate ?? "Current business date";
  const offlineBanner = input.offline ? '<div class="offline-banner" role="status"><span>Offline operating mode</span><span>Changes are queued locally and require review after sync.</span></div>' : "";
  return `${directionContract}<!doctype html><html lang="${escapeHtml(input.context?.locale ?? "en")}" dir="${input.direction ?? "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="theme-color" content="#14251e"><title>${escapeHtml(input.title)}</title>${shellStyles}</head><body><a class="skip-link" href="#main">Skip to content</a><div class="app-shell" data-shell="${input.variant ?? "admin"}"><aside class="shell-rail"><div class="product-lockup"><span class="product-lockup__mark" aria-hidden="true">OS</span><div><strong>Store Operating System</strong><span>${escapeHtml(workspace)}</span></div></div><nav class="primary-nav" aria-label="Primary"><ul>${navigation}</ul></nav><div class="rail-footer"><strong>${escapeHtml(businessDate)}</strong><span>Exact records · auditable effects</span></div></aside><header class="shell-topbar"><div class="context-trail"><span class="context-trail__tenant">${escapeHtml(input.identity.tenantName)}</span><span class="context-trail__separator" aria-hidden="true">/</span><span class="context-trail__location">${escapeHtml(location)}</span></div><div class="user-cluster"><div class="user-cluster__copy"><strong>${escapeHtml(input.identity.displayName)}</strong><span>${escapeHtml(workspace)}</span></div><span class="user-avatar" aria-hidden="true">${escapeHtml(initials)}</span></div></header>${offlineBanner}<main class="shell-main" id="main" tabindex="-1"><div class="workspace">${input.content}</div></main></div></body></html>`;
}
