export interface AppRoute {
  readonly path: string;
  readonly label: string;
  readonly permission?: string;
  readonly icon?: string;
  readonly offlineAvailable?: boolean;
}

export interface ShellIdentity { readonly displayName: string; readonly tenantName: string; readonly permissions: ReadonlySet<string> }

export function canAccessRoute(route: AppRoute, permissions: ReadonlySet<string>): boolean {
  return route.permission === undefined || permissions.has(route.permission);
}

export function permittedRoutes(routes: readonly AppRoute[], permissions: ReadonlySet<string>): readonly AppRoute[] {
  return routes.filter((route) => canAccessRoute(route, permissions));
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function renderAppShell(input: { title: string; identity: ShellIdentity; routes: readonly AppRoute[]; currentPath: string; content: string; direction?: "ltr" | "rtl"; offline?: boolean }): string {
  const visibleRoutes = permittedRoutes(input.routes, input.identity.permissions);
  const navigation = visibleRoutes.map((route) => `<li><a href="${escapeHtml(route.path)}"${route.path === input.currentPath ? ' aria-current="page"' : ""}>${escapeHtml(route.label)}</a></li>`).join("");
  return `<!doctype html><html lang="en" dir="${input.direction ?? "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head><body><a href="#main">Skip to content</a><header><strong>${escapeHtml(input.identity.tenantName)}</strong><span>${escapeHtml(input.identity.displayName)}</span>${input.offline ? '<span role="status">Offline</span>' : ""}</header><nav aria-label="Primary"><ul>${navigation}</ul></nav><main id="main" tabindex="-1">${input.content}</main></body></html>`;
}
