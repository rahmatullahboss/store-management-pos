import { assertUuid, type Brand } from "../../../packages/foundation/src/index.js";

export type ProductId = Brand<string, "ProductId">;
export type VariantId = Brand<string, "VariantId">;
export type CategoryId = Brand<string, "CategoryId">;
export type BrandId = Brand<string, "CatalogBrandId">;
export type AttributeDefinitionId = Brand<string, "AttributeDefinitionId">;
export type UnitDefinitionId = Brand<string, "UnitDefinitionId">;

export type ProductStatus = "draft" | "active" | "inactive" | "archived";
export type ProductKind = "stock" | "service" | "bundle" | "non_stock";
export type BarcodeSymbology = "EAN13" | "EAN8" | "UPC_A" | "UPC_E" | "CODE128" | "QR" | "INTERNAL";
export type TrackingMode = "none" | "serial" | "batch" | "batch_expiry";

export interface LocalizedText {
  readonly locale: string;
  readonly name: string;
  readonly description?: string;
  readonly searchKeywords?: readonly string[];
}

export interface ProductAttributeValue {
  readonly definitionId: AttributeDefinitionId;
  readonly code: string;
  readonly label: string;
  readonly sortOrder: number;
}

export interface ProductBarcode {
  readonly value: string;
  readonly normalizedValue: string;
  readonly symbology: BarcodeSymbology;
  readonly isPrimary: boolean;
  readonly unitCode?: string;
}

export interface ProductMedia {
  readonly id: string;
  readonly url: string;
  readonly altText: string;
  readonly sortOrder: number;
  readonly variantId?: VariantId;
}

export interface SupplierReference {
  readonly supplierId: string;
  readonly supplierSku: string;
  readonly supplierName?: string;
  readonly minimumOrderQuantityMinor?: bigint;
  readonly quantityScale?: number;
}

