const ANCHOR = `  probes.push(await probe(baseUrl, "/admin/procurement", "Procurement", 200, authenticated));
  probes.push(await probe(baseUrl, "/pos", "Persistent staging · synthetic POS", 200, authenticated));`;

const REPLACEMENT = `  probes.push(await probe(baseUrl, "/admin/procurement", "Procurement", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/catalog/products/synthetic-product", "Catalog operations", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/catalog/imports", "Import control", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/catalog/units", "Units and conversions", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/pricing", "Pricing and tax control", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/pricing/promotions", "Promotions", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/pricing/discount-approvals", "Approval", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/tax", "Tax", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/tax/exemptions", "Tax", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/fulfillment", "Fulfilment floor", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/finance/payments", "Payment operations", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/finance/accounting", "Accounting control", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/finance/banking", "Bank reconciliation", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/finance/readiness", "Finance readiness", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/pos/reconciliation", "POS reconciliation", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/localization", "Localization &amp; compliance", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/compliance", "Compliance evidence", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/reporting", "Owner reporting", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/integrations", "Integration health", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/platform/saas", "SaaS administration", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/not-a-real-route", "Page not found", 404, authenticated));
  probes.push(await probe(baseUrl, "/pos", "Persistent staging · synthetic POS", 200, authenticated));`;

export function addMainWebProbeCoverage(source) {
  if (source.includes("/admin/platform/saas")) return source;
  if (!source.includes(ANCHOR)) {
    throw new Error("Persistent staging probe anchor was not found");
  }
  return source.replace(ANCHOR, REPLACEMENT);
}
