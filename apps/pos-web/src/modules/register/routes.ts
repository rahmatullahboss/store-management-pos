export interface PosModuleRoute {
  readonly id: string;
  readonly path: string;
  readonly navigationLabel: string;
  readonly permission: string;
  readonly offlineAvailable: boolean;
  readonly order: number;
  readonly exact?: boolean;
}

export const MOD_D_POS_ROUTES: readonly PosModuleRoute[] = Object.freeze([
  Object.freeze({ id: "pos.register", path: "/", navigationLabel: "Register", permission: "pos.checkout.execute", offlineAvailable: true, order: 10, exact: true }),
  Object.freeze({ id: "pos.receipts", path: "/receipts", navigationLabel: "Receipts", permission: "pos.checkout.read", offlineAvailable: true, order: 20, exact: true }),
  Object.freeze({ id: "pos.returns", path: "/returns", navigationLabel: "Returns", permission: "sales.return.create", offlineAvailable: false, order: 30, exact: true }),
  Object.freeze({ id: "pos.cash", path: "/cash", navigationLabel: "Cash shift", permission: "cash.shift.read", offlineAvailable: true, order: 40, exact: true }),
  Object.freeze({ id: "pos.reconciliation", path: "/reconciliation", navigationLabel: "Reconciliation", permission: "pos.sync.review", offlineAvailable: true, order: 50, exact: true }),
  Object.freeze({ id: "pos.sync", path: "/sync", navigationLabel: "Sync status", permission: "pos.sync.read", offlineAvailable: true, order: 60, exact: true }),
  Object.freeze({ id: "pos.device", path: "/device", navigationLabel: "Device", permission: "pos.device.manage", offlineAvailable: true, order: 70, exact: true }),
]);

export function visiblePosModuleRoutes(permissions: ReadonlySet<string>, online: boolean): readonly PosModuleRoute[] {
  return Object.freeze(MOD_D_POS_ROUTES
    .filter((route) => permissions.has(route.permission) && (online || route.offlineAvailable))
    .sort((left, right) => left.order - right.order));
}
