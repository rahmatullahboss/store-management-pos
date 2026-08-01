const ANCHOR = `  probes.push(await probe(baseUrl, "/admin/procurement", "Procurement", 200, authenticated));
  probes.push(await probe(baseUrl, "/pos", "Persistent staging · synthetic POS", 200, authenticated));`;

const REPLACEMENT = `  probes.push(await probe(baseUrl, "/admin/procurement", "Procurement", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/catalog/products/synthetic-product", "Catalog operations", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/catalog/imports", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/catalog/units", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/pricing", "Pricing and tax control", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/pricing/promotions", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/pricing/discount-approvals", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/tax", "Tax", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/tax/exemptions", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/fulfillment", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/finance/payments", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/finance/accounting", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/finance/banking", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/finance/readiness", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/pos/reconciliation", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/localization", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/compliance", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/reporting", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/integrations", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/platform/saas", "", 403, authenticated));
  probes.push(await probe(baseUrl, "/admin/not-a-real-route", "Page not found", 404, authenticated));
  probes.push(await probe(baseUrl, "/pos", "Persistent staging · synthetic POS", 200, authenticated));`;

export function addMainWebProbeCoverage(source) {
  if (source.includes("/admin/platform/saas")) return source;
  if (!source.includes(ANCHOR)) {
    throw new Error("Persistent staging probe anchor was not found");
  }
  return source.replace(ANCHOR, REPLACEMENT);
}
