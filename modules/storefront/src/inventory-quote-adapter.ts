import type { QuantityV1 } from "../../../packages/contracts/src/v1/common.js";
import type {
  CatalogItemReferenceV1,
  StockAvailabilityV1,
} from "../../../packages/contracts/src/v1/contracts.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import type {
  StorefrontInventoryQuoteEvidenceV1,
  StorefrontInventoryQuotePort,
  StorefrontQuotePrincipalV1,
} from "./authoritative-quote.js";

export interface StorefrontWarehouseScopePort {
  resolve(input: {
    readonly tenantId: string;
    readonly storefrontId: string;
    readonly salesChannelId: string;
    readonly legalEntityId: string;
    readonly storeId: string;
  }): Promise<readonly string[]>;
}

export interface StorefrontStockAvailabilityPort {
  availability(input: {
    readonly principal: StorefrontQuotePrincipalV1;
    readonly item: CatalogItemReferenceV1;
    readonly warehouseId: string;
    readonly quantity: QuantityV1;
  }): Promise<StockAvailabilityV1>;
}

export interface StorefrontInventoryQuoteAdapterDependencies {
  readonly warehouses: StorefrontWarehouseScopePort;
  readonly stock: StorefrontStockAvailabilityPort;
}

function boundedToken(value: string, label: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function exactQuantityBaseUnits(quantity: QuantityV1, targetScale: number): bigint {
  const amount = BigInt(quantity.amount);
  if (amount < 0n) {
    throw new StorefrontContractError("Inventory quantity cannot be negative.");
  }
  if (!Number.isInteger(quantity.scale) || quantity.scale < 0 || quantity.scale > 6) {
    throw new StorefrontContractError("Inventory quantity scale is invalid.");
  }
  if (quantity.scale > targetScale) {
    const divisor = 10n ** BigInt(quantity.scale - targetScale);
    if (amount % divisor !== 0n) {
      throw new StorefrontContractError(
        "Inventory quantity cannot be represented at the requested scale.",
      );
    }
    return amount / divisor;
  }
  return amount * 10n ** BigInt(targetScale - quantity.scale);
}

function stableEvidence(value: readonly {
  readonly warehouseId: string;
  readonly version: string;
  readonly availableAmount: string;
  readonly availableScale: number;
}[]): string {
  return JSON.stringify(
    value.map((entry) => ({
      warehouseId: entry.warehouseId,
      version: entry.version,
      availableAmount: entry.availableAmount,
      availableScale: entry.availableScale,
    })),
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function uniqueSortedWarehouseIds(value: readonly string[]): readonly string[] {
  if (value.length < 1 || value.length > 100) {
    throw new StorefrontContractError(
      "Storefront checkout requires between 1 and 100 fulfillment warehouses.",
    );
  }
  const ids = value.map((entry) => boundedToken(entry, "warehouseId"));
  if (new Set(ids).size !== ids.length) {
    throw new StorefrontContractError(
      "Storefront checkout warehouse scope contains duplicates.",
    );
  }
  return Object.freeze([...ids].sort());
}

function validateAvailability(
  availability: StockAvailabilityV1,
  item: CatalogItemReferenceV1,
  warehouseId: string,
  requestedUnit: string,
): void {
  if (
    availability.variantId !== item.variantId ||
    availability.warehouseId !== warehouseId
  ) {
    throw new StorefrontContractError(
      "Canonical inventory availability returned mismatched scope.",
    );
  }
  if (availability.available.unit.trim().toUpperCase() !== requestedUnit) {
    throw new StorefrontContractError(
      "Canonical inventory availability returned a mismatched quantity unit.",
    );
  }
  boundedToken(availability.version, "inventory availability version");
  if (!Number.isFinite(Date.parse(availability.asOf))) {
    throw new StorefrontContractError(
      "Canonical inventory availability returned an invalid observation time.",
    );
  }
}

export function createStorefrontInventoryQuotePort(
  dependencies: StorefrontInventoryQuoteAdapterDependencies,
): StorefrontInventoryQuotePort {
  return Object.freeze({
    async resolve(input): Promise<StorefrontInventoryQuoteEvidenceV1> {
      const legalEntityId = input.principal.requestContext.legalEntityId;
      const storeId = input.principal.requestContext.storeId;
      if (!legalEntityId || !storeId) {
        throw new StorefrontContractError(
          "Canonical inventory quote requires legal entity and store scope.",
        );
      }
      const warehouseIds = uniqueSortedWarehouseIds(
        await dependencies.warehouses.resolve({
          tenantId: input.context.tenantId,
          storefrontId: input.context.storefrontId,
          salesChannelId: input.context.salesChannelId,
          legalEntityId,
          storeId,
        }),
      );
      const requestedUnit = input.quantity.unit.trim().toUpperCase();
      const observations = await Promise.all(
        warehouseIds.map(async (warehouseId) => {
          const availability = await dependencies.stock.availability({
            principal: input.principal,
            item: input.item,
            warehouseId,
            quantity: input.quantity,
          });
          validateAvailability(
            availability,
            input.item,
            warehouseId,
            requestedUnit,
          );
          return availability;
        }),
      );

      const requested = exactQuantityBaseUnits(
        input.quantity,
        input.quantity.scale,
      );
      let available = 0n;
      for (const observation of observations) {
        available += exactQuantityBaseUnits(
          observation.available,
          input.quantity.scale,
        );
      }
      const evidencePayload = observations.map((observation) => ({
        warehouseId: observation.warehouseId,
        version: boundedToken(
          observation.version,
          "inventory availability version",
        ),
        availableAmount: observation.available.amount,
        availableScale: observation.available.scale,
      }));
      const version = `mw-${await sha256(stableEvidence(evidencePayload))}`;

      return Object.freeze({
        variantId: input.item.variantId,
        version,
        sufficient: available >= requested,
      });
    },
  });
}
