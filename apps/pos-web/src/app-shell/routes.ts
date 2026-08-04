import type { AppRoute } from "../../../../packages/ui/src/app-shell.js";

export const posRoutes: readonly AppRoute[] = [
  { path: "/", label: "POS Register", icon: "R", permission: "platform.register.use", offlineAvailable: true },
  { path: "/sync", label: "Sync & Offline Operations", icon: "S", permission: "platform.device.read", offlineAvailable: true },
  { path: "/device", label: "Register & Device Diagnostics", icon: "D", permission: "platform.device.read", offlineAvailable: true },
];
