import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type {
  ActivateCountryPackCommand,
  AllocateLegalNumberCommand,
  CountryPackActivationResult,
  EffectiveBusinessDayConfiguration,
  EffectiveCurrencyConfiguration,
  EffectiveLocalizationConfiguration,
  LegalNumberAllocationResult,
  LocalizationStore,
} from "./service.js";

interface ActivationRow extends Record<string, unknown> {
  readonly activation_id: string;
  readonly replayed: boolean;
}

interface AllocationRow extends Record<string, unknown> {
  readonly allocation_id: string;
  readonly legal_number: string;
  readonly numeric_value: string;
  readonly replayed: boolean;
}

interface ConfigurationRow extends Record<string, unknown> {
  readonly activation_id: string;
  readonly pack_version_id: string;
  readonly pack_id: string;
  readonly country_code: string;
  readonly pack_version: string;
  readonly support_level: EffectiveLocalizationConfiguration["supportLevel"];
  readonly default_locale: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly capabilities: unknown;
  readonly currencies: unknown;
  readonly boundaries: unknown;
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { readonly code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Localization database command failed";
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof PlatformError) throw error;
  const code = databaseCode(error);
  const message = databaseMessage(error);
  if (code === "P0002") throw new PlatformError("NOT_FOUND", message, 404);
  if (code === "42501") throw new PlatformError("PERMISSION_DENIED", message, 403);
  if (code === "23505") {
    if (/idempotency|operation_id|operation id/iu.test(message)) throw new PlatformError("IDEMPOTENCY_CONFLICT", message, 409);
    throw new PlatformError("CONFLICT", message, 409);
  }
  if (code === "22000" || code === "22023" || code === "23514") {
    throw new PlatformError("VALIDATION_FAILED", message, 400);
  }
  if (code === "55P03" || code === "40001" || code === "P0001") {
    throw new PlatformError("CONFLICT", message, 409);
  }
  throw error;
}

async function withLocalizationError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    translateDatabaseError(error);
  }
}

function requireSingle<Row>(rows: readonly Row[], message: string): Row {
  const row = rows[0];
  if (!row) throw new PlatformError("NOT_FOUND", message, 404);
  return row;
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlatformError("INTERNAL_ERROR", `${field} database payload is invalid`, 500);
  }
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

function recordArray(value: unknown, field: string): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) throw new PlatformError("INTERNAL_ERROR", `${field} database payload is invalid`, 500);
  return Object.freeze(value.map((item) => record(item, field)));
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new PlatformError("INTERNAL_ERROR", `${field} database value is invalid`, 500);
  return value;
}

function integer(value: unknown, field: string): number {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(normalized)) throw new PlatformError("INTERNAL_ERROR", `${field} database value is invalid`, 500);
  return normalized;
}

function currencies(value: unknown): readonly EffectiveCurrencyConfiguration[] {
  return Object.freeze(recordArray(value, "currencies").map((item) => Object.freeze({
    currency: text(item.currency, "currency"),
    accountingScale: integer(item.accountingScale, "accountingScale"),
    cashIncrementMinor: text(item.cashIncrementMinor, "cashIncrementMinor"),
    cashRoundingMode: text(item.cashRoundingMode, "cashRoundingMode") as EffectiveCurrencyConfiguration["cashRoundingMode"],
    metadataVersion: text(item.metadataVersion, "metadataVersion"),
  })));
}

function boundaries(value: unknown): readonly EffectiveBusinessDayConfiguration[] {
  return Object.freeze(recordArray(value, "businessDayBoundaries").map((item) => Object.freeze({
    timeZone: text(item.timeZone, "timeZone"),
    localStartTime: text(item.localStartTime, "localStartTime"),
    boundaryVersion: text(item.boundaryVersion, "boundaryVersion"),
  })));
}

export class NeonLocalizationStore implements LocalizationStore {
  constructor(private readonly database: NeonDatabase) {}

