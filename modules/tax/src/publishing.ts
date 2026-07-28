import { requirePermission, type RequestContext, type TransactionClient } from "../../../packages/foundation/src/index.js";
import { TAX_PERMISSIONS } from "./repository.js";

export interface TaxPublishResult {
  readonly taxCodeId: string;
  readonly version: bigint;
  readonly status: string;
  readonly replayed: boolean;
  readonly effectiveFrom: string;
}

export interface TaxRatePublishInput {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly rateBasisPoints: bigint;
  readonly compound?: boolean;
  readonly recoverableBasisPoints?: bigint;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
  readonly priority?: number;
}

export async function publishTaxConfiguration(
  client: TransactionClient,
  context: RequestContext,
  input: {
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly jurisdiction: {
      readonly id: string;
      readonly code: string;
      readonly name: string;
      readonly countryCode: string;
      readonly parentId?: string;
      readonly priority?: number;
      readonly expectedVersion: bigint;
      readonly metadata?: Readonly<Record<string, unknown>>;
    };
    readonly taxCode: { readonly id: string; readonly code: string; readonly name: string; readonly expectedCurrentVersion: bigint };
    readonly codeVersion: {
      readonly id: string;
      readonly status: "scheduled" | "active";
      readonly defaultTreatment: "standard" | "zero_rated" | "exempt" | "reverse_charge" | "out_of_scope";
      readonly priceMode: "exclusive" | "inclusive";
      readonly roundingMode: "half_up" | "half_even" | "floor" | "ceiling" | "toward_zero";
      readonly effectiveFrom: string;
      readonly effectiveUntil?: string;
      readonly reason: string;
    };
    readonly rates: readonly TaxRatePublishInput[];
  },
): Promise<TaxPublishResult> {
  requirePermission(context, TAX_PERMISSIONS.manage);
  requirePermission(context, TAX_PERMISSIONS.publish);
  if (input.idempotencyKey.length < 8) throw new TypeError("Tax publishing idempotency key is invalid");
  if (!/^[a-f0-9]{64}$/i.test(input.requestHash)) throw new TypeError("Tax publishing request hash must be a SHA-256 hex digest");
  if (input.codeVersion.reason.trim().length < 4 || input.codeVersion.reason.length > 500) throw new TypeError("Tax publishing reason is invalid");
  if (input.rates.length === 0) throw new TypeError("At least one tax rate is required");
  const rates = input.rates.map((rate) => ({
    ...rate,
    rateBasisPoints: rate.rateBasisPoints.toString(),
    ...(rate.recoverableBasisPoints === undefined ? {} : { recoverableBasisPoints: rate.recoverableBasisPoints.toString() }),
  }));
  const result = await client.query<{ tax_code_id: string; version: string; status: string; replayed: boolean; effective_from: string }>(
    "SELECT tax_code_id::text,version::text,status,replayed,effective_from::text FROM tax.publish_configuration($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7)",
    [
      input.idempotencyKey,
      input.requestHash,
      JSON.stringify({ ...input.jurisdiction, expectedVersion: input.jurisdiction.expectedVersion.toString() }),
      JSON.stringify({ ...input.taxCode, expectedCurrentVersion: input.taxCode.expectedCurrentVersion.toString() }),
      JSON.stringify(input.codeVersion),
      JSON.stringify(rates),
      context.requestId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Tax configuration publish returned no row");
  return Object.freeze({ taxCodeId: row.tax_code_id, version: BigInt(row.version), status: row.status, replayed: row.replayed, effectiveFrom: row.effective_from });
}
