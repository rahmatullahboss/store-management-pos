import {
  NeonDatabase,
  requirePermission,
  sha256Hex,
  type RequestContext,
  type TransactionClient,
} from "../../../packages/foundation/src/index.js";

export type StorefrontLifecycleStatus = "draft" | "active" | "suspended" | "archived";
export type StorefrontPublicationState = "draft" | "scheduled" | "published" | "hidden" | "archived";
export type StorefrontDomainStatus =
  | "pending"
  | "verification_pending"
  | "certificate_pending"
  | "active"
  | "suspended"
  | "failed"
  | "deleting"
  | "deleted";
export type StorefrontCertificateStatus = "none" | "pending" | "active" | "expiring" | "failed" | "revoked";

export interface StorefrontCommandMeta {
  readonly idempotencyKey: string;
}

export interface CreateStorefrontInput extends StorefrontCommandMeta {
  readonly legalEntityId: string;
  readonly primaryStoreId?: string;
  readonly code: string;
  readonly displayName: string;
  readonly defaultLocale: string;
  readonly defaultCurrency: string;
  readonly timeZone: string;
  readonly platformSubdomain?: string;
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface TransitionStorefrontInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly status: StorefrontLifecycleStatus;
}

export interface CreateSalesChannelInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly code: string;
  readonly displayName: string;
  readonly priceListId: string;
  readonly inventoryScope?: Readonly<Record<string, unknown>>;
  readonly allowedCountryCodes?: readonly string[];
  readonly guestCheckoutEnabled?: boolean;
  readonly customerAccountsEnabled?: boolean;
  readonly backorderPolicy?: "deny" | "allow" | "preorder_only";
}

export interface TransitionSalesChannelInput extends StorefrontCommandMeta {
  readonly salesChannelId: string;
  readonly status: StorefrontLifecycleStatus;
}

export interface SetProductPublicationInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly productId: string;
  readonly publicSlug: string;
  readonly state: StorefrontPublicationState;
  readonly scheduledFor?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RegisterDomainInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly hostname: string;
  readonly kind: "platform_subdomain" | "custom";
  readonly verificationMethod?: "dns_txt" | "dns_cname" | "http";
}

export interface RecordDomainVerificationInput extends StorefrontCommandMeta {
  readonly domainId: string;
  readonly attempt: number;
  readonly challengeType: "dns_txt" | "dns_cname" | "http";
  readonly challengeName: string;
  readonly challengeValueHash: string;
  readonly resultStatus: "pending" | "verified" | "failed" | "expired";
  readonly providerReference?: string;
  readonly observedDetail?: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface TransitionDomainInput extends StorefrontCommandMeta {
  readonly domainId: string;
  readonly status: StorefrontDomainStatus;
  readonly certificateStatus: StorefrontCertificateStatus;
  readonly providerHostnameId?: string;
  readonly failureCode?: string;
  readonly failureDetail?: string;
  readonly canonical: boolean;
}

export interface PublishThemeInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly themeDocument: Readonly<Record<string, unknown>>;
}

export interface EntityCommandResult {
  readonly id: string;
  readonly replayed: boolean;
}

export interface TransitionCommandResult extends EntityCommandResult {
  readonly status: string;
}

export interface PublicationCommandResult extends EntityCommandResult {
  readonly state: StorefrontPublicationState;
  readonly cacheGeneration: bigint;
}

export interface ThemeCommandResult extends EntityCommandResult {
  readonly revision: bigint;
  readonly cacheGeneration: bigint;
}

interface CommandEnvelope<Input> {
  readonly context: RequestContext;
  readonly input: Input;
  readonly entityId: string;
  readonly receiptId: string;
  readonly requestHash: string;
}

export interface StorefrontCommandRepository {
  createStorefront(command: CommandEnvelope<CreateStorefrontInput>): Promise<EntityCommandResult>;
  transitionStorefront(command: CommandEnvelope<TransitionStorefrontInput>): Promise<TransitionCommandResult>;
  createSalesChannel(command: CommandEnvelope<CreateSalesChannelInput>): Promise<EntityCommandResult>;
  transitionSalesChannel(command: CommandEnvelope<TransitionSalesChannelInput>): Promise<TransitionCommandResult>;
  setProductPublication(command: CommandEnvelope<SetProductPublicationInput>): Promise<PublicationCommandResult>;
  registerDomain(command: CommandEnvelope<RegisterDomainInput>): Promise<TransitionCommandResult>;
  recordDomainVerification(command: CommandEnvelope<RecordDomainVerificationInput>): Promise<TransitionCommandResult>;
  transitionDomain(command: CommandEnvelope<TransitionDomainInput>): Promise<TransitionCommandResult>;
  publishTheme(command: CommandEnvelope<PublishThemeInput>): Promise<ThemeCommandResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9-]{1,62}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/;
