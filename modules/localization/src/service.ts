import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";

export interface ActivateCountryPackCommand {
  readonly activationId: string;
  readonly packVersionId: string;
  readonly effectiveFrom: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CountryPackActivationResult {
  readonly activationId: string;
  readonly replayed: boolean;
}

export interface AllocateLegalNumberCommand {
  readonly allocationId: string;
  readonly scopeId: string;
  readonly operationId: string;
  readonly allocationMode: "online" | "offline_block";
  readonly deviceId?: string;
}

export interface LegalNumberAllocationResult {
  readonly allocationId: string;
  readonly legalNumber: string;
  readonly numericValue: string;
  readonly replayed: boolean;
}

export interface EffectiveCurrencyConfiguration {
  readonly currency: string;
  readonly accountingScale: number;
  readonly cashIncrementMinor: string;
  readonly cashRoundingMode: "nearest" | "up" | "down";
  readonly metadataVersion: string;
}

export interface EffectiveBusinessDayConfiguration {
  readonly timeZone: string;
  readonly localStartTime: string;
  readonly boundaryVersion: string;
}

export interface EffectiveLocalizationConfiguration {
  readonly activationId: string;
  readonly packVersionId: string;
  readonly packId: string;
  readonly countryCode: string;
  readonly packVersion: string;
  readonly supportLevel: "experimental" | "limited" | "validated";
  readonly defaultLocale: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly currencies: readonly EffectiveCurrencyConfiguration[];
  readonly businessDayBoundaries: readonly EffectiveBusinessDayConfiguration[];
}

export interface LocalizationStore {
  activateCountryPack(context: RequestContext, command: ActivateCountryPackCommand): Promise<CountryPackActivationResult>;
  allocateLegalNumber(context: RequestContext, command: AllocateLegalNumberCommand): Promise<LegalNumberAllocationResult>;
  readEffectiveConfiguration(context: RequestContext, onDate: string): Promise<EffectiveLocalizationConfiguration>;
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!context.permissions.has(permission)) throw new PlatformError("PERMISSION_DENIED", `Permission denied: ${permission}`, 403);
}

function required(value: string, field: string, maximum = 1000): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  }
  return normalized;
}

function requireLegalEntity(context: RequestContext): void {
  if (!context.legalEntityId) throw new PlatformError("VALIDATION_FAILED", "A legal entity context is required", 400);
}

export class LocalizationService {
  constructor(private readonly store: LocalizationStore) {}

  async activateCountryPack(context: RequestContext, command: ActivateCountryPackCommand): Promise<CountryPackActivationResult> {
    requirePermission(context, "localization.pack.activate");
    requireLegalEntity(context);
    required(command.activationId, "activationId", 64);
    required(command.packVersionId, "packVersionId", 64);
    required(command.reason, "reason");
    required(command.idempotencyKey, "idempotencyKey", 200);
    required(command.requestHash, "requestHash", 128);
    return await this.store.activateCountryPack(context, command);
  }

  async allocateLegalNumber(context: RequestContext, command: AllocateLegalNumberCommand): Promise<LegalNumberAllocationResult> {
    requirePermission(context, "localization.number.allocate");
    requireLegalEntity(context);
    required(command.allocationId, "allocationId", 64);
    required(command.scopeId, "scopeId", 64);
    required(command.operationId, "operationId", 256);
    if (command.allocationMode === "offline_block" && !context.deviceId && !command.deviceId) {
      throw new PlatformError("VALIDATION_FAILED", "Offline legal-number allocation requires a device context", 400);
    }
    return await this.store.allocateLegalNumber(context, {
      ...command,
      ...(command.deviceId || context.deviceId ? { deviceId: command.deviceId ?? context.deviceId } : {}),
    });
  }

  async readEffectiveConfiguration(context: RequestContext, onDate: string = context.businessDate): Promise<EffectiveLocalizationConfiguration> {
    requirePermission(context, "localization.pack.read");
    requireLegalEntity(context);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(onDate)) {
      throw new PlatformError("VALIDATION_FAILED", "onDate must use YYYY-MM-DD", 400);
    }
    return await this.store.readEffectiveConfiguration(context, onDate);
  }
}
