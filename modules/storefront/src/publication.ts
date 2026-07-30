import {
  NeonDatabase,
  requirePermission,
  sha256Hex,
  type RequestContext,
  type TransactionClient,
} from "../../../packages/foundation/src/index.js";

export type PublicationState = "draft" | "scheduled" | "published" | "hidden" | "archived";
export type VariantPublicationState = "published" | "hidden" | "archived";
export type ContentPageStatus = "scheduled" | "published" | "hidden" | "archived";
export type HomepageStatus = "scheduled" | "published" | "archived";
export type NavigationPlacement = "header" | "footer" | "utility";

interface IdempotentInput {
  readonly idempotencyKey: string;
}

export interface SetVariantPublicationInput extends IdempotentInput {
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly state: VariantPublicationState;
  readonly publicSlugSuffix?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SetCategoryPublicationInput extends IdempotentInput {
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly categoryId: string;
  readonly parentCategoryId?: string;
  readonly publicSlug: string;
  readonly sortOrder: number;
  readonly state: PublicationState;
  readonly scheduledFor?: string;
}

export interface SetCollectionInput extends IdempotentInput {
  readonly collectionId: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly code: string;
  readonly publicSlug: string;
  readonly title: string;
  readonly description?: string;
  readonly state: PublicationState;
  readonly scheduledFor?: string;
}

export interface CollectionMemberInput {
  readonly memberId: string;
  readonly productId: string;
  readonly variantId?: string;
  readonly sortOrder: number;
}

export interface ReplaceCollectionMembersInput extends IdempotentInput {
  readonly collectionId: string;
  readonly members: readonly CollectionMemberInput[];
}

export interface PublishNavigationInput extends IdempotentInput {
  readonly storefrontId: string;
  readonly placement: NavigationPlacement;
  readonly navigationDocument: Readonly<Record<string, unknown>>;
}

export interface PublishContentPageInput extends IdempotentInput {
  readonly contentPageId: string;
  readonly storefrontId: string;
  readonly publicSlug: string;
  readonly title: string;
  readonly status: ContentPageStatus;
  readonly contentDocument: Readonly<Record<string, unknown>>;
  readonly seoDocument?: Readonly<Record<string, unknown>>;
  readonly scheduledFor?: string;
}

export interface PublishHomepageInput extends IdempotentInput {
  readonly homepageId: string;
  readonly storefrontId: string;
  readonly status: HomepageStatus;
  readonly homepageDocument: Readonly<Record<string, unknown>>;
  readonly seoDocument?: Readonly<Record<string, unknown>>;
  readonly scheduledFor?: string;
}

export interface PublicationResult {
  readonly id: string;
  readonly state: string;
  readonly cacheGeneration: bigint;
  readonly replayed: boolean;
}

export interface CollectionMembersResult {
  readonly id: string;
  readonly memberCount: number;
  readonly cacheGeneration: bigint;
  readonly replayed: boolean;
}

export interface RevisionResult {
  readonly id: string;
  readonly revision: bigint;
  readonly cacheGeneration: bigint;
  readonly replayed: boolean;
}

export interface StatusRevisionResult extends RevisionResult {
  readonly status: string;
}

interface CommandEnvelope<Input> {
  readonly context: RequestContext;
  readonly input: Input;
  readonly entityId: string;
  readonly receiptId: string;
  readonly requestHash: string;
}

export interface StorefrontPublicationRepository {
  setVariantPublication(command: CommandEnvelope<SetVariantPublicationInput>): Promise<PublicationResult>;
  setCategoryPublication(command: CommandEnvelope<SetCategoryPublicationInput>): Promise<PublicationResult>;
  setCollection(command: CommandEnvelope<SetCollectionInput>): Promise<PublicationResult>;
  replaceCollectionMembers(command: CommandEnvelope<ReplaceCollectionMembersInput>): Promise<CollectionMembersResult>;
  publishNavigation(command: CommandEnvelope<PublishNavigationInput>): Promise<RevisionResult>;
  publishContentPage(command: CommandEnvelope<PublishContentPageInput>): Promise<StatusRevisionResult>;
  publishHomepage(command: CommandEnvelope<PublishHomepageInput>): Promise<StatusRevisionResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[a-z][a-z0-9-]{1,62}$/u;
const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;

function uuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) throw new Error(`${label} must be a UUID.`);
  return normalized;
}

