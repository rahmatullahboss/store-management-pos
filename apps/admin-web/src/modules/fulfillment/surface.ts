export type FulfillmentWorkspaceState = "ready" | "loading" | "empty" | "error" | "denied" | "stale" | "conflict";

export interface FulfillmentWorkspaceTask {
  readonly id: string;
  readonly orderNumber: string;
  readonly method: "pickup" | "local_delivery" | "ship_from_store";
  readonly status: string;
  readonly itemCount: number;
  readonly dueLabel: string;
}

export interface FulfillmentWorkspaceInput {
  readonly locale: string;
  readonly direction: "ltr" | "rtl";
  readonly state: FulfillmentWorkspaceState;
  readonly tasks: readonly FulfillmentWorkspaceTask[];
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const translations = {
  en: { title: "Fulfilment floor", intro: "Move reserved quantities through picking, packing, shipping, pickup and proof without losing order provenance.", reload: "Reload order state", open: "Open order", resume: "Resume pick", empty: "No fulfilment work is waiting" },
  ar: { title: "ساحة التجهيز", intro: "انقل الكميات المحجوزة عبر الالتقاط والتعبئة والشحن والاستلام مع الحفاظ على مصدر الطلب.", reload: "إعادة تحميل حالة الطلب", open: "فتح الطلب", resume: "متابعة الالتقاط", empty: "لا توجد مهام تجهيز معلقة" },
} as const;

const styles = `<style>
.mod-c-fulfilment{color:var(--ink,#17231e);background:var(--paper,#f5f3ec);padding:clamp(1rem,2.4vw,2rem);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.mod-c-fulfilment__head{display:flex;justify-content:space-between;align-items:end;gap:1rem;flex-wrap:wrap;margin-block-end:1.4rem}.mod-c-fulfilment h1{font-size:clamp(2rem,4vw,3.55rem);line-height:1;letter-spacing:-.03em;margin:0}.mod-c-fulfilment p{max-inline-size:70ch;color:var(--ink-soft,#405049)}.mod-c-fulfilment__summary{display:grid;grid-template-columns:minmax(0,2fr) minmax(12rem,1fr);gap:1rem;margin-block-end:1.25rem}.mod-c-fulfilment__summary section{padding:1rem 1.15rem;border-radius:14px;background:var(--surface,#fffefa);box-shadow:0 10px 24px rgba(23,35,30,.08)}.mod-c-fulfilment__summary strong{display:block;font-size:1.2rem;font-variant-numeric:tabular-nums}.mod-c-fulfilment__queue{display:grid;gap:.75rem}.mod-c-task{display:grid;grid-template-columns:minmax(12rem,1.3fr) repeat(3,minmax(7rem,.6fr)) auto;align-items:center;gap:.8rem;padding:1rem 1.1rem;border-radius:14px;background:var(--surface,#fffefa);box-shadow:0 8px 20px rgba(23,35,30,.07)}.mod-c-task a{color:var(--accent-strong,#15523d);font-weight:800}.mod-c-task span{color:var(--ink-soft,#405049)}.mod-c-task button,.mod-c-fulfilment__state button{min-block-size:44px;border:0;border-radius:10px;padding:.65rem .85rem;background:var(--accent,#1f6a51);color:#fff;font-weight:750}.mod-c-task button:focus-visible,.mod-c-task a:focus-visible,.mod-c-fulfilment__state button:focus-visible{outline:3px solid var(--focus,#e09a13);outline-offset:3px}.mod-c-fulfilment__state{display:grid;gap:.5rem;padding:1.2rem;border-radius:14px;background:var(--surface,#fffefa)}.mod-c-fulfilment__state[role=alert]{background:var(--attention-soft,#fff0c7);color:var(--attention,#8a5a00)}.mod-c-method{display:inline-flex;inline-size:max-content;padding:.25rem .55rem;border-radius:999px;background:var(--accent-soft,#dcece5);font-size:.76rem;font-weight:700}@media(max-width:860px){.mod-c-task{grid-template-columns:1fr 1fr}.mod-c-task button{grid-column:1/-1}.mod-c-fulfilment__summary{grid-template-columns:1fr}}@media(max-width:520px){.mod-c-task{grid-template-columns:1fr}}
</style>`;

function stateBlock(input: FulfillmentWorkspaceInput, text: { readonly title: string; readonly intro: string; readonly reload: string; readonly open: string; readonly resume: string; readonly empty: string }): string {
  if (input.state === "conflict") return `<section class="mod-c-fulfilment__state" role="alert"><strong>Order state changed while this task was open</strong><span>Reload the latest reservation and quantities before continuing.</span><button type="button" data-action="reload-fulfilment">${text.reload}</button></section>`;
  if (input.state === "stale") return `<section class="mod-c-fulfilment__state" role="status"><strong>Fulfilment data is stale</strong><span>Reload before confirming picked or packed quantities.</span><button type="button" data-action="reload-fulfilment">${text.reload}</button></section>`;
  if (input.state === "loading") return '<section class="mod-c-fulfilment__state" role="status" aria-live="polite" aria-busy="true"><strong>Loading warehouse work</strong><span>Reconciling reservations and latest workflow events.</span></section>';
  if (input.state === "empty") return `<section class="mod-c-fulfilment__state" role="status"><strong>${text.empty}</strong><span>New confirmed orders will appear here after reservation.</span></section>`;
  if (input.state === "error") return '<section class="mod-c-fulfilment__state" role="alert"><strong>Fulfilment queue could not be loaded</strong><span>Retry without changing any stock movement.</span><button type="button" data-action="retry-fulfilment">Retry</button></section>';
  if (input.state === "denied") return '<section class="mod-c-fulfilment__state" role="alert"><strong>Fulfilment access denied</strong><span>Request fulfillment.read permission.</span></section>';
  return "";
}

export function renderFulfillmentWorkspace(input: FulfillmentWorkspaceInput): string {
  const text = translations[input.locale.startsWith("ar") ? "ar" : "en"];
  const tasks = input.tasks.map((task) => `<article class="mod-c-task" data-status="${escapeHtml(task.status)}"><div><a href="/fulfillment/tasks/${escapeHtml(task.id)}" aria-label="${text.open} ${escapeHtml(task.orderNumber)}">${escapeHtml(task.orderNumber)}</a><div><span class="mod-c-method">${escapeHtml(task.method)}</span></div></div><span>${escapeHtml(task.status)}</span><span>${task.itemCount} items</span><span>${escapeHtml(task.dueLabel)}</span><button type="button" data-action="resume-pick" data-task-id="${escapeHtml(task.id)}">${text.resume}</button></article>`).join("");
  const body = input.state === "ready" ? `<section class="mod-c-fulfilment__queue" aria-label="Fulfilment work queue">${tasks}</section>` : stateBlock(input, text);
  return `${styles}<main class="mod-c-fulfilment" aria-labelledby="fulfilment-workspace-title" lang="${escapeHtml(input.locale)}" dir="${input.direction}" data-state="${input.state}"><header class="mod-c-fulfilment__head"><div><h1 id="fulfilment-workspace-title">${text.title}</h1><p>${text.intro}</p></div></header><div class="mod-c-fulfilment__summary"><section><strong>${input.tasks.length} active allocations</strong><span>Sorted by workflow state and due time.</span></section><section><strong>${input.tasks.filter((task) => task.status === "picking").length}</strong><span>Picking now</span></section></div>${body}</main>`;
}