export interface VariantInput {
  readonly id: string;
  readonly sku: string;
  readonly title: string;
  readonly attributeValues: readonly ProductAttributeValue[];
  readonly barcodes?: readonly Omit<ProductBarcode, "normalizedValue">[];
  readonly unitCode: string;
  readonly trackingMode?: TrackingMode;
  readonly weightMinor?: bigint;
  readonly weightScale?: number;
  readonly supplierReferences?: readonly SupplierReference[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ProductInput {
  readonly id: string;
  readonly code: string;
  readonly kind: ProductKind;
  readonly status?: ProductStatus;
  readonly defaultLocale: string;
  readonly localized: readonly LocalizedText[];
  readonly categoryIds?: readonly string[];
  readonly brandId?: string;
  readonly tags?: readonly string[];
  readonly taxCode?: string;
  readonly variants: readonly VariantInput[];
  readonly media?: readonly ProductMedia[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CatalogVariant {
  readonly id: VariantId;
  readonly productId: ProductId;
  readonly sku: string;
  readonly normalizedSku: string;
  readonly title: string;
  readonly combinationKey: string;
  readonly attributeValues: readonly ProductAttributeValue[];
  readonly barcodes: readonly ProductBarcode[];
  readonly unitCode: string;
  readonly trackingMode: TrackingMode;
  readonly weightMinor?: bigint;
  readonly weightScale?: number;
  readonly supplierReferences: readonly SupplierReference[];
  readonly metadata: Readonly<Record<string, string>>;
}

export interface CatalogProduct {
  readonly id: ProductId;
  readonly code: string;
  readonly normalizedCode: string;
  readonly kind: ProductKind;
  readonly status: ProductStatus;
  readonly defaultLocale: string;
  readonly localized: readonly LocalizedText[];
  readonly categoryIds: readonly CategoryId[];
  readonly brandId?: BrandId;
  readonly tags: readonly string[];
  readonly taxCode?: string;
  readonly variants: readonly CatalogVariant[];
  readonly media: readonly ProductMedia[];
  readonly metadata: Readonly<Record<string, string>>;
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,63}$/;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,95}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const BARCODE_PATTERN = /^[A-Z0-9][A-Z0-9 ._+/-]{2,127}$/;

export function productId(value: string): ProductId {
  return assertUuid(value, "productId") as ProductId;
}

export function variantId(value: string): VariantId {
  return assertUuid(value, "variantId") as VariantId;
}

export function categoryId(value: string): CategoryId {
  return assertUuid(value, "categoryId") as CategoryId;
}

export function brandId(value: string): BrandId {
  return assertUuid(value, "brandId") as BrandId;
}

export function normalizeCatalogCode(value: string): string {
  const normalized = value.trim().toUpperCase().replaceAll(/\s+/g, "-");
  if (!CODE_PATTERN.test(normalized)) throw new TypeError("Product code is invalid");
  return normalized;
}

export function normalizeSku(value: string): string {
  const normalized = value.trim().toUpperCase().replaceAll(/\s+/g, "-");
  if (!SKU_PATTERN.test(normalized)) throw new TypeError("SKU is invalid");
  return normalized;
}

export function normalizeBarcode(value: string, symbology: BarcodeSymbology): string {
  const normalized = value.trim().toUpperCase();
  if (!BARCODE_PATTERN.test(normalized)) throw new TypeError("Barcode is invalid");
  if (symbology === "EAN13" && !/^\d{13}$/.test(normalized)) throw new TypeError("EAN13 barcode must contain 13 digits");
  if (symbology === "EAN8" && !/^\d{8}$/.test(normalized)) throw new TypeError("EAN8 barcode must contain 8 digits");
  if (symbology === "UPC_A" && !/^\d{12}$/.test(normalized)) throw new TypeError("UPC-A barcode must contain 12 digits");
  if (symbology === "UPC_E" && !/^\d{6,8}$/.test(normalized)) throw new TypeError("UPC-E barcode must contain 6 to 8 digits");
  return normalized;
}

export function variantCombinationKey(values: readonly ProductAttributeValue[]): string {
  const sorted = [...values]
    .map((value) => ({ definition: value.definitionId.toLowerCase(), code: normalizeCatalogCode(value.code) }))
    .sort((left, right) => left.definition.localeCompare(right.definition) || left.code.localeCompare(right.code));
  const definitions = new Set(sorted.map((value) => value.definition));
  if (definitions.size !== sorted.length) throw new TypeError("A variant cannot contain two values for one attribute definition");
  return sorted.length === 0 ? "default" : sorted.map((value) => `${value.definition}:${value.code}`).join("|");
}

export function createCatalogProduct(input: ProductInput): CatalogProduct {
  const id = productId(input.id);
  const normalizedCode = normalizeCatalogCode(input.code);
  if (!LOCALE_PATTERN.test(input.defaultLocale)) throw new TypeError("Default locale is invalid");
  if (input.localized.length === 0) throw new TypeError("At least one localized product name is required");
  const locales = new Set<string>();
  for (const text of input.localized) {
    if (!LOCALE_PATTERN.test(text.locale)) throw new TypeError(`Locale is invalid: ${text.locale}`);
    if (text.name.trim().length === 0 || text.name.length > 240) throw new TypeError("Localized product name is invalid");
    const locale = text.locale.toLowerCase();
    if (locales.has(locale)) throw new TypeError(`Duplicate localized entry: ${text.locale}`);
    locales.add(locale);
  }
  if (!locales.has(input.defaultLocale.toLowerCase())) throw new TypeError("Default locale must have a localized product entry");
  if (input.variants.length === 0) throw new TypeError("At least one variant is required");

  const skuSet = new Set<string>();
  const combinationSet = new Set<string>();
  const barcodeSet = new Set<string>();
  const variants = input.variants.map((variant): CatalogVariant => {
    const normalizedSku = normalizeSku(variant.sku);
    if (skuSet.has(normalizedSku)) throw new TypeError(`Duplicate SKU: ${normalizedSku}`);
    skuSet.add(normalizedSku);
    const combinationKey = variantCombinationKey(variant.attributeValues);
    if (combinationSet.has(combinationKey)) throw new TypeError(`Duplicate variant combination: ${combinationKey}`);
    combinationSet.add(combinationKey);
    if (variant.title.trim().length === 0 || variant.title.length > 240) throw new TypeError("Variant title is invalid");
    if (!CODE_PATTERN.test(variant.unitCode.trim().toUpperCase())) throw new TypeError("Variant unit code is invalid");
    if ((variant.weightMinor === undefined) !== (variant.weightScale === undefined)) throw new TypeError("Weight minor value and scale must be supplied together");
    if (variant.weightMinor !== undefined && variant.weightMinor < 0n) throw new RangeError("Variant weight cannot be negative");
    if (variant.weightScale !== undefined && (!Number.isInteger(variant.weightScale) || variant.weightScale < 0 || variant.weightScale > 18)) throw new RangeError("Weight scale is invalid");
    let primaryCount = 0;
    const barcodes = (variant.barcodes ?? []).map((barcode): ProductBarcode => {
      const normalizedValue = normalizeBarcode(barcode.value, barcode.symbology);
      if (barcodeSet.has(normalizedValue)) throw new TypeError(`Duplicate barcode: ${normalizedValue}`);
      barcodeSet.add(normalizedValue);
      if (barcode.isPrimary) primaryCount += 1;
      return Object.freeze({ ...barcode, normalizedValue });
    });
    if (primaryCount > 1) throw new TypeError(`Variant ${normalizedSku} has multiple primary barcodes`);
    return Object.freeze({
      id: variantId(variant.id),
      productId: id,
      sku: variant.sku.trim(),
      normalizedSku,
      title: variant.title.trim(),
      combinationKey,
      attributeValues: Object.freeze([...variant.attributeValues]),
      barcodes: Object.freeze(barcodes),
      unitCode: variant.unitCode.trim().toUpperCase(),
      trackingMode: variant.trackingMode ?? "none",
      ...(variant.weightMinor === undefined ? {} : { weightMinor: variant.weightMinor }),
      ...(variant.weightScale === undefined ? {} : { weightScale: variant.weightScale }),
      supplierReferences: Object.freeze([...(variant.supplierReferences ?? [])]),
      metadata: Object.freeze({ ...(variant.metadata ?? {}) }),
    });
  });

  return Object.freeze({
    id,
    code: input.code.trim(),
    normalizedCode,
    kind: input.kind,
    status: input.status ?? "draft",
    defaultLocale: input.defaultLocale,
    localized: Object.freeze([...input.localized]),
    categoryIds: Object.freeze((input.categoryIds ?? []).map(categoryId)),
    ...(input.brandId === undefined ? {} : { brandId: brandId(input.brandId) }),
    tags: Object.freeze([...new Set((input.tags ?? []).map((tag) => normalizeCatalogCode(tag)))]),
    ...(input.taxCode === undefined ? {} : { taxCode: normalizeCatalogCode(input.taxCode) }),
    variants: Object.freeze(variants),
    media: Object.freeze([...(input.media ?? [])]),
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  });
}

export function productDisplayName(product: CatalogProduct, locale: string): string {
  const requested = locale.toLowerCase();
  return product.localized.find((text) => text.locale.toLowerCase() === requested)?.name
    ?? product.localized.find((text) => text.locale.toLowerCase() === product.defaultLocale.toLowerCase())?.name
    ?? product.code;
}
