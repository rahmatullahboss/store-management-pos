export type CustomerWorkspaceState = "ready" | "loading" | "empty" | "error" | "denied" | "stale";

export interface CustomerWorkspaceRow {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "person" | "company";
  readonly status: "active" | "inactive" | "merged";
  readonly credit: string;
  readonly updatedAt: string;
}

export interface CustomerWorkspaceInput {
  readonly locale: string;
  readonly direction: "ltr" | "rtl";
  readonly state: CustomerWorkspaceState;
  readonly customers: readonly CustomerWorkspaceRow[];
  readonly pendingApprovals: number;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function stateMessage(state: CustomerWorkspaceState): string {
  if (state === "loading") return '<section class="mod-c-state" role="status" aria-live="polite" aria-busy="true"><strong>Loading customers</strong><span>Retrieving profiles, credit and consent history.</span></section>';
  if (state === "empty") return '<section class="mod-c-state" role="status"><strong>No customers yet</strong><span>Create a profile or import an approved customer file.</span></section>';
  if (state === "error") return '<section class="mod-c-state mod-c-state--danger" role="alert"><strong>Customer list could not be loaded</strong><span>Check the connection, then retry without losing your filters.</span><button type="button" data-action="retry-customers">Retry</button></section>';
  if (state === "denied") return '<section class="mod-c-state mod-c-state--danger" role="alert"><strong>Customer access denied</strong><span>Ask an administrator for customer.profile.read permission.</span></section>';
  if (state === "stale") return '<section class="mod-c-state mod-c-state--attention" role="status"><strong>Customer data changed</strong><span>Reload the profile before applying credit or merge decisions.</span><button type="button" data-action="reload-customers">Reload current data</button></section>';
  return "";
}

const styles = `<style>
.mod-c-workspace{color:var(--ink,#17231e);background:var(--paper,#f5f3ec);padding:clamp(1rem,2.4vw,2rem);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.mod-c-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-block-end:1.5rem}.mod-c-heading h1{font-size:clamp(2rem,4vw,3.55rem);line-height:1;letter-spacing:-.03em;margin:0;max-inline-size:14ch}.mod-c-heading p{max-inline-size:65ch;color:var(--ink-soft,#405049);margin:.75rem 0 0}.mod-c-actions{display:flex;gap:.65rem;flex-wrap:wrap}.mod-c-button{min-block-size:44px;padding:.65rem 1rem;border:0;border-radius:10px;background:var(--accent,#1f6a51);color:#fff;font-weight:700}.mod-c-button:focus-visible,.mod-c-workspace button:focus-visible,.mod-c-workspace a:focus-visible{outline:3px solid var(--focus,#e09a13);outline-offset:3px}.mod-c-signal{display:grid;grid-template-columns:minmax(0,2fr) minmax(12rem,1fr);gap:1rem;margin-block-end:1.5rem}.mod-c-signal>section{border-radius:14px;padding:1.1rem 1.2rem;background:var(--surface,#fffefa);box-shadow:0 10px 24px rgba(23,35,30,.08)}.mod-c-signal strong{display:block;font-size:1.15rem}.mod-c-signal span{display:block;color:var(--ink-soft,#405049);margin-block-start:.35rem}.mod-c-approval{background:var(--attention-soft,#fff0c7)!important;color:var(--attention,#8a5a00)}.mod-c-table-wrap{overflow-x:auto;background:var(--surface,#fffefa);border-radius:14px;box-shadow:0 10px 24px rgba(23,35,30,.08)}.mod-c-table{border-collapse:collapse;inline-size:100%;min-inline-size:46rem}.mod-c-table th,.mod-c-table td{text-align:start;padding:.9rem 1rem;border-block-end:1px solid var(--line,#d7ddd8)}.mod-c-table th{font-size:.78rem;color:var(--muted,#59675f)}.mod-c-table td[data-numeric]{font-variant-numeric:tabular-nums}.mod-c-link{color:var(--accent-strong,#15523d);font-weight:700}.mod-c-status{display:inline-flex;align-items:center;gap:.4rem;padding:.25rem .55rem;border-radius:999px;background:var(--accent-soft,#dcece5);font-size:.78rem;font-weight:700}.mod-c-state{display:grid;gap:.5rem;padding:1.2rem;background:var(--surface,#fffefa);border-radius:14px}.mod-c-state--danger{background:var(--danger-soft,#fbe1df);color:var(--danger,#9b2c2c)}.mod-c-state--attention{background:var(--attention-soft,#fff0c7);color:var(--attention,#8a5a00)}@media(max-width:720px){.mod-c-signal{grid-template-columns:1fr}.mod-c-heading{align-items:flex-start}}@media(prefers-reduced-motion:no-preference){.mod-c-table tbody tr{transition:background-color 160ms ease-out}.mod-c-table tbody tr:hover{background:var(--accent-soft,#dcece5)}}
</style>`;

export function renderCustomerWorkspace(input: CustomerWorkspaceInput): string {
  const rows = input.customers.map((customer) => `<tr>
<td><a class="mod-c-link" href="/customers/${escapeHtml(customer.id)}">${escapeHtml(customer.displayName)}</a></td>
<td>${customer.kind === "company" ? "Company" : "Person"}</td>
<td><span class="mod-c-status">${escapeHtml(customer.status)}</span></td>
<td data-numeric>${escapeHtml(customer.credit)}</td>
<td>${escapeHtml(customer.updatedAt)}</td>
</tr>`).join("");
  const body = input.state === "ready" ? `<div class="mod-c-table-wrap"><table class="mod-c-table"><caption class="sr-only">Customer directory</caption><thead><tr><th scope="col">Customer</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Credit</th><th scope="col">Updated</th></tr></thead><tbody>${rows}</tbody></table></div>` : stateMessage(input.state);
  return `${styles}<main class="mod-c-workspace" id="customer-workspace" aria-labelledby="customer-workspace-title" lang="${escapeHtml(input.locale)}" dir="${input.direction}" data-state="${input.state}">
<header class="mod-c-heading"><div><h1 id="customer-workspace-title">Customer directory</h1><p>Manage profiles, addresses, consent, duplicate identities and credit controls with a complete audit trail.</p></div><div class="mod-c-actions"><button class="mod-c-button" type="button" data-action="create-customer">New customer</button><button type="button" data-action="import-customers">Import</button></div></header>
<div class="mod-c-signal"><section><strong>${input.customers.length} visible customers</strong><span>Scoped to the current tenant and legal entity.</span></section><section class="mod-c-approval"><strong>${input.pendingApprovals > 0 ? "Credit approval needed" : "No credit approvals pending"}</strong><span>${input.pendingApprovals} account decisions require review.</span></section></div>${body}</main>`;
}
