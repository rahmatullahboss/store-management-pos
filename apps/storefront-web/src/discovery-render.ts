import type {
  StorefrontPublicProductV1,
  StorefrontPublicVariantV1,
} from "../../../packages/storefront-contracts/src/public-catalog.js";
import type {
  StorefrontPublicCategoryPageV1,
  StorefrontPublicCollectionPageV1,
  StorefrontPublicSearchPageV1,
} from "../../../packages/storefront-contracts/src/public-discovery.js";
import { formatStorefrontMoneyV1 } from "./money.js";

export interface StorefrontDiscoveryRenderInput {
  readonly category?: StorefrontPublicCategoryPageV1;
  readonly collection?: StorefrontPublicCollectionPageV1;
  readonly search?: StorefrontPublicSearchPageV1;
}

export interface StorefrontDiscoveryRenderModel {
  readonly title: string;
  readonly description: string;
  readonly html: string;
  readonly cacheScope: string;
}

const AVAILABILITY_LABELS: Record<StorefrontPublicVariantV1["availability"], string> = {
  available: "Available",
  limited: "Limited availability",
  unavailable: "Unavailable",
  preorder: "Available for preorder",
  unknown: "Availability pending",
};
const DISCOVERY_RESPONSIVE_STYLE =
  '<style>.header-row{flex-wrap:wrap}.nav{min-width:0}.nav>ul{flex-wrap:wrap}</style>';

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAvailability(
  value: StorefrontPublicVariantV1["availability"],
): string {
  return `<span class="availability availability-${value}">${escapeHtml(AVAILABILITY_LABELS[value])}</span>`;
}

function renderPrice(product: StorefrontPublicProductV1, locale: string): string {
  const prefix = product.summary.pricePrefix === "from" ? "From " : "";
  const compare = product.summary.compareAtPrice
    ? `<del>${escapeHtml(formatStorefrontMoneyV1(product.summary.compareAtPrice, locale))}</del>`
    : "";
  return `<p class="price">${prefix}<strong>${escapeHtml(formatStorefrontMoneyV1(product.summary.price, locale))}</strong>${compare}</p>`;
}

function renderProductCard(product: StorefrontPublicProductV1, locale: string): string {
  const summary = product.summary;
  return `<article class="product-card"><a class="product-link" href="/products/${encodeURIComponent(summary.slug)}"><div class="product-media" aria-hidden="true"><span>${escapeHtml(summary.name.slice(0, 1).toUpperCase())}</span></div><div class="product-copy">${summary.badge ? `<p class="badge">${escapeHtml(summary.badge)}</p>` : ""}<h2>${escapeHtml(summary.name)}</h2>${renderPrice(product, locale)}${renderAvailability(summary.availability)}<p class="tax-note">Tax calculated at checkout.</p></div></a></article>`;
}

function renderProducts(
  items: readonly StorefrontPublicProductV1[],
  locale: string,
  emptyTitle: string,
  emptyDescription: string,
): string {
  if (items.length === 0) {
    return `<section class="empty-state" aria-labelledby="discovery-empty-title"><h2 id="discovery-empty-title">${escapeHtml(emptyTitle)}</h2><p>${escapeHtml(emptyDescription)}</p></section>`;
  }
  return `<div class="product-grid">${items.map((product) => renderProductCard(product, locale)).join("")}</div>`;
}

function pagination(
  basePath: string,
  cursor: string | null,
  query?: string,
): string {
  if (!cursor) return "";
  const target = new URL(basePath, "https://storefront.invalid");
  if (query) target.searchParams.set("q", query);
  target.searchParams.set("cursor", cursor);
  return `<nav class="pagination" aria-label="Results pagination"><a class="button-link" href="${escapeHtml(`${target.pathname}${target.search}`)}">Next products</a></nav>`;
}

