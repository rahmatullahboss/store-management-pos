import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import type { CatalogItemReferenceV1 } from "../../../packages/contracts/src/v1/contracts.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import type { StorefrontPublishedCartItemPort } from "./authoritative-quote.js";

interface PublishedCartItemRow extends Record<string, unknown> {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string | null;
  readonly displayName: string | null;
}

export class SqlStorefrontPublishedCartItemPort
  implements StorefrontPublishedCartItemPort
{
  public constructor(private readonly database: NeonDatabase) {}

  public async resolve(input: Parameters<StorefrontPublishedCartItemPort["resolve"]>[0]): Promise<CatalogItemReferenceV1 | null> {
    const rows = await this.database.httpQuery<PublishedCartItemRow>(
      `SELECT
        document.product_id::text AS "productId",
        variant.value ->> 'variantId' AS "variantId",
        NULLIF(trim(variant.value ->> 'sku'), '') AS "sku",
        NULLIF(trim(document.product_document -> 'summary' ->> 'name'), '') AS "displayName"
      FROM storefront.compose_public_product_documents(
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::text,
        $5::text
      ) document
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(document.product_document -> 'variants', '[]'::jsonb)
      ) variant(value)
      WHERE document.product_id = $6::uuid
        AND variant.value ->> 'variantId' = $7::text
      LIMIT 2`,
      [
        input.context.tenantId,
        input.context.storefrontId,
        input.context.salesChannelId,
        input.context.locale,
        input.context.currency,
        input.productId,
        input.variantId,
      ],
    );
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw new StorefrontContractError(
        "Published storefront cart item resolution returned duplicate rows.",
      );
    }
    const row = rows[0]!;
    if (row.productId !== input.productId || row.variantId !== input.variantId) {
      throw new StorefrontContractError(
        "Published storefront cart item resolution returned mismatched identity.",
      );
    }
    return Object.freeze({
      itemId: row.productId,
      variantId: row.variantId,
      ...(row.sku ? { sku: row.sku } : {}),
      ...(row.displayName ? { displayNameSnapshot: row.displayName } : {}),
    });
  }
}
