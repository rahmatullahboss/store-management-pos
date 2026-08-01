const EMBEDDED_MAIN_ROOTS = Object.freeze([
  "mod-c-workspace",
  "mod-c-sales",
  "mod-c-fulfilment",
  "pos-reconciliation",
] as const);

function normalizeEmbeddedMain(html: string, rootClass: string): string {
  const opening = `<main class="${rootClass}"`;
  const openingIndex = html.indexOf(opening);
  if (openingIndex < 0) return html;
  const closingIndex = html.indexOf("</main>", openingIndex);
  if (closingIndex < openingIndex) return html;
  return `${html.slice(0, openingIndex)}<section class="${rootClass}"${html.slice(openingIndex + opening.length, closingIndex)}</section>${html.slice(closingIndex + 7)}`;
}

function focusScrollablePosReconciliation(html: string): string {
  const current = '<div class="pos-reconciliation__table-wrap">';
  if (!html.includes(current)) return html;
  return html.replace(
    current,
    '<div class="pos-reconciliation__table-wrap" tabindex="0" role="region" aria-label="POS reconciliation evidence table">',
  );
}

export function hardenAdminDocumentAccessibility(html: string): string {
  const normalized = EMBEDDED_MAIN_ROOTS.reduce(
    (current, rootClass) => normalizeEmbeddedMain(current, rootClass),
    html,
  );
  return focusScrollablePosReconciliation(normalized);
}