  async activateCountryPack(context: RequestContext, command: ActivateCountryPackCommand): Promise<CountryPackActivationResult> {
    return await withLocalizationError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<ActivationRow>(
        `SELECT activation_id, replayed
           FROM localization.activate_country_pack(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6::date, $7::uuid, $8::text, $9::text, $10::text
           )`,
        [
          command.activationId,
          context.tenantId,
          context.legalEntityId,
          context.storeId ?? null,
          command.packVersionId,
          command.effectiveFrom,
          context.actorId,
          command.reason,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      const row = requireSingle(result.rows, "Country-pack activation returned no result");
      return Object.freeze({ activationId: row.activation_id, replayed: row.replayed });
    }));
  }

  async allocateLegalNumber(context: RequestContext, command: AllocateLegalNumberCommand): Promise<LegalNumberAllocationResult> {
    return await withLocalizationError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<AllocationRow>(
        `SELECT allocation_id, legal_number, numeric_value::text, replayed
           FROM localization.allocate_legal_number(
             $1::uuid, $2::uuid, $3::uuid, $4::date, $5::text,
             $6::text, $7::text, $8::uuid, $9::text, $10::text
           )`,
        [
          command.allocationId,
          context.tenantId,
          command.scopeId,
          context.businessDate,
          command.operationId,
          command.allocationMode,
          command.deviceId ?? null,
          context.actorId,
          context.requestId,
          context.traceId,
        ],
      );
      const row = requireSingle(result.rows, "Legal-number allocation returned no result");
      return Object.freeze({
        allocationId: row.allocation_id,
        legalNumber: row.legal_number,
        numericValue: row.numeric_value,
        replayed: row.replayed,
      });
    }));
  }

  async readEffectiveConfiguration(context: RequestContext, onDate: string): Promise<EffectiveLocalizationConfiguration> {
    return await withLocalizationError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<ConfigurationRow>(
        `SELECT
           activation.id::text AS activation_id,
           pack.id::text AS pack_version_id,
           pack.pack_id,
           pack.country_code,
           pack.version AS pack_version,
           pack.support_level,
           pack.default_locale,
           activation.effective_from::text,
           activation.effective_to::text,
           COALESCE(pack.manifest -> 'capabilities', '{}'::jsonb) AS capabilities,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'currency', metadata.currency,
               'accountingScale', metadata.accounting_scale,
               'cashIncrementMinor', metadata.cash_increment_minor::text,
               'cashRoundingMode', metadata.cash_rounding_mode,
               'metadataVersion', metadata.metadata_version
             ) ORDER BY metadata.currency, metadata.effective_from)
             FROM localization.currency_metadata metadata
             WHERE metadata.tenant_id = activation.tenant_id
               AND metadata.pack_version_id = pack.id
               AND metadata.effective_from <= $4::date
               AND (metadata.effective_to IS NULL OR metadata.effective_to >= $4::date)
           ), '[]'::jsonb) AS currencies,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'timeZone', boundary.time_zone,
               'localStartTime', boundary.local_start_time::text,
               'boundaryVersion', boundary.boundary_version
             ) ORDER BY boundary.time_zone, boundary.effective_from)
             FROM localization.business_day_boundaries boundary
             WHERE boundary.tenant_id = activation.tenant_id
               AND boundary.pack_version_id = pack.id
               AND boundary.effective_from <= $4::date
               AND (boundary.effective_to IS NULL OR boundary.effective_to >= $4::date)
           ), '[]'::jsonb) AS boundaries
         FROM localization.country_pack_activations activation
         JOIN localization.country_pack_versions pack
           ON pack.tenant_id = activation.tenant_id AND pack.id = activation.pack_version_id
         WHERE activation.tenant_id = $1::uuid
           AND activation.legal_entity_id = $2::uuid
           AND (activation.store_id IS NULL OR activation.store_id IS NOT DISTINCT FROM $3::uuid)
           AND activation.status = 'active'
           AND activation.effective_from <= $4::date
           AND (activation.effective_to IS NULL OR activation.effective_to >= $4::date)
         ORDER BY (activation.store_id IS NOT NULL) DESC, activation.effective_from DESC
         LIMIT 1`,
        [context.tenantId, context.legalEntityId, context.storeId ?? null, onDate],
      );
      const row = requireSingle(result.rows, "No effective country-pack activation exists");
      return Object.freeze({
        activationId: row.activation_id,
        packVersionId: row.pack_version_id,
        packId: row.pack_id,
        countryCode: row.country_code,
        packVersion: row.pack_version,
        supportLevel: row.support_level,
        defaultLocale: row.default_locale,
        effectiveFrom: row.effective_from,
        ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
        capabilities: record(row.capabilities, "capabilities"),
        currencies: currencies(row.currencies),
        businessDayBoundaries: boundaries(row.boundaries),
      });
    }));
  }
}
