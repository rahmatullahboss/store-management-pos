import {
  NeonDatabase,
  requirePermission,
  sha256Hex,
  type RequestContext,
  type TransactionClient,
} from "../../../packages/foundation/src/index.js";
import type {
  PublicationCommandResult,
  StorefrontCommandMeta,
  StorefrontPublicationState,
} from "./index.js";

export type VariantPublicationState = "published" | "hidden" | "archived";
export type NavigationPlacement = "header" | "footer" | "utility";
export type ContentPageStatus = "scheduled" | "published" | "hidden" | "archived";
export type HomepageStatus = "scheduled" | "published" | "archived";

export interface SetVariantPublicationInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly state: VariantPublicationState;
  readonly publicSlugSuffix?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SetCategoryPublicationInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly categoryId: string;
  readonly parentCategoryId?: string;
  readonly publicSlug: string;
  readonly sortOrder?: number;
  readonly state: StorefrontPublicationState;
  readonly scheduledFor?: string;
}

export interface SetCollectionInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly code: string;
  readonly publicSlug: string;
  readonly title: string;
  readonly description?: string;
  readonly state: StorefrontPublicationState;
  readonly scheduledFor?: string;
}

export interface CollectionMemberInput {
  readonly memberId: string;
  readonly productId: string;
  readonly variantId?: string;
  readonly sortOrder?: number;
}

export interface ReplaceCollectionMembersInput extends StorefrontCommandMeta {
  readonly collectionId: string;
  readonly members: readonly CollectionMemberInput[];
}

export interface PublishNavigationInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly placement: NavigationPlacement;
  readonly navigationDocument: Readonly<Record<string, unknown>>;
}

export interface PublishContentPageInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly publicSlug: string;
  readonly title: string;
  readonly status: ContentPageStatus;
  readonly contentDocument: Readonly<Record<string, unknown>>;
  readonly seoDocument?: Readonly<Record<string, unknown>>;
  readonly scheduledFor?: string;
}

export interface PublishHomepageInput extends StorefrontCommandMeta {
  readonly storefrontId: string;
  readonly status: HomepageStatus;
  readonly homepageDocument: Readonly<Record<string, unknown>>;
  readonly seoDocument?: Readonly<Record<string, unknown>>;
  readonly scheduledFor?: string;
}

export interface CollectionMembersCommandResult {
  readonly id: string;
  readonly memberCount: number;
  readonly cacheGeneration: bigint;
  readonly replayed: boolean;
}

export interface RevisionCommandResult {
  readonly id: string;
  readonly revision: bigint;
  readonly cacheGeneration: bigint;
  readonly replayed: boolean;
}

export interface StatusRevisionCommandResult extends RevisionCommandResult {
  readonly status: string;
}

interface CommandEnvelope<Input> {
  readonly context: RequestContext;
  readonly input: Input;
  readonly entityId: string;
  readonly receiptId: string;
  readonly requestHash: string;
  readonly documentHash?: string;
}

export interface StorefrontPublishingRepository {
  setVariantPublication(command: CommandEnvelope<SetVariantPublicationInput>): Promise<PublicationCommandResult>;
  setCategoryPublication(command: CommandEnvelope<SetCategoryPublicationInput>): Promise<PublicationCommandResult>;
  setCollection(command: CommandEnvelope<SetCollectionInput>): Promise<PublicationCommandResult>;
  replaceCollectionMembers(command: CommandEnvelope<ReplaceCollectionMembersInput>): Promise<CollectionMembersCommandResult>;
  publishNavigation(command: CommandEnvelope<PublishNavigationInput>): Promise<RevisionCommandResult>;
  publishContentPage(command: CommandEnvelope<PublishContentPageInput>): Promise<StatusRevisionCommandResult>;
  publishHomepage(command: CommandEnvelope<PublishHomepageInput>): Promise<StatusRevisionCommandResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9-]{1,62}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/;

function uuid(value: string, label: string): string {
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
  if (!CODE.test(normalized)) throw new Error("Collection code is invalid.");
  return normalized;
}

