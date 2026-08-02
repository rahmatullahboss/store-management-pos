import test from "node:test";
import assert from "node:assert/strict";
import { formatStorefrontMoneyV1 } from "../../build/apps/storefront-web/src/index.js";
import {
  StorefrontContractError,
  parseStorefrontProductCardV1,
} from "../../build/packages/storefront-contracts/src/index.js";

const publishedProduct = {
  contractVersion: "storefront-product-card.v1",
  productId: "product-1",
  variantId: "variant-1",
  slug: "linen-shirt",
  name: "Linen Shirt",
  publicationState: "published",
  availability: "available",
  pricePrefix: "none",
  price: { currency: "GBP", minor: "125050", scale: 2 },
  compareAtPrice: { currency: "GBP", minor: "150000", scale: 2 },
  media: {
    src: "https://media.example.com/products/linen-shirt.webp",
    alt: "Natural linen shirt",
    width: 800,
    height: 1000,
  },
  badge: "New",
};

test("published product card parses exact public presentation fields", () => {
  const product = parseStorefrontProductCardV1(publishedProduct);
  assert.equal(product.publicationState, "published");
  assert.equal(product.price.minor, "125050");
  assert.equal(product.compareAtPrice?.minor, "150000");
  assert.equal(product.media?.alt, "Natural linen shirt");
  assert.equal(product.availability, "available");
});

test("non-published product states never enter the public card contract", () => {
  for (const publicationState of [
    "draft",
    "scheduled",
    "hidden",
    "archived",
  ]) {
    assert.throws(
      () =>
        parseStorefrontProductCardV1({
          ...publishedProduct,
          publicationState,
        }),
      StorefrontContractError,
    );
  }
});

test("product card rejects unsafe slugs and media sources", () => {
  for (const slug of ["../secret", "product/item", "product item", "#item"]) {
    assert.throws(() =>
      parseStorefrontProductCardV1({ ...publishedProduct, slug }),
    );
  }
  for (const src of [
    "http://media.example.com/item.webp",
    "https://user:secret@media.example.com/item.webp",
    "https://media.example.com/item.webp#private",
    "//media.example.com/item.webp",
    "/products\\item.webp",
  ]) {
    assert.throws(() =>
      parseStorefrontProductCardV1({
        ...publishedProduct,
        media: { ...publishedProduct.media, src },
      }),
    );
  }
});

test("product card rejects negative and incompatible compare-at prices", () => {
  assert.throws(() =>
    parseStorefrontProductCardV1({
      ...publishedProduct,
      price: { currency: "GBP", minor: "-1", scale: 2 },
    }),
  );
  assert.throws(() =>
    parseStorefrontProductCardV1({
      ...publishedProduct,
      compareAtPrice: { currency: "EUR", minor: "150000", scale: 2 },
    }),
  );
  assert.throws(() =>
    parseStorefrontProductCardV1({
      ...publishedProduct,
      compareAtPrice: { currency: "GBP", minor: "1500000", scale: 3 },
    }),
  );
});

test("media alt text falls back to the validated product name", () => {
  const product = parseStorefrontProductCardV1({
    ...publishedProduct,
    media: { ...publishedProduct.media, alt: "" },
  });
  assert.equal(product.media?.alt, "Linen Shirt");
});

test("bounded public text rejects controls and oversized badges", () => {
  assert.throws(() =>
    parseStorefrontProductCardV1({
      ...publishedProduct,
      name: "Unsafe\u0000name",
    }),
  );
  assert.throws(() =>
    parseStorefrontProductCardV1({
      ...publishedProduct,
      badge: "x".repeat(81),
    }),
  );
});

test("exact money formatting never converts minor units to floating point", () => {
  assert.equal(
    formatStorefrontMoneyV1(
      { currency: "GBP", minor: "125050", scale: 2 },
      "en-GB",
    ),
    "£1,250.50",
  );
  assert.equal(
    formatStorefrontMoneyV1(
      {
        currency: "GBP",
        minor: "900719925474099312345",
        scale: 2,
      },
      "en-GB",
    ),
    "£9,007,199,254,740,993,123.45",
  );
  assert.equal(
    formatStorefrontMoneyV1(
      { currency: "GBP", minor: "-250", scale: 2 },
      "en-GB",
    ),
    "-£2.50",
  );
});
