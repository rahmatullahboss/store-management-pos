import type { ConnectorConnectionV1, ConnectorFieldMappingV1, ConnectorSyncOutcomeV1 } from "./contracts.js";
import type { ConnectorAdapterPort, ConnectorPageV1, ConnectorRecordV1 } from "./workers.js";

type ConnectorReadRequestV1 = Parameters<ConnectorAdapterPort["read"]>[0];

const PATH_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;
const SHOPIFY_VERSION_PATTERN = /^20[2-9][0-9]-(?:01|04|07|10)$/u;
const SHOPIFY_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u;
const CSV_CURSOR_PATTERN = /^csv_row_([0-9a-z]{8,16})$/u;
const MAX_CONNECTOR_RECORDS = 1_000;

export class RetryableConnectorProviderError extends Error {
  override readonly name = "RetryableConnectorProviderError";

  constructor(readonly category: string, message: string) {
    super(message);
  }
}

export class PermanentConnectorProviderError extends Error {
  override readonly name = "PermanentConnectorProviderError";

  constructor(readonly category: string, message: string) {
    super(message);
  }
}

export interface ConnectorCredentialPort {
  headersFor(input: {
    readonly providerKey: string;
    readonly credentialReference: string;
  }): Promise<Readonly<Record<string, string>>>;
}

export interface ConnectorHttpTransportPort {
  request(input: {
    readonly method: "GET" | "POST";
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: Uint8Array;
  }): Promise<{
    readonly statusCode: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
  }>;
}

export interface CsvObjectSourcePort {
  load(input: {
    readonly connection: ConnectorConnectionV1;
    readonly objectReference: string;
  }): Promise<Uint8Array>;
}

export interface GenericCsvConnectorConfigV1 {
  readonly schemaVersion: "1.0";
  readonly resourceType: string;
  readonly objectReference: string;
  readonly externalIdColumn: string;
  readonly delimiter?: "," | ";" | "\t" | "|";
  readonly maxBytes?: number;
  readonly maxColumns?: number;
  readonly maxCellCharacters?: number;
}

export interface GenericRestConnectorConfigV1 {
  readonly schemaVersion: "1.0";
  readonly resourceType: string;
  readonly baseUrl: string;
  readonly path: string;
  readonly itemsPointer: string;
  readonly externalIdPointer: string;
  readonly nextCursorPointer?: string;
  readonly cursorQueryParameter?: string;
  readonly limitQueryParameter?: string;
  readonly staticQuery?: Readonly<Record<string, string>>;
  readonly maxResponseBytes?: number;
}

export interface ShopifyProductConnectorConfigV1 {
  readonly schemaVersion: "1.0";
  readonly resourceType: "product";
  readonly shopDomain: string;
  readonly apiVersion: string;
  readonly query?: string;
  readonly maxResponseBytes?: number;
}

function assertPlainObject(value: unknown, field: string): asserts value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
}

function assertBoundedPositiveInteger(value: number, field: string, maximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new RangeError(`${field} must be between 1 and ${maximum}`);
}

function assertResourceRequest(input: {
  readonly connection: ConnectorConnectionV1;
  readonly expectedConnectorTypes: readonly string[];
  readonly configuredResourceType: string;
  readonly requestedResourceType: string;
  readonly direction: "inbound" | "outbound";
}): void {
  if (!input.expectedConnectorTypes.includes(input.connection.connectorType)) {
    throw new TypeError(`Connector type ${input.connection.connectorType} is not supported by this adapter`);
  }
  if (input.direction !== "inbound") throw new TypeError("This connector adapter currently supports inbound synchronization only");
  if (input.configuredResourceType !== input.requestedResourceType) throw new TypeError("Connector resource type does not match adapter configuration");
}

