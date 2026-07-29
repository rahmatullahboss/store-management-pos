import type { AppRoute } from "../../../../packages/ui/src/app-shell.js";

export interface AdminRouteDescriptor {
  readonly id: string;
  readonly path: string;
  readonly navigationLabel: string;
  readonly permission: string;
  readonly module: string;
  readonly order: number;
  readonly exact?: boolean;
  readonly icon?: string;
}

export const adminRoutes: readonly AppRoute[] = Object.freeze([
  { path: "/", label: "Overview", icon: "O" },
  { path: "/platform/reference", label: "Foundation reference", icon: "F", permission: "platform.reference.read" },
  { path: "/audit", label: "Audit history", icon: "A", permission: "platform.audit.read" },
  { path: "/access", label: "Access control", icon: "P", permission: "platform.access.manage" },
]);

function moduleIcon(moduleId: string): string {
  return moduleId.trim().slice(0, 1).toUpperCase() || "M";
}

export function composeAdminRoutes(providers: readonly (readonly AdminRouteDescriptor[])[] = []): readonly AppRoute[] {
  if (providers.length === 0) {
    return adminRoutes;
  }

  const descriptors = providers.flat();
  const ids = new Set<string>();
  const paths = new Set(adminRoutes.map((route) => route.path));

  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(`Duplicate admin route id: ${descriptor.id}`);
    }
    if (paths.has(descriptor.path)) {
      throw new Error(`Duplicate admin route path: ${descriptor.path}`);
    }
    ids.add(descriptor.id);
    paths.add(descriptor.path);
  }

  const moduleRoutes = [...descriptors]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map<AppRoute>((descriptor) => ({
      path: descriptor.path,
      label: descriptor.navigationLabel,
      permission: descriptor.permission,
      icon: descriptor.icon ?? moduleIcon(descriptor.module),
    }));

  return Object.freeze([...adminRoutes, ...moduleRoutes]);
}
