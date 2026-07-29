import { requirePermission, type RequestContext, type TransactionClient } from "../../../packages/foundation/src/index.js";
import type { TaxCalculation } from "./model.js";

export const TAX_PERMISSIONS = Object.freeze({
  read: "tax.calculation.read",
  manage: "tax.configuration.manage",
  publish: "tax.configuration.publish",
  exemptionManage: "tax.exemption.manage",
} as const);

export interface PersistedTaxSnapshot {
  readonly snapshotId: string;
  readonly sourceLineId: string;
  readonly treatment: string;
  readonly currency: string;
  readonly scale: number;
  readonly netMinor: bigint;
  readonly taxMinor: bigint;
  readonly grossMinor: bigint;
  readonly calculationHash: string;
  readonly replayed: boolean;
  readonly createdAt: string;
}

function serializeCalculation(calculation: TaxCalculation): Record<string, unknown> {
  return {
    ...calculation,
    net: { ...calculation.net, amountMinor: calculation.net.amountMinor.toString() },
    tax: { ...calculation.tax, amountMinor: calculation.tax.amountMinor.toString() },
    gross: { ...calculation.gross, amountMinor: calculation.gross.amountMinor.toString() },
    components: calculation.components.map((component) => ({
      ...component,
      rateBasisPoints: component.rateBasisPoints.toString(),
      taxableBase: { ...component.taxableBase, amountMinor: component.taxableBase.amountMinor.toString() },
      tax: { ...component.tax, amountMinor: component.tax.amountMinor.toString() },
      recoverableTax: { ...component.recoverableTax, amountMinor: component.recoverableTax.amountMinor.toString() },
      reportingTax: { ...component.reportingTax, amountMinor: component.reportingTax.amountMinor.toString() },
    })),
  };
}

export async function persistTaxSnapshot(
  client: TransactionClient,
  context: RequestContext,
  input: {
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly snapshotId: string;
    readonly calculationHash: string;
    readonly calculation: TaxCalculation;
  },
): Promise<PersistedTaxSnapshot> {
  requirePermission(context, TAX_PERMISSIONS.read);
  if (input.idempotencyKey.length < 8) throw new TypeError("Tax idempotency key is invalid");
  if (!/^[a-f0-9]{64}$/i.test(input.requestHash) || !/^[a-f0-9]{64}$/i.test(input.calculationHash)) throw new TypeError("Tax hashes must be SHA-256 hex digests");
  const result = await client.query<{
    snapshot_id: string;
    source_line_id: string;
    treatment: string;
    currency: string;
    scale: number;
    net_minor: string;
    tax_minor: string;
    gross_minor: string;
    calculation_hash: string;
    replayed: boolean;
    created_at: string;
  }>("SELECT * FROM tax.record_calculation_snapshot($1,$2,$3::uuid,$4,$5::jsonb,$6)", [
    input.idempotencyKey,
    input.requestHash,
    input.snapshotId,
    input.calculationHash,
    JSON.stringify(serializeCalculation(input.calculation)),
    context.requestId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error("Tax calculation snapshot returned no row");
  return Object.freeze({
    snapshotId: row.snapshot_id,
    sourceLineId: row.source_line_id,
    treatment: row.treatment,
    currency: row.currency,
    scale: row.scale,
    netMinor: BigInt(row.net_minor),
    taxMinor: BigInt(row.tax_minor),
    grossMinor: BigInt(row.gross_minor),
    calculationHash: row.calculation_hash,
    replayed: row.replayed,
    createdAt: row.created_at,
  });
}