function bounded(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function optionalBounded(value: string | undefined, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return bounded(value, label, maximum);
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

function dateTime(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid.`);
  return new Date(timestamp).toISOString();
}

function integer(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
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

async function documentHash(value: unknown): Promise<string> {
  return await sha256Hex(JSON.stringify(stableValue(value)));
}

async function envelope<Input extends IdempotentInput>(
  context: RequestContext,
  input: Input,
  scope: string,
  entityId: string,
): Promise<CommandEnvelope<Input>> {
  const normalizedInput = {
    ...input,
    idempotencyKey: bounded(input.idempotencyKey, "Idempotency key", 200),
  };
  const requestHash = await sha256Hex(
    JSON.stringify({ scope, input: stableValue(normalizedInput) }),
  );
  return {
    context,
    input: normalizedInput,
    entityId,
    receiptId: crypto.randomUUID(),
    requestHash,
  };
}

function requireSchedule(state: string, scheduledFor: string | undefined, label: string): void {
  if (state === "scheduled" && scheduledFor === undefined) {
    throw new Error(`${label} requires a scheduled time.`);
  }
}

export class StorefrontPublicationService {
  public constructor(private readonly repository: StorefrontPublicationRepository) {}

  public async setVariantPublication(
    context: RequestContext,
    input: SetVariantPublicationInput,
  ): Promise<PublicationResult> {
    requirePermission(context, "storefront.publication.manage");
    const normalized: SetVariantPublicationInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      salesChannelId: uuid(input.salesChannelId, "Sales channel"),
      productId: uuid(input.productId, "Product"),
      variantId: uuid(input.variantId, "Variant"),
      ...(optionalBounded(input.publicSlugSuffix, "Public slug suffix", 180) === undefined
        ? {}
        : { publicSlugSuffix: slug(input.publicSlugSuffix!, "Public slug suffix") }),
      metadata: stableValue(input.metadata ?? {}) as Readonly<Record<string, unknown>>,
    };
    return await this.repository.setVariantPublication(
      await envelope(context, normalized, "storefront.variant_publication.set", crypto.randomUUID()),
    );
  }

  public async setCategoryPublication(
    context: RequestContext,
    input: SetCategoryPublicationInput,
  ): Promise<PublicationResult> {
    requirePermission(context, "storefront.publication.manage");
    const scheduledFor = dateTime(input.scheduledFor, "Scheduled time");
    const normalized: SetCategoryPublicationInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      salesChannelId: uuid(input.salesChannelId, "Sales channel"),
      categoryId: uuid(input.categoryId, "Category"),
      ...(input.parentCategoryId === undefined
        ? {}
        : { parentCategoryId: uuid(input.parentCategoryId, "Parent category") }),
      publicSlug: slug(input.publicSlug),
      sortOrder: integer(input.sortOrder, "Sort order", -1_000_000, 1_000_000),
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
    };
    requireSchedule(normalized.state, normalized.scheduledFor, "Scheduled category publication");
    return await this.repository.setCategoryPublication(
      await envelope(context, normalized, "storefront.category_publication.set", crypto.randomUUID()),
    );
  }

  public async setCollection(
    context: RequestContext,
    input: SetCollectionInput,
  ): Promise<PublicationResult> {
    requirePermission(context, "storefront.publication.manage");
    const scheduledFor = dateTime(input.scheduledFor, "Scheduled time");
    const description = optionalBounded(input.description, "Collection description", 4_000);
    const normalized: SetCollectionInput = {
      ...input,
      collectionId: uuid(input.collectionId, "Collection"),
      storefrontId: uuid(input.storefrontId, "Storefront"),
      salesChannelId: uuid(input.salesChannelId, "Sales channel"),
      code: code(input.code),
      publicSlug: slug(input.publicSlug),
      title: bounded(input.title, "Collection title", 240),
      ...(description === undefined ? {} : { description }),
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
    };
    requireSchedule(normalized.state, normalized.scheduledFor, "Scheduled collection");
    return await this.repository.setCollection(
      await envelope(context, normalized, "storefront.collection.set", normalized.collectionId),
    );
  }

  public async replaceCollectionMembers(
    context: RequestContext,
    input: ReplaceCollectionMembersInput,
  ): Promise<CollectionMembersResult> {
    requirePermission(context, "storefront.publication.manage");
    if (input.members.length > 500) throw new Error("Collection member limit exceeded.");
    const seen = new Set<string>();
    const members = input.members.map((member) => {
      const normalized: CollectionMemberInput = {
        memberId: uuid(member.memberId, "Collection member"),
        productId: uuid(member.productId, "Product"),
        ...(member.variantId === undefined
          ? {}
          : { variantId: uuid(member.variantId, "Variant") }),
        sortOrder: integer(member.sortOrder, "Sort order", -1_000_000, 1_000_000),
      };
      const key = `${normalized.productId}:${normalized.variantId ?? ""}`;
      if (seen.has(key)) throw new Error("Collection members contain a duplicate product and variant.");
      seen.add(key);
      return normalized;
    });
    const normalized: ReplaceCollectionMembersInput = {
      ...input,
      collectionId: uuid(input.collectionId, "Collection"),
      members,
    };
    return await this.repository.replaceCollectionMembers(
      await envelope(context, normalized, "storefront.collection_members.replace", normalized.collectionId),
    );
  }

  public async publishNavigation(
    context: RequestContext,
    input: PublishNavigationInput,
  ): Promise<RevisionResult> {
    requirePermission(context, "storefront.content.manage");
    const normalized: PublishNavigationInput = {
      ...input,
      storefrontId: uuid(input.storefrontId, "Storefront"),
      navigationDocument: stableValue(input.navigationDocument) as Readonly<Record<string, unknown>>,
    };
    return await this.repository.publishNavigation(
      await envelope(context, normalized, "storefront.navigation.publish", crypto.randomUUID()),
    );
  }

  public async publishContentPage(
    context: RequestContext,
    input: PublishContentPageInput,
  ): Promise<StatusRevisionResult> {
    requirePermission(context, "storefront.content.manage");
    const scheduledFor = dateTime(input.scheduledFor, "Scheduled time");
    const normalized: PublishContentPageInput = {
      ...input,
      contentPageId: uuid(input.contentPageId, "Content page"),
      storefrontId: uuid(input.storefrontId, "Storefront"),
      publicSlug: slug(input.publicSlug),
      title: bounded(input.title, "Content page title", 240),
      contentDocument: stableValue(input.contentDocument) as Readonly<Record<string, unknown>>,
      seoDocument: stableValue(input.seoDocument ?? {}) as Readonly<Record<string, unknown>>,
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
    };
    requireSchedule(normalized.status, normalized.scheduledFor, "Scheduled content page");
    return await this.repository.publishContentPage(
      await envelope(context, normalized, "storefront.content_page.publish", normalized.contentPageId),
    );
  }

  public async publishHomepage(
    context: RequestContext,
    input: PublishHomepageInput,
  ): Promise<StatusRevisionResult> {
    requirePermission(context, "storefront.content.manage");
    const scheduledFor = dateTime(input.scheduledFor, "Scheduled time");
    const normalized: PublishHomepageInput = {
      ...input,
      homepageId: uuid(input.homepageId, "Homepage revision"),
      storefrontId: uuid(input.storefrontId, "Storefront"),
      homepageDocument: stableValue(input.homepageDocument) as Readonly<Record<string, unknown>>,
      seoDocument: stableValue(input.seoDocument ?? {}) as Readonly<Record<string, unknown>>,
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
    };
    requireSchedule(normalized.status, normalized.scheduledFor, "Scheduled homepage");
    return await this.repository.publishHomepage(
      await envelope(context, normalized, "storefront.homepage.publish", normalized.homepageId),
    );
  }
}

interface PublicationRow extends Record<string, unknown> {
  readonly id: string;
  readonly state: string;
  readonly cacheGeneration: string | number | bigint;
  readonly replayed: boolean;
}

interface MembersRow extends Record<string, unknown> {
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

function publication(row: PublicationRow): PublicationResult {
  return Object.freeze({
    id: row.id,
    state: row.state,
    cacheGeneration: BigInt(row.cacheGeneration),
    replayed: row.replayed,
  });
}

function revision(row: RevisionRow): RevisionResult {
  return Object.freeze({
    id: row.id,
    revision: BigInt(row.revision),
    cacheGeneration: BigInt(row.cacheGeneration),
    replayed: row.replayed,
  });
}

export class SqlStorefrontPublicationRepository implements StorefrontPublicationRepository {
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
  ): Promise<PublicationResult> {
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
  ): Promise<PublicationResult> {
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
          input.sortOrder,
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

  public async setCollection(command: CommandEnvelope<SetCollectionInput>): Promise<PublicationResult> {
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
          input.collectionId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.salesChannelId,
          input.code,
          input.publicSlug,
          input.title,
          input.description ?? null,
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
  ): Promise<CollectionMembersResult> {
    const input = command.input;
    const row = first(
      await this.transact<MembersRow>(
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
  ): Promise<RevisionResult> {
    const input = command.input;
    const hash = await documentHash(input.navigationDocument);
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
          hash,
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
  ): Promise<StatusRevisionResult> {
    const input = command.input;
    const hash = await documentHash({
      content: input.contentDocument,
      seo: input.seoDocument ?? {},
    });
    const row = first(
      await this.transact<StatusRevisionRow>(
        command.context,
        `SELECT content_page_id AS id, revision, status, cache_generation AS "cacheGeneration", replayed
         FROM storefront.publish_content_page_revision(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::jsonb,
           $9::jsonb,$10::text,$11::timestamptz,$12::uuid,$13::text,$14::text,$15::text,$16::text,$17::date
         )`,
        [
          input.contentPageId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.publicSlug,
          input.title,
          input.status,
          input.contentDocument,
          input.seoDocument ?? {},
          hash,
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
  ): Promise<StatusRevisionResult> {
    const input = command.input;
    const hash = await documentHash({
      homepage: input.homepageDocument,
      seo: input.seoDocument ?? {},
    });
    const row = first(
      await this.transact<StatusRevisionRow>(
        command.context,
        `SELECT homepage_id AS id, revision, status, cache_generation AS "cacheGeneration", replayed
         FROM storefront.publish_homepage_revision(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb,$7::jsonb,$8::text,
           $9::timestamptz,$10::uuid,$11::text,$12::text,$13::text,$14::text,$15::date
         )`,
        [
          input.homepageId,
          command.receiptId,
          command.context.tenantId,
          input.storefrontId,
          input.status,
          input.homepageDocument,
          input.seoDocument ?? {},
          hash,
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