function parseJson(body: Uint8Array, maximumBytes: number, field: string): unknown {
  if (body.byteLength > maximumBytes) throw new PermanentConnectorProviderError("response_too_large", `${field} exceeded the configured byte limit`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new PermanentConnectorProviderError("response_encoding_invalid", `${field} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PermanentConnectorProviderError("response_json_invalid", `${field} is not valid JSON`);
  }
}

function classifyHttpStatus(statusCode: number, provider: string): void {
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new RetryableConnectorProviderError("response_status_invalid", `${provider} returned an invalid HTTP status`);
  }
  if (statusCode >= 200 && statusCode < 300) return;
  if (statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500) {
    throw new RetryableConnectorProviderError("provider_retryable", `${provider} is temporarily unavailable`);
  }
  if (statusCode === 401 || statusCode === 403) {
    throw new PermanentConnectorProviderError("credential_rejected", `${provider} rejected the configured credential`);
  }
  throw new PermanentConnectorProviderError("provider_rejected", `${provider} rejected the connector request`);
}

function safeHeaders(input: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    const normalized = name.toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/u.test(normalized)) throw new TypeError("Connector credential header name is invalid");
    if (/^(?:host|content-length|connection|transfer-encoding)$/u.test(normalized)) throw new TypeError("Connector credential port attempted to control a restricted header");
    if (value.length === 0 || value.length > 8_192 || /[\r\n]/u.test(value)) throw new TypeError("Connector credential header value is invalid");
    headers[normalized] = value;
  }
  return Object.freeze(headers);
}

function assertJsonPointer(pointer: string, field: string): void {
  if (pointer !== "" && !/^(?:\/(?:[^~/]|~0|~1)*)+$/u.test(pointer)) throw new TypeError(`${field} is not a valid JSON pointer`);
}

function jsonPointer(document: unknown, pointer: string): unknown {
  assertJsonPointer(pointer, "JSON pointer");
  if (pointer === "") return document;
  let current: unknown = document;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

function connectorSyncId(prefix: string, connectionId: string, resourceType: string, externalId: string): string {
  return `${prefix}:${encodeURIComponent(connectionId)}:${encodeURIComponent(resourceType)}:${encodeURIComponent(externalId)}`;
}

function normalizeExternalId(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new PermanentConnectorProviderError("external_id_invalid", `${field} must resolve to a string or integer`);
  }
  const externalId = String(value).trim();
  if (externalId.length === 0 || externalId.length > 1_024) throw new PermanentConnectorProviderError("external_id_invalid", `${field} is empty or too long`);
  return externalId;
}

function csvCursor(offset: number): string {
  return `csv_row_${offset.toString(36).padStart(8, "0")}`;
}

function parseCsvCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = CSV_CURSOR_PATTERN.exec(cursor);
  if (!match?.[1]) throw new TypeError("CSV connector cursor is invalid");
  const offset = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("CSV connector cursor is invalid");
  return offset;
}

function parseCsv(input: string, delimiter: string, maxColumns: number, maxCellCharacters: number): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const pushCell = (): void => {
    if (cell.length > maxCellCharacters) throw new PermanentConnectorProviderError("csv_cell_too_large", "CSV cell exceeded the configured character limit");
    row.push(cell);
    if (row.length > maxColumns) throw new PermanentConnectorProviderError("csv_too_many_columns", "CSV row exceeded the configured column limit");
    cell = "";
  };
  const pushRow = (): void => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      if (cell.length !== 0) throw new PermanentConnectorProviderError("csv_quote_invalid", "CSV quoted cells must begin at the start of a field");
      quoted = true;
    } else if (character === delimiter) {
      pushCell();
    } else if (character === "\n") {
      pushRow();
    } else if (character === "\r") {
      if (input[index + 1] === "\n") index += 1;
      pushRow();
    } else if (character === "\0") {
      throw new PermanentConnectorProviderError("csv_nul_invalid", "CSV input contains a NUL character");
    } else {
      cell += character;
    }
  }
  if (quoted) throw new PermanentConnectorProviderError("csv_quote_unclosed", "CSV input contains an unclosed quoted field");
  if (cell.length > 0 || row.length > 0) pushRow();
  if (rows.at(-1)?.every((value) => value.length === 0) === true) rows.pop();
  return Object.freeze(rows.map((value) => Object.freeze(value)));
}

export function createGenericCsvAdapter(input: {
  readonly source: CsvObjectSourcePort;
  readonly configuration: GenericCsvConnectorConfigV1;
}): ConnectorAdapterPort {
  const delimiter = input.configuration.delimiter ?? ",";
  const maximumBytes = input.configuration.maxBytes ?? 10_000_000;
  const maximumColumns = input.configuration.maxColumns ?? 256;
  const maximumCellCharacters = input.configuration.maxCellCharacters ?? 32_768;
  if (input.configuration.schemaVersion !== "1.0") throw new TypeError("CSV connector configuration version is unsupported");
  if (input.configuration.resourceType.trim().length === 0) throw new TypeError("CSV connector resource type is required");
  if (input.configuration.objectReference.trim().length === 0) throw new TypeError("CSV connector object reference is required");
  if (input.configuration.externalIdColumn.trim().length === 0) throw new TypeError("CSV connector external ID column is required");
  assertBoundedPositiveInteger(maximumBytes, "CSV connector maxBytes", 100_000_000);
  assertBoundedPositiveInteger(maximumColumns, "CSV connector maxColumns", 4_096);
  assertBoundedPositiveInteger(maximumCellCharacters, "CSV connector maxCellCharacters", 1_000_000);

  return Object.freeze({
    async read(request: ConnectorReadRequestV1): Promise<ConnectorPageV1> {
      assertResourceRequest({ connection: request.connection, expectedConnectorTypes: ["csv", "generic_csv"], configuredResourceType: input.configuration.resourceType, requestedResourceType: request.resourceType, direction: request.direction });
      assertBoundedPositiveInteger(request.limit, "CSV connector page size", MAX_CONNECTOR_RECORDS);
      const content = await input.source.load({ connection: request.connection, objectReference: input.configuration.objectReference });
      if (content.byteLength > maximumBytes) throw new PermanentConnectorProviderError("csv_too_large", "CSV object exceeded the configured byte limit");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        throw new PermanentConnectorProviderError("csv_encoding_invalid", "CSV object is not valid UTF-8");
      }
      const rows = parseCsv(text, delimiter, maximumColumns, maximumCellCharacters);
      const headers = rows[0];
      if (headers === undefined || headers.length === 0) throw new PermanentConnectorProviderError("csv_header_missing", "CSV object requires a header row");
      if (headers.some((header) => header.trim().length === 0)) throw new PermanentConnectorProviderError("csv_header_invalid", "CSV headers must be non-empty");
      if (new Set(headers).size !== headers.length) throw new PermanentConnectorProviderError("csv_header_duplicate", "CSV headers must be unique");
      const idIndex = headers.indexOf(input.configuration.externalIdColumn);
      if (idIndex < 0) throw new PermanentConnectorProviderError("csv_external_id_missing", "CSV external ID column is absent from the header");
      const records = rows.slice(1);
      const offset = parseCsvCursor(request.cursor);
      if (offset > records.length) throw new TypeError("CSV connector cursor exceeds the available row count");
      const pageRows = records.slice(offset, offset + request.limit);
      const identities = new Set<string>();
      const pageRecords: ConnectorRecordV1[] = pageRows.map((values, pageIndex) => {
        if (values.length !== headers.length) throw new PermanentConnectorProviderError("csv_column_mismatch", `CSV row ${offset + pageIndex + 2} does not match the header column count`);
        const payload: Record<string, unknown> = {};
        for (const [index, header] of headers.entries()) payload[header] = values[index] ?? "";
        const externalId = normalizeExternalId(values[idIndex], "CSV external ID column");
        if (identities.has(externalId)) throw new PermanentConnectorProviderError("csv_external_id_duplicate", "CSV page contains duplicate external IDs");
        identities.add(externalId);
        return Object.freeze({ syncId: connectorSyncId("csv", request.connection.connectionId, request.resourceType, externalId), externalId, payload: Object.freeze(payload) });
      });
      const nextOffset = offset + pageRecords.length;
      const exhausted = nextOffset >= records.length;
      return Object.freeze({ records: Object.freeze(pageRecords), ...(exhausted ? {} : { nextCursor: csvCursor(nextOffset) }), exhausted });
    },
  });
}

function validateGenericRestConfiguration(configuration: GenericRestConnectorConfigV1): URL {
  if (configuration.schemaVersion !== "1.0") throw new TypeError("REST connector configuration version is unsupported");
  if (configuration.resourceType.trim().length === 0) throw new TypeError("REST connector resource type is required");
  let base: URL;
  try {
    base = new URL(configuration.baseUrl);
  } catch {
    throw new TypeError("REST connector base URL is invalid");
  }
  if (base.protocol !== "https:" || base.username !== "" || base.password !== "" || base.search !== "" || base.hash !== "") throw new TypeError("REST connector base URL must be a credential-free HTTPS origin or base path");
  if (!configuration.path.startsWith("/") || configuration.path.startsWith("//")) throw new TypeError("REST connector path must be absolute and origin-relative");
  assertJsonPointer(configuration.itemsPointer, "REST connector itemsPointer");
  assertJsonPointer(configuration.externalIdPointer, "REST connector externalIdPointer");
  if (configuration.nextCursorPointer !== undefined) assertJsonPointer(configuration.nextCursorPointer, "REST connector nextCursorPointer");
  for (const name of [configuration.cursorQueryParameter ?? "cursor", configuration.limitQueryParameter ?? "limit"]) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name)) throw new TypeError("REST connector query parameter name is invalid");
  }
  return base;
}

export function createGenericRestAdapter(input: {
  readonly transport: ConnectorHttpTransportPort;
  readonly credentials: ConnectorCredentialPort;
  readonly configuration: GenericRestConnectorConfigV1;
}): ConnectorAdapterPort {
  const base = validateGenericRestConfiguration(input.configuration);
  const maximumBytes = input.configuration.maxResponseBytes ?? 5_000_000;
  assertBoundedPositiveInteger(maximumBytes, "REST connector maxResponseBytes", 100_000_000);

  return Object.freeze({
    async read(request: ConnectorReadRequestV1): Promise<ConnectorPageV1> {
      assertResourceRequest({ connection: request.connection, expectedConnectorTypes: ["rest", "generic_rest"], configuredResourceType: input.configuration.resourceType, requestedResourceType: request.resourceType, direction: request.direction });
      assertBoundedPositiveInteger(request.limit, "REST connector page size", MAX_CONNECTOR_RECORDS);
      const url = new URL(input.configuration.path, base);
      if (url.origin !== base.origin) throw new TypeError("REST connector path escaped the configured origin");
      for (const [name, value] of Object.entries(input.configuration.staticQuery ?? {})) {
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name) || value.length > 2_048) throw new TypeError("REST connector static query is invalid");
        url.searchParams.set(name, value);
      }
      url.searchParams.set(input.configuration.limitQueryParameter ?? "limit", String(request.limit));
      if (request.cursor !== undefined) url.searchParams.set(input.configuration.cursorQueryParameter ?? "cursor", request.cursor);
      const credentialHeaders = safeHeaders(await input.credentials.headersFor({ providerKey: request.connection.providerKey, credentialReference: request.connection.credentialReference }));
      const response = await input.transport.request({ method: "GET", url: url.toString(), headers: Object.freeze({ accept: "application/json", ...credentialHeaders }) });
      classifyHttpStatus(response.statusCode, "REST provider");
      const document = parseJson(response.body, maximumBytes, "REST connector response");
      const items = jsonPointer(document, input.configuration.itemsPointer);
      if (!Array.isArray(items)) throw new PermanentConnectorProviderError("items_invalid", "REST connector items pointer did not resolve to an array");
      if (items.length > request.limit) throw new PermanentConnectorProviderError("page_too_large", "REST provider exceeded the requested page size");
      const identities = new Set<string>();
      const records = items.map((item) => {
        assertPlainObject(item, "REST connector item");
        const externalId = normalizeExternalId(jsonPointer(item, input.configuration.externalIdPointer), "REST connector external ID pointer");
        if (identities.has(externalId)) throw new PermanentConnectorProviderError("external_id_duplicate", "REST page contains duplicate external IDs");
        identities.add(externalId);
        return Object.freeze({ syncId: connectorSyncId("rest", request.connection.connectionId, request.resourceType, externalId), externalId, payload: Object.freeze({ ...item }) });
      });
      let nextCursor: string | undefined;
      if (input.configuration.nextCursorPointer !== undefined) {
        const candidate = jsonPointer(document, input.configuration.nextCursorPointer);
        if (candidate !== undefined && candidate !== null) {
          nextCursor = normalizeExternalId(candidate, "REST connector next cursor pointer");
          if (nextCursor.length > 512) throw new PermanentConnectorProviderError("cursor_too_large", "REST connector next cursor is too long");
        }
      }
      return Object.freeze({ records: Object.freeze(records), ...(nextCursor === undefined ? {} : { nextCursor }), exhausted: nextCursor === undefined });
    },
  });
}

const SHOPIFY_PRODUCTS_QUERY = `query OzzylProducts($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    edges {
      cursor
      node {
        id title handle status vendor productType updatedAt
        variants(first: 100) {
          nodes { id title sku barcode price compareAtPrice inventoryQuantity updatedAt }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export function createShopifyProductAdapter(input: {
  readonly transport: ConnectorHttpTransportPort;
  readonly credentials: ConnectorCredentialPort;
  readonly configuration: ShopifyProductConnectorConfigV1;
}): ConnectorAdapterPort {
  if (input.configuration.schemaVersion !== "1.0") throw new TypeError("Shopify connector configuration version is unsupported");
  if (!SHOPIFY_DOMAIN_PATTERN.test(input.configuration.shopDomain)) throw new TypeError("Shopify shop domain must be a myshopify.com hostname");
  if (!SHOPIFY_VERSION_PATTERN.test(input.configuration.apiVersion)) throw new TypeError("Shopify API version must be an explicit quarterly YYYY-MM version");
  const maximumBytes = input.configuration.maxResponseBytes ?? 10_000_000;
  assertBoundedPositiveInteger(maximumBytes, "Shopify connector maxResponseBytes", 100_000_000);

  return Object.freeze({
    async read(request: ConnectorReadRequestV1): Promise<ConnectorPageV1> {
      assertResourceRequest({ connection: request.connection, expectedConnectorTypes: ["shopify", "shopify_graphql"], configuredResourceType: input.configuration.resourceType, requestedResourceType: request.resourceType, direction: request.direction });
      assertBoundedPositiveInteger(request.limit, "Shopify connector page size", 250);
      const credentialHeaders = safeHeaders(await input.credentials.headersFor({ providerKey: request.connection.providerKey, credentialReference: request.connection.credentialReference }));
      const variables: Record<string, unknown> = { first: request.limit, after: request.cursor ?? null };
      if (input.configuration.query !== undefined) variables.query = input.configuration.query;
      const response = await input.transport.request({
        method: "POST",
        url: `https://${input.configuration.shopDomain}/admin/api/${input.configuration.apiVersion}/graphql.json`,
        headers: Object.freeze({ accept: "application/json", "content-type": "application/json", ...credentialHeaders }),
        body: new TextEncoder().encode(JSON.stringify({ query: SHOPIFY_PRODUCTS_QUERY, variables })),
      });
      classifyHttpStatus(response.statusCode, "Shopify");
      const document = parseJson(response.body, maximumBytes, "Shopify GraphQL response");
      assertPlainObject(document, "Shopify GraphQL response");
      if (Array.isArray(document.errors) && document.errors.length > 0) throw new PermanentConnectorProviderError("graphql_rejected", "Shopify returned GraphQL errors");
      const products = jsonPointer(document, "/data/products");
      assertPlainObject(products, "Shopify products connection");
      if (!Array.isArray(products.edges)) throw new PermanentConnectorProviderError("products_invalid", "Shopify products connection did not contain edges");
      if (products.edges.length > request.limit) throw new PermanentConnectorProviderError("page_too_large", "Shopify exceeded the requested product page size");
      const identities = new Set<string>();
      const records = products.edges.map((edge) => {
        assertPlainObject(edge, "Shopify product edge");
        assertPlainObject(edge.node, "Shopify product node");
        const externalId = normalizeExternalId(edge.node.id, "Shopify product ID");
        if (identities.has(externalId)) throw new PermanentConnectorProviderError("external_id_duplicate", "Shopify page contains duplicate product IDs");
        identities.add(externalId);
        return Object.freeze({ syncId: connectorSyncId("shopify", request.connection.connectionId, request.resourceType, externalId), externalId, payload: Object.freeze({ ...edge.node }) });
      });
      assertPlainObject(products.pageInfo, "Shopify products pageInfo");
      if (typeof products.pageInfo.hasNextPage !== "boolean") throw new PermanentConnectorProviderError("page_info_invalid", "Shopify pageInfo.hasNextPage is invalid");
      let nextCursor: string | undefined;
      if (products.pageInfo.hasNextPage) {
        nextCursor = normalizeExternalId(products.pageInfo.endCursor, "Shopify pageInfo.endCursor");
        if (nextCursor.length > 512) throw new PermanentConnectorProviderError("cursor_too_large", "Shopify cursor is too long");
      }
      return Object.freeze({ records: Object.freeze(records), ...(nextCursor === undefined ? {} : { nextCursor }), exhausted: !products.pageInfo.hasNextPage });
    },
  });
}

function pathSegments(path: string): readonly string[] {
  const segments = path.split(".");
  if (segments.length === 0 || segments.length > 16 || segments.some((segment) => !PATH_SEGMENT_PATTERN.test(segment) || /^(?:__proto__|prototype|constructor)$/u.test(segment))) {
    throw new TypeError("Connector mapping field path is invalid");
  }
  return segments;
}

function readField(record: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = record;
  for (const segment of pathSegments(path)) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

function writeField(record: Record<string, unknown>, path: string, value: unknown): void {
  const segments = pathSegments(path);
  let current = record;
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const existing = current[segment];
    if (existing !== undefined && (existing === null || typeof existing !== "object" || Array.isArray(existing))) throw new TypeError("Connector mapping path collides with a scalar field");
    const nested: Record<string, unknown> = existing === undefined ? {} : { ...(existing as Readonly<Record<string, unknown>>) };
    current[segment] = nested;
    current = nested;
  }
}

function transformMappedValue(value: unknown, transformVersion: string): unknown {
  switch (transformVersion) {
    case "identity.v1": return value;
    case "string.v1": return value === null || value === undefined ? value : String(value);
    case "trim.v1":
      if (typeof value !== "string") throw new TypeError("trim.v1 requires a string value");
      return value.trim();
    case "lowercase.v1":
      if (typeof value !== "string") throw new TypeError("lowercase.v1 requires a string value");
      return value.toLowerCase();
    case "integer-string.v1": {
      const normalized = String(value);
      if (!/^-?(?:0|[1-9][0-9]*)$/u.test(normalized)) throw new TypeError("integer-string.v1 requires an integer-compatible value");
      return normalized;
    }
    default: throw new TypeError(`Unsupported connector transform version: ${transformVersion}`);
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export interface ConnectorMappingResultV1 {
  readonly status: Extract<ConnectorSyncOutcomeV1["status"], "applied" | "conflict" | "rejected">;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly reasonCode?: string;
}

export function mapInboundConnectorRecord(input: {
  readonly record: ConnectorRecordV1;
  readonly mappings: readonly ConnectorFieldMappingV1[];
  readonly currentPlatformRecord?: Readonly<Record<string, unknown>>;
}): ConnectorMappingResultV1 {
  if (input.mappings.length === 0) return Object.freeze({ status: "rejected", reasonCode: "mapping_missing" });
  const payload: Record<string, unknown> = {};
  try {
    for (const mapping of input.mappings) {
      if (mapping.direction !== "inbound") throw new TypeError("Inbound record mapping received an outbound mapping");
      if (mapping.ownership === "platform") throw new TypeError("Platform-owned fields cannot be synchronized inbound");
      const externalValue = readField(input.record.payload, mapping.externalField);
      if (externalValue === undefined) return Object.freeze({ status: "rejected", reasonCode: "external_field_missing" });
      const transformed = transformMappedValue(externalValue, mapping.transformVersion);
      const currentValue = input.currentPlatformRecord === undefined ? undefined : readField(input.currentPlatformRecord, mapping.platformField);
      if (mapping.ownership === "manual" && currentValue !== undefined && !valuesEqual(currentValue, transformed)) return Object.freeze({ status: "conflict", reasonCode: "manual_field_conflict" });
      writeField(payload, mapping.platformField, transformed);
    }
  } catch {
    return Object.freeze({ status: "rejected", reasonCode: "mapping_invalid" });
  }
  return Object.freeze({ status: "applied", payload: Object.freeze(payload) });
}
