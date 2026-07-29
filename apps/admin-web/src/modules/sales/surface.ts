export type SalesWorkspaceState = "ready" | "loading" | "empty" | "error" | "denied" | "stale";

export interface SalesWorkspaceOrder {
  readonly id: string;
  readonly documentNumber: string;
  readonly customer: string;
  readonly total: string;
  readonly orderStatus: string;
  readonly paymentStatus: string;
  readonly fulfillmentStatus: string;
  readonly invoiceStatus: string;
}

export interface SalesWorkspaceInput {
  readonly locale: string;
  readonly direction: "ltr" | "rtl";
  readonly state: SalesWorkspaceState;
  readonly orders: readonly SalesWorkspaceOrder[];
  readonly approvalCount: number;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const copy = {
  "en-GB": { title: "Sales control desk", intro: "Trace quotations, orders, payment, fulfilment, invoicing and returns without collapsing independent states.", newQuote: "New quotation", empty: "No sales orders", emptyHelp: "Create a quotation or direct order to begin.", approvals: "Approvals requiring action" },
  "bn-BD": { title: "বিক্রয় নিয়ন্ত্রণ ডেস্ক", intro: "কোটেশন, অর্ডার, পেমেন্ট, ফুলফিলমেন্ট, ইনভয়েস ও রিটার্নের আলাদা অবস্থা অনুসরণ করুন।", newQuote: "নতুন কোটেশন", empty: "কোনো বিক্রয় অর্ডার নেই", emptyHelp: "শুরু করতে একটি কোটেশন বা সরাসরি অর্ডার তৈরি করুন।", approvals: "অনুমোদনের অপেক্ষায়" },
} as const;

const styles = `<style>
.mod-c-sales{color:var(--ink,#17231e);background:var(--paper,#f5f3ec);padding:clamp(1rem,2.4vw,2rem);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.mod-c-sales__head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:1rem;margin-block-end:1.4rem}.mod-c-sales h1{font-size:clamp(2rem,4vw,3.55rem);line-height:1;letter-spacing:-.03em;margin:0;max-inline-size:13ch}.mod-c-sales p{max-inline-size:70ch;color:var(--ink-soft,#405049)}.mod-c-sales button,.mod-c-sales a{min-block-size:44px}.mod-c-sales button{border:0;border-radius:10px;padding:.65rem 1rem;background:var(--accent,#1f6a51);color:#fff;font-weight:750}.mod-c-sales button:focus-visible,.mod-c-sales a:focus-visible{outline:3px solid var(--focus,#e09a13);outline-offset:3px}.mod-c-sales__band{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:1rem 1.2rem;border-radius:14px;background:var(--rail,#14251e);color:#fff;margin-block-end:1.25rem}.mod-c-sales__band strong{font-variant-numeric:tabular-nums;font-size:1.2rem}.mod-c-sales__queue{overflow-x:auto;border-radius:14px;background:var(--surface,#fffefa);box-shadow:0 10px 24px rgba(23,35,30,.08)}.mod-c-sales table{inline-size:100%;min-inline-size:64rem;border-collapse:collapse}.mod-c-sales th,.mod-c-sales td{text-align:start;padding:.85rem 1rem;border-block-end:1px solid var(--line,#d7ddd8)}.mod-c-sales th{color:var(--muted,#59675f);font-size:.76rem}.mod-c-sales td[data-money]{font-variant-numeric:tabular-nums;font-weight:750}.mod-c-sales__states{display:flex;gap:.4rem;flex-wrap:wrap}.mod-c-sales__states span{padding:.25rem .5rem;border-radius:999px;background:var(--accent-soft,#dcece5);font-size:.74rem;font-weight:700}.mod-c-sales__state{display:grid;gap:.5rem;padding:1.25rem;border-radius:14px;background:var(--surface,#fffefa)}.mod-c-sales__state[role=alert]{background:var(--danger-soft,#fbe1df);color:var(--danger,#9b2c2c)}@media(max-width:720px){.mod-c-sales__head{grid-template-columns:1fr;align-items:start}.mod-c-sales__band{align-items:flex-start;flex-direction:column}}
</style>`;

function renderState(input: SalesWorkspaceInput, text: { readonly title: string; readonly intro: string; readonly newQuote: string; readonly empty: string; readonly emptyHelp: string; readonly approvals: string }): string {
  if (input.state === "empty") return `<section class="mod-c-sales__state" role="status"><strong>${text.empty}</strong><span>${text.emptyHelp}</span><button type="button" data-action="create-quote">${text.newQuote}</button></section>`;
  if (input.state === "loading") return '<section class="mod-c-sales__state" role="status" aria-live="polite" aria-busy="true"><strong>Loading sales work</strong><span>Rebuilding independent order, payment, fulfilment and invoice states.</span></section>';
  if (input.state === "error") return '<section class="mod-c-sales__state" role="alert"><strong>Sales work could not be loaded</strong><span>Retry the request; no order state has been changed.</span><button type="button" data-action="retry-sales">Retry</button></section>';
  if (input.state === "denied") return '<section class="mod-c-sales__state" role="alert"><strong>Sales access denied</strong><span>Request sales.order.read permission.</span></section>';
  if (input.state === "stale") return '<section class="mod-c-sales__state" role="status"><strong>The order changed</strong><span>Reload before applying payment, invoice or cancellation decisions.</span><button type="button" data-action="reload-order">Reload order</button></section>';
  return "";
}

export function renderSalesWorkspace(input: SalesWorkspaceInput): string {
  const text = copy[input.locale as keyof typeof copy] ?? copy["en-GB"];
  const rows = input.orders.map((order) => `<tr><td><a href="/sales/orders/${escapeHtml(order.id)}" aria-label="Open order ${escapeHtml(order.documentNumber)}">${escapeHtml(order.documentNumber)}</a></td><td>${escapeHtml(order.customer)}</td><td data-money>${escapeHtml(order.total)}</td><td><div class="mod-c-sales__states"><span>${escapeHtml(order.orderStatus)}</span><span>${escapeHtml(order.paymentStatus)}</span><span>${escapeHtml(order.fulfillmentStatus)}</span><span>${escapeHtml(order.invoiceStatus)}</span></div></td></tr>`).join("");
  const content = input.state === "ready" ? `<div class="mod-c-sales__queue"><table><caption class="sr-only">Sales order work queue</caption><thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Independent lifecycle states</th></tr></thead><tbody>${rows}</tbody></table></div>` : renderState(input, text);
  return `${styles}<main class="mod-c-sales" aria-labelledby="sales-workspace-title" lang="${escapeHtml(input.locale)}" dir="${input.direction}" data-state="${input.state}"><header class="mod-c-sales__head"><div><h1 id="sales-workspace-title">${text.title}</h1><p>${text.intro}</p></div><button type="button" data-action="create-quote">${text.newQuote}</button></header><section class="mod-c-sales__band" aria-label="Sales attention"><div><strong>${input.orders.length} active documents</strong><div>Every total keeps its price, tax and source-document snapshot.</div></div><div><strong>${input.approvalCount}</strong><div>${text.approvals}</div></div></section>${content}</main>`;
}