const HASH = /^[a-f0-9]{64}$/;
const COUNTRY = /^[A-Z]{2}$/;

function requiredUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new Error(`${label} must be a UUID.`);
  return value.toLowerCase();
}

function bounded(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function code(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!CODE.test(normalized)) throw new Error("Storefront code is invalid.");
  return normalized;
}

function slug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SLUG.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error("Public slug is invalid.");
  }
  return normalized;
}

function hostname(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    normalized.length < 4 ||
    normalized.length > 253 ||
    normalized.includes(":") ||
    normalized.includes("/") ||
    normalized.includes("@") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/u.test(normalized)
  ) {
    throw new Error("Storefront hostname is invalid.");
  }
  return normalized;
}

function idempotencyKey(value: string): string {
  return bounded(value, "Idempotency key", 200);
}

function dateTime(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid.`);
  return new Date(timestamp).toISOString();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

async function requestHash(scope: string, input: object): Promise<string> {
  const value = await sha256Hex(JSON.stringify({ scope, input: stableValue(input) }));
  if (!HASH.test(value)) throw new Error("Command request hash is invalid.");
  return value;
}

function commandEnvelope<Input extends StorefrontCommandMeta>(
  context: RequestContext,
  input: Input,
  scope: string,
  entityId: string = crypto.randomUUID(),
): Promise<CommandEnvelope<Input>> {
  const normalizedInput = { ...input, idempotencyKey: idempotencyKey(input.idempotencyKey) };
  return requestHash(scope, normalizedInput).then((hash) => ({
    context,
    input: normalizedInput,
    entityId,
    receiptId: crypto.randomUUID(),
    requestHash: hash,
  }));
}

function countries(values: readonly string[] | undefined): readonly string[] {
  if (!values) return [];
  const unique = [...new Set(values.map((value) => value.trim().toUpperCase()))];
  if (unique.some((value) => !COUNTRY.test(value))) throw new Error("Country code is invalid.");
  return unique;
}

export class StorefrontCommandService {
  public constructor(private readonly repository: StorefrontCommandRepository) {}

  public async createStorefront(context: RequestContext, input: CreateStorefrontInput): Promise<EntityCommandResult> {
    requirePermission(context, "storefront.storefront.create");
    const normalized: CreateStorefrontInput = {
      ...input,
      legalEntityId: requiredUuid(input.legalEntityId, "Legal entity"),
      ...(input.primaryStoreId ? { primaryStoreId: requiredUuid(input.primaryStoreId, "Primary store") } : {}),
      code: code(input.code),
      displayName: bounded(input.displayName, "Display name", 160),
      defaultLocale: bounded(input.defaultLocale, "Default locale", 35),
      defaultCurrency: bounded(input.defaultCurrency, "Default currency", 3).toUpperCase(),
      timeZone: bounded(input.timeZone, "Time zone", 80),
      ...(input.platformSubdomain ? { platformSubdomain: code(input.platformSubdomain) } : {}),
      settings: input.settings ?? {},
    };
    return await this.repository.createStorefront(await commandEnvelope(context, normalized, "storefront.create"));
  }

  public async transitionStorefront(context: RequestContext, input: TransitionStorefrontInput): Promise<TransitionCommandResult> {
    requirePermission(context, "storefront.storefront.update");
    const normalized = { ...input, storefrontId: requiredUuid(input.storefrontId, "Storefront") };
    return await this.repository.transitionStorefront(
      await commandEnvelope(context, normalized, "storefront.transition", normalized.storefrontId),
    );
  }

  public async createSalesChannel(context: RequestContext, input: CreateSalesChannelInput): Promise<EntityCommandResult> {
    requirePermission(context, "storefront.channel.manage");
    const normalized: CreateSalesChannelInput = {
      ...input,
      storefrontId: requiredUuid(input.storefrontId, "Storefront"),
      code: code(input.code),
      displayName: bounded(input.displayName, "Display name", 160),
      priceListId: requiredUuid(input.priceListId, "Price list"),
      inventoryScope: input.inventoryScope ?? {},
      allowedCountryCodes: countries(input.allowedCountryCodes),
      guestCheckoutEnabled: input.guestCheckoutEnabled ?? true,
      customerAccountsEnabled: input.customerAccountsEnabled ?? true,
      backorderPolicy: input.backorderPolicy ?? "deny",
    };
    return await this.repository.createSalesChannel(
      await commandEnvelope(context, normalized, "storefront.sales_channel.create"),
    );
  }

  public async transitionSalesChannel(context: RequestContext, input: TransitionSalesChannelInput): Promise<TransitionCommandResult> {
    requirePermission(context, "storefront.channel.manage");
    const normalized = { ...input, salesChannelId: requiredUuid(input.salesChannelId, "Sales channel") };
    return await this.repository.transitionSalesChannel(
      await commandEnvelope(context, normalized, "storefront.sales_channel.transition", normalized.salesChannelId),
    );
  }

  public async setProductPublication(context: RequestContext, input: SetProductPublicationInput): Promise<PublicationCommandResult> {
    requirePermission(context, "storefront.publication.manage");
    const normalized: SetProductPublicationInput = {
      ...input,
      storefrontId: requiredUuid(input.storefrontId, "Storefront"),
      salesChannelId: requiredUuid(input.salesChannelId, "Sales channel"),
      productId: requiredUuid(input.productId, "Product"),
      publicSlug: slug(input.publicSlug),
      ...(input.scheduledFor ? { scheduledFor: dateTime(input.scheduledFor, "Scheduled time") } : {}),
      metadata: input.metadata ?? {},
    };
    if (normalized.state === "scheduled" && !normalized.scheduledFor) {
      throw new Error("Scheduled publication requires a schedule time.");
    }
    return await this.repository.setProductPublication(
      await commandEnvelope(context, normalized, "storefront.product_publication.set"),
    );
  }

  public async registerDomain(context: RequestContext, input: RegisterDomainInput): Promise<TransitionCommandResult> {
    requirePermission(context, "storefront.domain.manage");
    const normalized: RegisterDomainInput = {
      ...input,
      storefrontId: requiredUuid(input.storefrontId, "Storefront"),
      hostname: hostname(input.hostname),
      ...(input.verificationMethod ? { verificationMethod: input.verificationMethod } : {}),
    };
    if (normalized.kind === "custom" && !normalized.verificationMethod) {
      throw new Error("Custom domain registration requires a verification method.");
    }
    return await this.repository.registerDomain(
      await commandEnvelope(context, normalized, "storefront.domain.register"),
    );
  }

  public async recordDomainVerification(context: RequestContext, input: RecordDomainVerificationInput): Promise<TransitionCommandResult> {
    requirePermission(context, "storefront.domain.manage");
    const normalized: RecordDomainVerificationInput = {
      ...input,
      domainId: requiredUuid(input.domainId, "Domain"),
      challengeName: bounded(input.challengeName, "Challenge name", 320),
      challengeValueHash: bounded(input.challengeValueHash, "Challenge hash", 64).toLowerCase(),
      ...(input.providerReference ? { providerReference: bounded(input.providerReference, "Provider reference", 240) } : {}),
      observedDetail: input.observedDetail ?? {},
      observedAt: dateTime(input.observedAt, "Observed time"),
      expiresAt: dateTime(input.expiresAt, "Expiry time"),
    };
    if (!HASH.test(normalized.challengeValueHash)) throw new Error("Challenge hash is invalid.");
    if (!Number.isInteger(normalized.attempt) || normalized.attempt < 1) throw new Error("Verification attempt is invalid.");
    if (Date.parse(normalized.expiresAt) <= Date.parse(normalized.observedAt)) throw new Error("Verification expiry must be after observation.");
    return await this.repository.recordDomainVerification(
      await commandEnvelope(context, normalized, "storefront.domain.verify", normalized.domainId),
    );
  }

  public async transitionDomain(context: RequestContext, input: TransitionDomainInput): Promise<TransitionCommandResult> {
    requirePermission(context, "storefront.domain.manage");
    const normalized: TransitionDomainInput = {
      ...input,
      domainId: requiredUuid(input.domainId, "Domain"),
      ...(input.providerHostnameId ? { providerHostnameId: bounded(input.providerHostnameId, "Provider hostname", 240) } : {}),
      ...(input.failureCode ? { failureCode: bounded(input.failureCode, "Failure code", 120) } : {}),
      ...(input.failureDetail ? { failureDetail: bounded(input.failureDetail, "Failure detail", 1000) } : {}),
    };
    return await this.repository.transitionDomain(
      await commandEnvelope(context, normalized, "storefront.domain.transition", normalized.domainId),
    );
  }

  public async publishTheme(context: RequestContext, input: PublishThemeInput): Promise<ThemeCommandResult> {
    requirePermission(context, "storefront.content.manage");
    const normalized: PublishThemeInput = {
      ...input,
      storefrontId: requiredUuid(input.storefrontId, "Storefront"),
      themeDocument: stableValue(input.themeDocument) as Readonly<Record<string, unknown>>,
    };
    return await this.repository.publishTheme(
      await commandEnvelope(context, normalized, "storefront.theme.publish"),
    );
  }
}

interface EntityRow extends Record<string, unknown> {
  readonly id: string;
  readonly replayed: boolean;
}
interface TransitionRow extends EntityRow {
  readonly status: string;
}
interface PublicationRow extends EntityRow {
  readonly state: StorefrontPublicationState;
  readonly cacheGeneration: string | number | bigint;
}
interface ThemeRow extends EntityRow {
  readonly revision: string | number | bigint;
  readonly cacheGeneration: string | number | bigint;
}

function first<Row extends Record<string, unknown>>(rows: readonly Row[], label: string): Row {
  const row = rows[0];
  if (!row) throw new Error(`${label} returned no result.`);
  return row;
}

function entity(row: EntityRow): EntityCommandResult {
  return Object.freeze({ id: row.id, replayed: row.replayed });
}
function transition(row: TransitionRow): TransitionCommandResult {
  return Object.freeze({ id: row.id, status: row.status, replayed: row.replayed });
}

export class SqlStorefrontCommandRepository implements StorefrontCommandRepository {
  public constructor(private readonly database: NeonDatabase) {}

  private async transact<Row extends Record<string, unknown>>(
    context: RequestContext,
    text: string,
    values: readonly unknown[],
  ): Promise<readonly Row[]> {
    return await this.database.withClientTransaction(context, async (client: TransactionClient) =>
      (await client.query<Row>(text, values)).rows,
    );
  }

  public async createStorefront(command: CommandEnvelope<CreateStorefrontInput>): Promise<EntityCommandResult> {
    const input = command.input;
    const row = first(await this.transact<EntityRow>(command.context,
      `SELECT storefront_id AS id, replayed FROM storefront.create_storefront(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::jsonb,$13::uuid,$14::text,$15::text,$16::text,$17::text,$18::date
      )`,
      [command.entityId, command.receiptId, command.context.tenantId, input.legalEntityId, input.primaryStoreId ?? null, input.code, input.displayName, input.defaultLocale, input.defaultCurrency, input.timeZone, input.platformSubdomain ?? null, input.settings ?? {}, command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "create storefront");
    return entity(row);
  }

  public async transitionStorefront(command: CommandEnvelope<TransitionStorefrontInput>): Promise<TransitionCommandResult> {
    const input = command.input;
    const row = first(await this.transact<TransitionRow>(command.context,
      `SELECT storefront_id AS id, status, replayed FROM storefront.transition_storefront($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,$7::text,$8::text,$9::text,$10::date)`,
      [command.receiptId, command.context.tenantId, input.storefrontId, input.status, command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "transition storefront");
    return transition(row);
  }

  public async createSalesChannel(command: CommandEnvelope<CreateSalesChannelInput>): Promise<EntityCommandResult> {
    const input = command.input;
    const row = first(await this.transact<EntityRow>(command.context,
      `SELECT sales_channel_id AS id, replayed FROM storefront.create_sales_channel(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::uuid,$8::jsonb,$9::text[],$10::boolean,$11::boolean,$12::text,$13::uuid,$14::text,$15::text,$16::text,$17::text,$18::date
      )`,
      [command.entityId, command.receiptId, command.context.tenantId, input.storefrontId, input.code, input.displayName, input.priceListId, input.inventoryScope ?? {}, input.allowedCountryCodes ?? [], input.guestCheckoutEnabled ?? true, input.customerAccountsEnabled ?? true, input.backorderPolicy ?? "deny", command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "create sales channel");
    return entity(row);
  }

  public async transitionSalesChannel(command: CommandEnvelope<TransitionSalesChannelInput>): Promise<TransitionCommandResult> {
    const input = command.input;
    const row = first(await this.transact<TransitionRow>(command.context,
      `SELECT sales_channel_id AS id, status, replayed FROM storefront.transition_sales_channel($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,$7::text,$8::text,$9::text,$10::date)`,
      [command.receiptId, command.context.tenantId, input.salesChannelId, input.status, command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "transition sales channel");
    return transition(row);
  }

  public async setProductPublication(command: CommandEnvelope<SetProductPublicationInput>): Promise<PublicationCommandResult> {
    const input = command.input;
    const row = first(await this.transact<PublicationRow>(command.context,
      `SELECT publication_id AS id, publication_state AS state, cache_generation AS "cacheGeneration", replayed FROM storefront.set_product_publication(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text,$8::text,$9::timestamptz,$10::jsonb,$11::uuid,$12::text,$13::text,$14::text,$15::text,$16::date
      )`,
      [command.entityId, command.receiptId, command.context.tenantId, input.storefrontId, input.salesChannelId, input.productId, input.publicSlug, input.state, input.scheduledFor ?? null, input.metadata ?? {}, command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "set product publication");
    return Object.freeze({ id: row.id, state: row.state, cacheGeneration: BigInt(row.cacheGeneration), replayed: row.replayed });
  }

  public async registerDomain(command: CommandEnvelope<RegisterDomainInput>): Promise<TransitionCommandResult> {
    const input = command.input;
    const row = first(await this.transact<TransitionRow>(command.context,
      `SELECT domain_id AS id, status, replayed FROM storefront.register_domain($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::uuid,$9::text,$10::text,$11::text,$12::text,$13::date)`,
      [command.entityId, command.receiptId, command.context.tenantId, input.storefrontId, input.hostname, input.kind, input.verificationMethod ?? null, command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "register domain");
    return transition(row);
  }

  public async recordDomainVerification(command: CommandEnvelope<RecordDomainVerificationInput>): Promise<TransitionCommandResult> {
    const input = command.input;
    const row = first(await this.transact<TransitionRow>(command.context,
      `SELECT domain_id AS id, domain_status AS status, replayed FROM storefront.record_domain_verification(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::text,$7::text,$8::text,$9::text,$10::text,$11::jsonb,$12::timestamptz,$13::timestamptz,$14::uuid,$15::text,$16::text,$17::text,$18::text,$19::date
      )`,
      [command.entityId, command.receiptId, command.context.tenantId, input.domainId, input.attempt, input.challengeType, input.challengeName, input.challengeValueHash, input.resultStatus, input.providerReference ?? null, input.observedDetail ?? {}, input.observedAt, input.expiresAt, command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "record domain verification");
    return transition(row);
  }

  public async transitionDomain(command: CommandEnvelope<TransitionDomainInput>): Promise<TransitionCommandResult> {
    const input = command.input;
    const row = first(await this.transact<TransitionRow>(command.context,
      `SELECT domain_id AS id, status, replayed FROM storefront.transition_domain(
        $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::boolean,$10::uuid,$11::text,$12::text,$13::text,$14::text,$15::date
      )`,
      [command.receiptId, command.context.tenantId, input.domainId, input.status, input.certificateStatus, input.providerHostnameId ?? null, input.failureCode ?? null, input.failureDetail ?? null, input.canonical, command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "transition domain");
    return transition(row);
  }

  public async publishTheme(command: CommandEnvelope<PublishThemeInput>): Promise<ThemeCommandResult> {
    const input = command.input;
    const documentHash = await sha256Hex(JSON.stringify(stableValue(input.themeDocument)));
    const row = first(await this.transact<ThemeRow>(command.context,
      `SELECT theme_revision_id AS id, revision, cache_generation AS "cacheGeneration", replayed FROM storefront.publish_theme_revision(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb,$6::text,$7::uuid,$8::text,$9::text,$10::text,$11::text,$12::date
      )`,
      [command.entityId, command.receiptId, command.context.tenantId, input.storefrontId, input.themeDocument, documentHash, command.context.actorId, input.idempotencyKey, command.requestHash, command.context.requestId, command.context.traceId, command.context.businessDate],
    ), "publish theme");
    return Object.freeze({ id: row.id, revision: BigInt(row.revision), cacheGeneration: BigInt(row.cacheGeneration), replayed: row.replayed });
  }
}
