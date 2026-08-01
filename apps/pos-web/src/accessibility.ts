const CART_TABLE_WRAP = '<div class="modd-table-wrap">';
const ACCESSIBLE_CART_TABLE_WRAP = '<div class="modd-table-wrap" tabindex="0" role="region" aria-label="Current cart items">';

export function hardenPosWorkspaceAccessibility(html: string): string {
  if (!html.includes(CART_TABLE_WRAP)) return html;
  return html.replace(CART_TABLE_WRAP, ACCESSIBLE_CART_TABLE_WRAP);
}