function categoryModel(
  page: StorefrontPublicCategoryPageV1,
): StorefrontDiscoveryRenderModel {
  const category = page.category;
  const breadcrumbs = category.breadcrumbs
    .map((entry, index) => {
      const current = index === category.breadcrumbs.length - 1;
      return current
        ? `<span aria-current="page">${escapeHtml(entry.title)}</span>`
        : `<a href="/categories/${encodeURIComponent(entry.slug)}">${escapeHtml(entry.title)}</a>`;
    })
    .join('<span aria-hidden="true">/</span>');
  const children = category.children.length === 0
    ? ""
    : `<nav class="discovery-children" aria-label="Subcategories"><h2>Explore subcategories</h2><ul>${category.children.map((entry) => `<li><a href="/categories/${encodeURIComponent(entry.slug)}">${escapeHtml(entry.title)}</a></li>`).join("")}</ul></nav>`;
  const description = category.description ?? `Published products in ${category.title}.`;
  const html = `${DISCOVERY_RESPONSIVE_STYLE}<section class="catalog-page" aria-labelledby="category-title"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/products">Products</a><span aria-hidden="true">/</span>${breadcrumbs}</nav><header class="page-heading"><p class="eyebrow">Published category</p><h1 id="category-title">${escapeHtml(category.title)}</h1><p>${escapeHtml(description)}</p></header>${children}${renderProducts(page.items, page.context.locale, "No published products in this category", "Only actively priced products explicitly published to this category appear here.")}${pagination(`/categories/${encodeURIComponent(category.slug)}`, page.nextCursor)}</section>`;
  return Object.freeze({
    title: category.title,
    description,
    html,
    cacheScope: `category:${category.categoryId}:${page.nextCursor ?? "end"}`,
  });
}

function collectionModel(
  page: StorefrontPublicCollectionPageV1,
): StorefrontDiscoveryRenderModel {
  const collection = page.collection;
  const description = collection.description ?? `Published products in ${collection.title}.`;
  const html = `${DISCOVERY_RESPONSIVE_STYLE}<section class="catalog-page" aria-labelledby="collection-title"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/products">Products</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(collection.title)}</span></nav><header class="page-heading"><p class="eyebrow">Curated collection</p><h1 id="collection-title">${escapeHtml(collection.title)}</h1><p>${escapeHtml(description)}</p></header>${renderProducts(page.items, page.context.locale, "No published products in this collection", "The collection remains visible, but no active priced products currently qualify for public display.")}${pagination(`/collections/${encodeURIComponent(collection.slug)}`, page.nextCursor)}</section>`;
  return Object.freeze({
    title: collection.title,
    description,
    html,
    cacheScope: `collection:${collection.collectionId}:${collection.version}:${page.nextCursor ?? "end"}`,
  });
}

function searchModel(page: StorefrontPublicSearchPageV1): StorefrontDiscoveryRenderModel {
  const description = `${page.items.length} published result${page.items.length === 1 ? "" : "s"} shown for ${page.query}.`;
  const categoryFacets = page.facets.categories.length === 0
    ? ""
    : `<section aria-labelledby="category-facets-title"><h2 id="category-facets-title">Categories</h2><ul>${page.facets.categories.map((facet) => `<li><a href="/categories/${encodeURIComponent(facet.slug)}">${escapeHtml(facet.title)} <span>(${facet.count})</span></a></li>`).join("")}</ul></section>`;
  const availabilityFacets = page.facets.availability.length === 0
    ? ""
    : `<section aria-labelledby="availability-facets-title"><h2 id="availability-facets-title">Availability</h2><ul>${page.facets.availability.map((facet) => `<li>${escapeHtml(AVAILABILITY_LABELS[facet.value])} <span>(${facet.count})</span></li>`).join("")}</ul></section>`;
  const facets = categoryFacets || availabilityFacets
    ? `<aside class="discovery-facets" aria-label="Search result facets">${categoryFacets}${availabilityFacets}</aside>`
    : "";
  const html = `${DISCOVERY_RESPONSIVE_STYLE}<section class="catalog-page" aria-labelledby="search-title"><header class="page-heading"><p class="eyebrow">Storefront search</p><h1 id="search-title">Results for “${escapeHtml(page.query)}”</h1><p>${escapeHtml(description)}</p><form class="search" action="/search" method="get" role="search"><input id="discovery-search" name="q" type="search" autocomplete="off" aria-label="Search products" value="${escapeHtml(page.query)}"><button type="submit">Search</button></form></header><div class="discovery-layout">${facets}<div>${renderProducts(page.items, page.context.locale, "No published products matched", "Try a different product name, code, SKU or keyword.")}${pagination("/search", page.nextCursor, page.query)}</div></div></section>`;
  return Object.freeze({
    title: `Search: ${page.query}`,
    description,
    html,
    cacheScope: `search:${page.query.toLowerCase()}:${page.nextCursor ?? "end"}`,
  });
}

export function renderStorefrontDiscovery(
  input: StorefrontDiscoveryRenderInput,
): StorefrontDiscoveryRenderModel | null {
  if (input.category) return categoryModel(input.category);
  if (input.collection) return collectionModel(input.collection);
  if (input.search) return searchModel(input.search);
  return null;
}
