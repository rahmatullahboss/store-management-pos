import type { AppRoute } from "../../../../packages/ui/src/app-shell.js";
export const posRoutes: readonly AppRoute[] = [
  { path: "/", label: "Register", permission: "platform.register.use", offlineAvailable: true },
  { path: "/sync", label: "Sync status", permission: "platform.device.read", offlineAvailable: true },
  { path: "/device", label: "Device", permission: "platform.device.read", offlineAvailable: true },
];
