import test from "node:test";
import assert from "node:assert/strict";
import { quantity } from "../../build/packages/foundation/src/quantity.js";
import {
  createCatalogProduct,
  normalizeBarcode,
  variantCombinationKey,
} from "../../build/modules/catalog/src/model.js";
import {
  convertQuantityExact,
  defineUnit,
  defineUnitConversion,
  resolveEffectiveConversion,
} from "../../build/modules/catalog/src/units.js";
import { CatalogSearchIndex } from "../../build/modules/catalog/src/search.js";
import { executeCatalogImport, exportCatalog, planCatalogImport } from "../../build/modules/catalog/src/import-export.js";

const PRODUCT_ID = "018f0000-0000-7000-8000-000000000001";
const VARIANT_BLUE_ID = "018f0000-0000-7000-8000-000000000002";
const VARIANT_RED_ID = "018f0000-0000-7000-8000-000000000003";
const ATTRIBUTE_ID = "018f0000-0000-7000-8000-000000000004";

function productInput(overrides = {}) {
  return {
    id: PRODUCT_ID,
    code: "shirt-001",
    kind: "stock",
    status: "active",
    defaultLocale: "en-GB",
    localized: [
      { locale: "en-GB", name: "Oxford Shirt", description: "Cotton formal shirt", searchKeywords: ["office", "formal"] },
      { locale: "bn-BD", name: "অক্সফোর্ড শার্ট", description: "সুতির ফরমাল শার্ট" },
    ],
    tags: ["menswear", "formal"],
    taxCode: "standard",
    variants: [
      {
        id: VARIANT_BLUE_ID,
        sku: "shirt-blue-m",
        title: "Blue / Medium",
        unitCode: "EA",
        attributeValues: [{ definitionId: ATTRIBUTE_ID, code: "blue", label: "Blue", sortOrder: 1 }],
        barcodes: [{ value: "1234567890128", symbology: "EAN13", isPrimary: true }],
      },
      {
        id: VARIANT_RED_ID,
        sku: "shirt-red-m",
        title: "Red / Medium",
        unitCode: "EA",
        attributeValues: [{ definitionId: ATTRIBUTE_ID, code: "red", label: "Red", sortOrder: 1 }],
        barcodes: [{ value: "1234567890135", symbology: "EAN13", isPrimary: true }],
      },
    ],
    ...overrides,
  };
}

test("catalog aggregate normalizes identifiers and rejects duplicate combinations", () => {
  const product = createCatalogProduct(productInput());
  assert.equal(product.normalizedCode, "SHIRT-001");
  assert.equal(product.variants[0].normalizedSku, "SHIRT-BLUE-M");
  assert.equal(product.variants[0].barcodes[0].normalizedValue, "1234567890128");
  assert.match(variantCombinationKey(product.variants[0].attributeValues), /BLUE/);
  assert.equal(normalizeBarcode(" 1234567890128 ", "EAN13"), "1234567890128");

  assert.throws(() => createCatalogProduct(productInput({
    variants: [productInput().variants[0], { ...productInput().variants[1], attributeValues: productInput().variants[0].attributeValues }],
  })), /Duplicate variant combination/);
});

test("versioned unit conversions preserve exact quantities", () => {
  assert.equal(defineUnit({ code: "KG", name: "Kilogram", dimension: "mass", decimalScale: 3, isBaseUnit: true }).code, "KG");
  const conversion = defineUnitConversion({
    id: "conv-kg-g-v1",
    fromUnit: "KG",
    toUnit: "G",
    numerator: 1_000n,
    denominator: 1n,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    version: 1n,
  });
  const grams = convertQuantityExact(quantity(1_250n, "KG", 3), conversion, 0);
  assert.equal(grams.amount, 1_250n);
  assert.equal(grams.unit, "G");
  assert.equal(resolveEffectiveConversion([conversion], "KG", "G", "2026-07-28T00:00:00.000Z"), conversion);
  const fractional = defineUnitConversion({
    id: "conv-pack-ea-v1",
    fromUnit: "PACK",
    toUnit: "EA",
    numerator: 1n,
    denominator: 3n,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    version: 1n,
  });
  assert.throws(() => convertQuantityExact(quantity(1n, "PACK", 0), fractional, 0), /cannot be represented exactly/);
});

test("catalog search prioritizes exact barcode, SKU and localized tokens", () => {
  const product = createCatalogProduct(productInput());
  const index = new CatalogSearchIndex();
  index.upsertProduct(product, "bn-BD");
  assert.equal(index.size, 2);
  assert.equal(index.search("1234567890128")[0].document.variantId, VARIANT_BLUE_ID);
  assert.equal(index.search("SHIRT-RED-M")[0].document.variantId, VARIANT_RED_ID);
  assert.equal(index.search("অক্সফোর্ড").length, 2);
  assert.equal(index.search("form").length, 2);
});

test("catalog import plans before writes and exports deterministic JSONL", async () => {
  const plan = await planCatalogImport([{ rowNumber: 1, product: productInput() }]);
  assert.equal(plan.canExecute, true);
  assert.equal(plan.accepted.length, 1);
  assert.equal(plan.sourceHash.length, 64);
  const inserted = [];
  const result = await executeCatalogImport("import-20260728", plan, { insert: async (product) => inserted.push(product.id) }, new Date("2026-07-28T10:00:00.000Z"));
  assert.deepEqual(inserted, [PRODUCT_ID]);
  assert.equal(result.insertedVariantIds.length, 2);
  const exported = exportCatalog(plan.accepted);
  assert.equal(exported.trim().split("\n").length, 2);
  assert.match(exported, /SHIRT-BLUE-M/);

  const invalid = await planCatalogImport([
    { rowNumber: 1, product: productInput() },
    { rowNumber: 2, product: productInput({ id: "018f0000-0000-7000-8000-000000000005" }) },
  ]);
  assert.equal(invalid.canExecute, false);
  assert.match(invalid.issues[0].message, /Duplicate product code/);
});
