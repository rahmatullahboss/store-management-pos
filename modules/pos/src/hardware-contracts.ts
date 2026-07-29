import type { ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";

export type HardwareCapability =
  | "receipt_printer"
  | "cash_drawer"
  | "barcode_scanner"
  | "scale"
  | "customer_display"
  | "payment_terminal"
  | "fiscal_device";

export interface HardwareProfileV1 {
  readonly schemaVersion: "1.0";
  readonly profileId: string;
  readonly tenantId: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly deviceId: string;
  readonly agentVersion: string;
  readonly capabilities: readonly HardwareCapability[];
  readonly capabilityVersions: Readonly<Partial<Record<HardwareCapability, string>>>;
  readonly enrolledAt: string;
  readonly revokedAt?: string;
}

export interface HardwareCommandV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly commandId: string;
  readonly deviceId: string;
  readonly capability: HardwareCapability;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
}

export interface HardwareCommandResultV1 {
  readonly commandId: string;
  readonly deviceId: string;
  readonly capability: HardwareCapability;
  readonly status: "succeeded" | "failed" | "timed_out" | "unsupported" | "revoked";
  readonly output?: Readonly<Record<string, unknown>>;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly completedAt: string;
}