function slug(value: string, label = "Public slug"): string {
  const normalized = value.trim().toLowerCase();
  if (!SLUG.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function dateTime(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid.`);
  return new Date(timestamp).toISOString();
}

function integer(value: number | undefined, label: string, fallback = 0): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < -1_000_000 || normalized > 1_000_000) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function record(value: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> {
  return value ?? {};
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

async function hash(scope: string, input: object): Promise<string> {
  return await sha256Hex(JSON.stringify({ scope, input: stableValue(input) }));
}

async function envelope<Input extends StorefrontCommandMeta>(
  context: RequestContext,
  input: Input,
  scope: string,
  entityId = crypto.randomUUID(),
  document?: Readonly<Record<string, unknown>>,
): Promise<CommandEnvelope<Input>> {
  const normalized = { ...input, idempotencyKey: bounded(input.idempotencyKey, "Idempotency key", 200) };
  return {
    context,
    input: normalized,
    entityId,
    receiptId: crypto.randomUUID(),
    requestHash: await hash(scope, normalized),
    ...(document ? { documentHash: await sha256Hex(JSON.stringify(stableValue(document))) } : {}),
  };
}

function scheduled(state: StorefrontPublicationState | ContentPageStatus | HomepageStatus, value: string | undefined): string | undefined {
  const normalized = value ? dateTime(value, "Scheduled time") : undefined;
  if (state === "scheduled" && !normalized) throw new Error("Scheduled publication requires a schedule time.");
  return normalized;
}

function members(values: readonly CollectionMemberInput[]): readonly CollectionMemberInput[] {
  if (values.length > 500) throw new Error("Collection member limit exceeded.");
  const normalized = values.map((value) => ({
    memberId: uuid(value.memberId, "Collection member"),
    productId: uuid(value.productId, "Product"),
    ...(value.variantId ? { variantId: uuid(value.variantId, "Variant") } : {}),
    sortOrder: integer(value.sortOrder, "Sort order"),
  }));
  const identities = new Set<string>();
  const memberIds = new Set<string>();
  for (const value of normalized) {
    const identity = `${value.productId}:${value.variantId ?? ""}`;
    if (identities.has(identity)) throw new Error("Collection members contain a duplicate product and variant.");
    if (memberIds.has(value.memberId)) throw new Error("Collection member IDs must be unique.");
    identities.add(identity);
    memberIds.add(value.memberId);
  }
  return normalized;
}

export class StorefrontPublishingService {
  public constructor(private readonly repository: StorefrontPublishingRepository) {}

  public async setVariantPublication(
    context: RequestContext,
    input: SetVariantPublicationInput,
  ): Promise<PublicationCommandResult> {
    requirePermission(context, "storefront.publication.manage");
    const normalized: SetVariantPublicationInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      salesChannelId: uuid(input.salesChannelId, "Sales channel"),
      productId: uuid(input.productId, "Product"),
      variantId: uuid(input.variantId, "Variant"),
      ...(input.publicSlugSuffix ? { publicSlugSuffix: slug(input.publicSlugSuffix, "Variant slug suffix") } : {}),
      metadata: record(input.metadata),
    };
    return await this.repository.setVariantPublication(
      await envelope(context, normalized, "storefront.variant_publication.set"),
    );
  }

  public async setCategoryPublication(
    context: RequestContext,
    input: SetCategoryPublicationInput,
  ): Promise<PublicationCommandResult> {
    requirePermission(context, "storefront.publication.manage");
    const schedule = scheduled(input.state, input.scheduledFor);
    const normalized: SetCategoryPublicationInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      salesChannelId: uuid(input.salesChannelId, "Sales channel"),
      categoryId: uuid(input.categoryId, "Category"),
      ...(input.parentCategoryId ? { parentCategoryId: uuid(input.parentCategoryId, "Parent category") } : {}),
      publicSlug: slug(input.publicSlug),
      sortOrder: integer(input.sortOrder, "Sort order"),
      ...(schedule ? { scheduledFor: schedule } : {}),
    };
    if (normalized.parentCategoryId === normalized.categoryId) throw new Error("Category cannot be its own parent.");
    return await this.repository.setCategoryPublication(
      await envelope(context, normalized, "storefront.category_publication.set"),
    );
  }

  public async setCollection(
    context: RequestContext,
    input: SetCollectionInput,
  ): Promise<PublicationCommandResult> {
    requirePermission(context, "storefront.publication.manage");
    const schedule = scheduled(input.state, input.scheduledFor);
    const normalized: SetCollectionInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      salesChannelId: uuid(input.salesChannelId, "Sales channel"),
      code: code(input.code),
      publicSlug: slug(input.publicSlug),
      title: bounded(input.title, "Collection title", 200),
      ...(input.description ? { description: bounded(input.description, "Collection description", 2000) } : {}),
      ...(schedule ? { scheduledFor: schedule } : {}),
    };
    return await this.repository.setCollection(
      await envelope(context, normalized, "storefront.collection.set"),
    );
  }

  public async replaceCollectionMembers(
    context: RequestContext,
    input: ReplaceCollectionMembersInput,
  ): Promise<CollectionMembersCommandResult> {
    requirePermission(context, "storefront.publication.manage");
    const normalized: ReplaceCollectionMembersInput = {
      ...input,
      collectionId: uuid(input.collectionId, "Collection"),
      members: members(input.members),
    };
    return await this.repository.replaceCollectionMembers(
      await envelope(context, normalized, "storefront.collection_members.replace", normalized.collectionId),
    );
  }

  public async publishNavigation(
    context: RequestContext,
    input: PublishNavigationInput,
  ): Promise<RevisionCommandResult> {
    requirePermission(context, "storefront.content.manage");
    const document = stableValue(input.navigationDocument) as Readonly<Record<string, unknown>>;
    const normalized: PublishNavigationInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      navigationDocument: document,
    };
    return await this.repository.publishNavigation(
      await envelope(context, normalized, "storefront.navigation.publish", undefined, document),
    );
  }

  public async publishContentPage(
    context: RequestContext,
    input: PublishContentPageInput,
  ): Promise<StatusRevisionCommandResult> {
    requirePermission(context, "storefront.content.manage");
    const schedule = scheduled(input.status, input.scheduledFor);
    const contentDocument = stableValue(input.contentDocument) as Readonly<Record<string, unknown>>;
    const seoDocument = stableValue(record(input.seoDocument)) as Readonly<Record<string, unknown>>;
    const normalized: PublishContentPageInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      publicSlug: slug(input.publicSlug),
      title: bounded(input.title, "Page title", 240),
      contentDocument,
      seoDocument,
      ...(schedule ? { scheduledFor: schedule } : {}),
    };
    return await this.repository.publishContentPage(
      await envelope(
        context,
        normalized,
        "storefront.content_page.publish",
        undefined,
        { contentDocument, seoDocument },
      ),
    );
  }

  public async publishHomepage(
    context: RequestContext,
    input: PublishHomepageInput,
  ): Promise<StatusRevisionCommandResult> {
    requirePermission(context, "storefront.content.manage");
    const schedule = scheduled(input.status, input.scheduledFor);
    const homepageDocument = stableValue(input.homepageDocument) as Readonly<Record<string, unknown>>;
    const seoDocument = stableValue(record(input.seoDocument)) as Readonly<Record<string, unknown>>;
    const normalized: PublishHomepageInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      homepageDocument,
      seoDocument,
      ...(schedule ? { scheduledFor: schedule } : {}),
    };
    return await this.repository.publishHomepage(
      await envelope(
        context,
        normalized,
        "storefront.homepage.publish",
        undefined,
        { homepageDocument, seoDocument },
      ),
    );
  }
}

interface PublicationRow extends Record<string, unknown> {
  readonly id: string;
  readonly state: StorefrontPublicationState;
  readonly cacheGeneration: string | number | bigint;
  readonly replayed: boolean;
}

interface CollectionMembersRow extends Record<string, unknown> {
  readonly id: string;
  readonly memberCount: number;
  readonly cacheGeneration: string | number | bigint;
  readonly replayed: boolean;
}

interface RevisionRow extends Record<string, unknown> {
  readonly id: string;
  readonly revision: string | number | bigint;
  readonly cacheGeneration: string | number | bigint;
  readonly replayed: boolean;
}

interface StatusRevisionRow extends RevisionRow {
  readonly status: string;
}

function first<Row extends Record<string, unknown>>(rows: readonly Row[], label: string): Row {
  const row = rows[0];
  if (!row) throw new Error(`${label} returned no result.`);
  return row;
}

function publication(row: PublicationRow): PublicationCommandResult {
  return Object.freeze({
    id: row.id,
    state: row.state,
    cacheGeneration: BigInt(row.cacheGeneration),
    replayed: row.replayed,
  });
}

function revision(row: RevisionRow): RevisionCommandResult {
  return Object.freeze({
    id: row.id,
    revision: BigInt(row.revision),
    cacheGeneration: BigInt(row.cacheGeneration),
    replayed: row.replayed,
  });
}

export class SqlStorefrontPublishingRepository implements StorefrontPublishingRepository {
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

  public async setVariantPublication(
    command: CommandEnvelope<SetVariantPublicationInput>,
  ): Promise<PublicationCommandResult> {
    const input = command.input;
    const row = first(
      await this.transact<PublicationRow>(
        command.context,
        `SELECT publication_id AS id, publication_state AS state, cache_generation AS "cacheGeneration", replayed
         FROM storefront.set_variant_publication(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::text,
           $9::text,$10::jsonb,$11::uuid,$12::text,$13::text,$14::text,$15::text,$16::date
         )`,
        [
          command.entityId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.salesChannelId,
          input.productId,
          input.variantId,
          input.state,
          input.publicSlugSuffix ?? null,
          input.metadata ?? {},
          command.context.actorId,
          input.idempotencyKey,
          command.requestHash,
          command.context.requestId,
          command.context.traceId,
          command.context.businessDate,
        ],
      ),
      "set variant publication",
    );
    return publication(row);
  }

  public async setCategoryPublication(
    command: CommandEnvelope<SetCategoryPublicationInput>,
  ): Promise<PublicationCommandResult> {
    const input = command.input;
    const row = first(
      await this.transact<PublicationRow>(
        command.context,
        `SELECT publication_id AS id, publication_state AS state, cache_generation AS "cacheGeneration", replayed
         FROM storefront.set_category_publication(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::text,
           $9::integer,$10::text,$11::timestamptz,$12::uuid,$13::text,$14::text,$15::text,$16::text,$17::date
         )`,
        [
          command.entityId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.salesChannelId,
          input.categoryId,
          input.parentCategoryId ?? null,
          input.publicSlug,
          input.sortOrder ?? 0,
          input.state,
          input.scheduledFor ?? null,
          command.context.actorId,
          input.idempotencyKey,
          command.requestHash,
          command.context.requestId,
          command.context.traceId,
          command.context.businessDate,
        ],
      ),
      "set category publication",
    );
    return publication(row);
  }

  public async setCollection(command: CommandEnvelope<SetCollectionInput>): Promise<PublicationCommandResult> {
    const input = command.input;
    const row = first(
      await this.transact<PublicationRow>(
        command.context,
        `SELECT collection_id AS id, publication_state AS state, cache_generation AS "cacheGeneration", replayed
         FROM storefront.set_collection(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::text,
           $9::text,$10::text,$11::timestamptz,$12::uuid,$13::text,$14::text,$15::text,$16::text,$17::date
         )`,
        [
          command.entityId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.salesChannelId,
          input.code,
          input.publicSlug,
          input.title,
          input.description ?? "",
          input.state,
          input.scheduledFor ?? null,
          command.context.actorId,
          input.idempotencyKey,
          command.requestHash,
          command.context.requestId,
          command.context.traceId,
          command.context.businessDate,
        ],
      ),
      "set collection",
    );
    return publication(row);
  }

  public async replaceCollectionMembers(
    command: CommandEnvelope<ReplaceCollectionMembersInput>,
  ): Promise<CollectionMembersCommandResult> {
    const input = command.input;
    const row = first(
      await this.transact<CollectionMembersRow>(
        command.context,
        `SELECT collection_id AS id, member_count AS "memberCount", cache_generation AS "cacheGeneration", replayed
         FROM storefront.replace_collection_members(
           $1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::uuid,$6::text,$7::text,$8::text,$9::text,$10::date
         )`,
        [
          command.receiptId,
          command.context.tenantId,
          input.collectionId,
          input.members,
          command.context.actorId,
          input.idempotencyKey,
          command.requestHash,
          command.context.requestId,
          command.context.traceId,
          command.context.businessDate,
        ],
      ),
      "replace collection members",
    );
    return Object.freeze({
      id: row.id,
      memberCount: row.memberCount,
      cacheGeneration: BigInt(row.cacheGeneration),
      replayed: row.replayed,
    });
  }

  public async publishNavigation(
    command: CommandEnvelope<PublishNavigationInput>,
  ): Promise<RevisionCommandResult> {
    const input = command.input;
    const row = first(
      await this.transact<RevisionRow>(
        command.context,
        `SELECT navigation_id AS id, revision, cache_generation AS "cacheGeneration", replayed
         FROM storefront.publish_navigation_revision(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb,$7::text,
           $8::uuid,$9::text,$10::text,$11::text,$12::text,$13::date
         )`,
        [
          command.entityId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.placement,
          input.navigationDocument,
          command.documentHash,
          command.context.actorId,
          input.idempotencyKey,
          command.requestHash,
          command.context.requestId,
          command.context.traceId,
          command.context.businessDate,
        ],
      ),
      "publish navigation",
    );
    return revision(row);
  }

  public async publishContentPage(
    command: CommandEnvelope<PublishContentPageInput>,
  ): Promise<StatusRevisionCommandResult> {
    const input = command.input;
    const row = first(
      await this.transact<StatusRevisionRow>(
        command.context,
        `SELECT content_page_id AS id, revision, status, cache_generation AS "cacheGeneration", replayed
         FROM storefront.publish_content_page_revision(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::jsonb,
           $9::jsonb,$10::text,$11::timestamptz,$12::uuid,$13::text,$14::text,$15::text,$16::text,$17::date
         )`,
        [
          command.entityId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.publicSlug,
          input.title,
          input.status,
          input.contentDocument,
          input.seoDocument ?? {},
          command.documentHash,
          input.scheduledFor ?? null,
          command.context.actorId,
          input.idempotencyKey,
          command.requestHash,
          command.context.requestId,
          command.context.traceId,
          command.context.businessDate,
        ],
      ),
      "publish content page",
    );
    return Object.freeze({ ...revision(row), status: row.status });
  }

  public async publishHomepage(
    command: CommandEnvelope<PublishHomepageInput>,
  ): Promise<StatusRevisionCommandResult> {
    const input = command.input;
    const row = first(
      await this.transact<StatusRevisionRow>(
        command.context,
        `SELECT homepage_id AS id, revision, status, cache_generation AS "cacheGeneration", replayed
         FROM storefront.publish_homepage_revision(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb,$7::jsonb,$8::text,
           $9::timestamptz,$10::uuid,$11::text,$12::text,$13::text,$14::text,$15::date
         )`,
        [
          command.entityId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.status,
          input.homepageDocument,
          input.seoDocument ?? {},
          command.documentHash,
          input.scheduledFor ?? null,
          command.context.actorId,
          input.idempotencyKey,
          command.requestHash,
          command.context.requestId,
          command.context.traceId,
          command.context.businessDate,
        ],
      ),
      "publish homepage",
    );
    return Object.freeze({ ...revision(row), status: row.status });
  }
}
