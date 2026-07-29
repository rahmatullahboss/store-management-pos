import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { requirePermission } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";

export type CustomerKind = "person" | "company";
export type CustomerStatus = "active" | "inactive" | "merged";
export type ContactType = "email" | "phone" | "mobile" | "website";
export type AddressType = "billing" | "shipping" | "home" | "office" | "other";

export interface CustomerContact {
  readonly id: string;
  readonly type: ContactType;
  readonly value: string;
  readonly normalizedValue: string;
  readonly primary: boolean;
  readonly verifiedAt?: string;
}

export interface CustomerAddress {
  readonly id: string;
  readonly type: AddressType;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly countryCode: string;
  readonly primary: boolean;
}

export interface ConsentHistoryEntry {
  readonly id: string;
  readonly channel: string;
  readonly purpose: string;
  readonly granted: boolean;
  readonly source: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface TaxRegistration {
  readonly countryCode: string;
  readonly registrationType: string;
  readonly registrationNumber: string;
}

export interface CustomerCreditProfile {
  readonly currency: string;
  readonly limitMinor: bigint;
  readonly balanceMinor: bigint;
  readonly paymentTermsDays: number;
  readonly status: "active" | "hold" | "closed";
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface CustomerRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId?: string;
  readonly externalId?: string;
  readonly kind: CustomerKind;
  readonly displayName: string;
  readonly person?: { readonly givenName?: string; readonly familyName?: string; readonly dateOfBirth?: string };
  readonly company?: { readonly legalName?: string; readonly registrationNumber?: string };
  readonly contacts: readonly CustomerContact[];
  readonly addresses: readonly CustomerAddress[];
  readonly tags: readonly string[];
  readonly groups: readonly string[];
  readonly taxRegistrations: readonly TaxRegistration[];
  readonly consentHistory: readonly ConsentHistoryEntry[];
  readonly creditProfile?: CustomerCreditProfile;
  readonly historicalCustomerIds: readonly string[];
  readonly status: CustomerStatus;
  readonly mergedIntoId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly version: bigint;
}

export interface CustomerAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly action: string;
  readonly actorId: string;
  readonly targetId: string;
  readonly reason?: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly businessDate: string;
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CustomerRepository {
  get(tenantId: string, customerId: string): Promise<CustomerRecord | null>;
  save(customer: CustomerRecord): Promise<void>;
  list(tenantId: string): Promise<readonly CustomerRecord[]>;
  getIdempotency(tenantId: string, scope: string, key: string): Promise<{ readonly hash: string; readonly customerId?: string; readonly result?: unknown } | null>;
  putIdempotency(tenantId: string, scope: string, key: string, value: { readonly hash: string; readonly customerId?: string; readonly result?: unknown }): Promise<void>;
  appendAudit(event: CustomerAuditEvent): Promise<void>;
}

function cloneCustomer(customer: CustomerRecord): CustomerRecord {
  return structuredClone(customer);
}

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly customers = new Map<string, CustomerRecord>();
  private readonly idempotency = new Map<string, { readonly hash: string; readonly customerId?: string; readonly result?: unknown }>();
  readonly auditEvents: CustomerAuditEvent[] = [];

  private customerKey(tenantId: string, customerId: string): string {
    return `${tenantId}:${customerId}`;
  }

  private idempotencyKey(tenantId: string, scope: string, key: string): string {
    return `${tenantId}:${scope}:${key}`;
  }

  async get(tenantId: string, customerId: string): Promise<CustomerRecord | null> {
    const customer = this.customers.get(this.customerKey(tenantId, customerId));
    return customer ? cloneCustomer(customer) : null;
  }

  async save(customer: CustomerRecord): Promise<void> {
    this.customers.set(this.customerKey(customer.tenantId, customer.id), cloneCustomer(customer));
  }

  async list(tenantId: string): Promise<readonly CustomerRecord[]> {
    return [...this.customers.values()]
      .filter((customer) => customer.tenantId === tenantId)
      .map(cloneCustomer);
  }

  async getIdempotency(tenantId: string, scope: string, key: string): Promise<{ readonly hash: string; readonly customerId?: string; readonly result?: unknown } | null> {
    return this.idempotency.get(this.idempotencyKey(tenantId, scope, key)) ?? null;
  }

  async putIdempotency(tenantId: string, scope: string, key: string, value: { readonly hash: string; readonly customerId?: string; readonly result?: unknown }): Promise<void> {
    this.idempotency.set(this.idempotencyKey(tenantId, scope, key), structuredClone(value));
  }

  async appendAudit(event: CustomerAuditEvent): Promise<void> {
    this.auditEvents.push(structuredClone(event));
  }
}

export interface CreateCustomerInput {
  readonly idempotencyKey: string;
  readonly externalId?: string;
  readonly kind: CustomerKind;
  readonly displayName: string;
  readonly person?: CustomerRecord["person"];
  readonly company?: CustomerRecord["company"];
  readonly contacts?: readonly { readonly type: ContactType; readonly value: string; readonly primary?: boolean; readonly verifiedAt?: string }[];
  readonly addresses?: readonly { readonly type: AddressType; readonly line1: string; readonly line2?: string; readonly city: string; readonly region?: string; readonly postalCode?: string; readonly countryCode: string; readonly primary?: boolean }[];
  readonly tags?: readonly string[];
  readonly groups?: readonly string[];
  readonly taxRegistrations?: readonly TaxRegistration[];
}

export interface CreditDecision {
  readonly decision: "approved" | "approval_required" | "declined";
  readonly availableMinor: bigint;
  readonly approvalRequired: boolean;
  readonly excessMinor?: bigint;
  readonly reason?: string;
}

export interface DuplicateCandidate {
  readonly customerId: string;
  readonly displayName: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface CustomerImportRow {
  readonly externalId: string;
  readonly kind: CustomerKind;
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly countryCode?: string;
}

export interface CustomerExportRow extends CustomerImportRow {
  readonly customerId: string;
  readonly status: CustomerStatus;
  readonly version: string;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeTag(value: string): string {
  return normalizeText(value).toLocaleLowerCase("en");
}

function normalizeContact(type: ContactType, value: string): string {
  const trimmed = normalizeText(value);
  if (type === "email") return trimmed.toLocaleLowerCase("en");
  if (type === "phone" || type === "mobile") {
    const prefix = trimmed.startsWith("+") ? "+" : "";
    return `${prefix}${trimmed.replace(/\D/gu, "")}`;
  }
  return trimmed.toLocaleLowerCase("en");
}

function normalizeCountry(value: string): string {
  const country = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new PlatformError("VALIDATION_FAILED", "countryCode must be an ISO 3166-1 alpha-2 code", 400);
  return country;
}

function stable(value: unknown): string {
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeTag).filter(Boolean))].sort();
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  const map = new Map<string, T>();
  for (const value of values) if (!map.has(key(value))) map.set(key(value), value);
  return [...map.values()];
}

function assertExpectedVersion(customer: CustomerRecord, expectedVersion: bigint): void {
  if (customer.version !== expectedVersion) {
    throw new PlatformError("VERSION_CONFLICT", `Customer version conflict: expected ${expectedVersion.toString()}, found ${customer.version.toString()}`, 409);
  }
}

function validateDisplayName(value: string): string {
  const name = normalizeText(value);
  if (name.length < 1 || name.length > 200) throw new PlatformError("VALIDATION_FAILED", "displayName must contain 1 to 200 characters", 400);
  return name;
}

export class CustomerService {
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(private readonly repository: CustomerRepository, options: { readonly now?: () => string; readonly id?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => uuidV7());
  }

  async create(context: RequestContext, input: CreateCustomerInput): Promise<CustomerRecord> {
    requirePermission(context, "customer.profile.create");
    if (input.idempotencyKey.trim().length < 8) throw new PlatformError("VALIDATION_FAILED", "idempotencyKey must contain at least 8 characters", 400);
    const requestHash = stable(input);
    const existing = await this.repository.getIdempotency(context.tenantId, "customer.profile.create", input.idempotencyKey);
    if (existing) {
      if (existing.hash !== requestHash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different customer payload", 409);
      if (!existing.customerId) throw new PlatformError("CONFLICT", "Customer creation is still processing", 409);
      return await this.requireCustomer(context.tenantId, existing.customerId);
    }

    const occurredAt = this.now();
    const contacts = (input.contacts ?? []).map((contact) => ({
      id: this.id(),
      type: contact.type,
      value: normalizeText(contact.value),
      normalizedValue: normalizeContact(contact.type, contact.value),
      primary: contact.primary ?? false,
      ...(contact.verifiedAt ? { verifiedAt: contact.verifiedAt } : {}),
    }));
    const addresses = (input.addresses ?? []).map((address) => ({
      id: this.id(),
      type: address.type,
      line1: normalizeText(address.line1),
      ...(address.line2 ? { line2: normalizeText(address.line2) } : {}),
      city: normalizeText(address.city),
      ...(address.region ? { region: normalizeText(address.region) } : {}),
      ...(address.postalCode ? { postalCode: normalizeText(address.postalCode) } : {}),
      countryCode: normalizeCountry(address.countryCode),
      primary: address.primary ?? false,
    }));
    const taxRegistrations = (input.taxRegistrations ?? []).map((registration) => ({
      countryCode: normalizeCountry(registration.countryCode),
      registrationType: normalizeText(registration.registrationType).toUpperCase(),
      registrationNumber: normalizeText(registration.registrationNumber).toUpperCase(),
    }));
    const id = this.id();
    const customer: CustomerRecord = {
      id,
      tenantId: context.tenantId,
      ...(context.legalEntityId ? { legalEntityId: context.legalEntityId } : {}),
      ...(input.externalId ? { externalId: normalizeText(input.externalId) } : {}),
      kind: input.kind,
      displayName: validateDisplayName(input.displayName),
      ...(input.person ? { person: structuredClone(input.person) } : {}),
      ...(input.company ? { company: structuredClone(input.company) } : {}),
      contacts,
      addresses,
      tags: uniqueSorted(input.tags ?? []),
      groups: uniqueSorted(input.groups ?? []),
      taxRegistrations,
      consentHistory: [],
      historicalCustomerIds: [],
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
      createdBy: context.actorId,
      updatedBy: context.actorId,
      version: 1n,
    };
    await this.repository.save(customer);
    await this.repository.putIdempotency(context.tenantId, "customer.profile.create", input.idempotencyKey, { hash: requestHash, customerId: id });
    await this.audit(context, "customer.profile.create", id, occurredAt, { kind: customer.kind, displayName: customer.displayName });
    return cloneCustomer(customer);
  }

  async get(context: RequestContext, customerId: string): Promise<CustomerRecord> {
    requirePermission(context, "customer.profile.read");
    return await this.requireCustomer(context.tenantId, customerId);
  }

  async list(context: RequestContext, input: { readonly cursor?: string; readonly limit?: number; readonly includeMerged?: boolean } = {}): Promise<{ readonly items: readonly CustomerRecord[]; readonly nextCursor?: string }> {
    requirePermission(context, "customer.profile.read");
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new PlatformError("VALIDATION_FAILED", "limit must be between 1 and 500", 400);
    const customers = (await this.repository.list(context.tenantId))
      .filter((customer) => input.includeMerged === true || customer.status !== "merged")
      .sort((left, right) => left.id.localeCompare(right.id));
    const start = input.cursor ? Math.max(0, customers.findIndex((customer) => customer.id === input.cursor) + 1) : 0;
    const items = customers.slice(start, start + limit);
    const next = customers[start + limit];
    return { items, ...(next && items.length > 0 ? { nextCursor: items.at(-1)!.id } : {}) };
  }

  async recordConsent(context: RequestContext, customerId: string, input: { readonly channel: string; readonly purpose: string; readonly granted: boolean; readonly source: string; readonly expectedVersion: bigint }): Promise<CustomerRecord> {
    requirePermission(context, "customer.profile.update");
    const customer = await this.requireCustomer(context.tenantId, customerId);
    assertExpectedVersion(customer, input.expectedVersion);
    const occurredAt = this.now();
    const updated: CustomerRecord = {
      ...customer,
      consentHistory: [...customer.consentHistory, {
        id: this.id(),
        channel: normalizeText(input.channel),
        purpose: normalizeText(input.purpose),
        granted: input.granted,
        source: normalizeText(input.source),
        recordedAt: occurredAt,
        recordedBy: context.actorId,
      }],
      updatedAt: occurredAt,
      updatedBy: context.actorId,
      version: customer.version + 1n,
    };
    await this.repository.save(updated);
    await this.audit(context, "customer.consent.record", customerId, occurredAt, { channel: input.channel, purpose: input.purpose, granted: input.granted });
    return cloneCustomer(updated);
  }

  async findDuplicates(context: RequestContext, customerId: string): Promise<readonly DuplicateCandidate[]> {
    requirePermission(context, "customer.profile.read");
    const customer = await this.requireCustomer(context.tenantId, customerId);
    const candidates: DuplicateCandidate[] = [];
    for (const other of await this.repository.list(context.tenantId)) {
      if (other.id === customer.id || other.status === "merged") continue;
      const reasons: string[] = [];
      const contactValues = new Set(customer.contacts.map((contact) => `${contact.type}:${contact.normalizedValue}`));
      if (other.contacts.some((contact) => contactValues.has(`${contact.type}:${contact.normalizedValue}`))) reasons.push("matching_contact");
      const registrations = new Set(customer.taxRegistrations.map((registration) => `${registration.countryCode}:${registration.registrationType}:${registration.registrationNumber}`));
      if (other.taxRegistrations.some((registration) => registrations.has(`${registration.countryCode}:${registration.registrationType}:${registration.registrationNumber}`))) reasons.push("matching_tax_registration");
      if (normalizeTag(other.displayName) === normalizeTag(customer.displayName)) reasons.push("matching_name");
      if (reasons.length > 0) candidates.push({ customerId: other.id, displayName: other.displayName, score: Math.min(100, reasons.length * 45), reasons });
    }
    return candidates.sort((left, right) => right.score - left.score || left.customerId.localeCompare(right.customerId));
  }

  async merge(context: RequestContext, input: { readonly survivorId: string; readonly duplicateId: string; readonly expectedSurvivorVersion: bigint; readonly expectedDuplicateVersion: bigint; readonly reason: string }): Promise<{ readonly survivor: CustomerRecord; readonly duplicate: CustomerRecord }> {
    requirePermission(context, "customer.profile.merge");
    if (input.survivorId === input.duplicateId) throw new PlatformError("VALIDATION_FAILED", "A customer cannot be merged into itself", 400);
    if (normalizeText(input.reason).length < 8) throw new PlatformError("VALIDATION_FAILED", "Merge reason must contain at least 8 characters", 400);
    const survivor = await this.requireCustomer(context.tenantId, input.survivorId);
    const duplicate = await this.requireCustomer(context.tenantId, input.duplicateId);
    assertExpectedVersion(survivor, input.expectedSurvivorVersion);
    assertExpectedVersion(duplicate, input.expectedDuplicateVersion);
    if (survivor.status === "merged" || duplicate.status === "merged") throw new PlatformError("CONFLICT", "Merged customer records cannot be merged again", 409);
    const occurredAt = this.now();
    const mergedSurvivor: CustomerRecord = {
      ...survivor,
      contacts: uniqueBy([...survivor.contacts, ...duplicate.contacts], (contact) => `${contact.type}:${contact.normalizedValue}`),
      addresses: uniqueBy([...survivor.addresses, ...duplicate.addresses], (address) => `${address.type}:${address.line1}:${address.city}:${address.postalCode ?? ""}:${address.countryCode}`),
      tags: uniqueSorted([...survivor.tags, ...duplicate.tags]),
      groups: uniqueSorted([...survivor.groups, ...duplicate.groups]),
      taxRegistrations: uniqueBy([...survivor.taxRegistrations, ...duplicate.taxRegistrations], (registration) => `${registration.countryCode}:${registration.registrationType}:${registration.registrationNumber}`),
      consentHistory: [...survivor.consentHistory, ...duplicate.consentHistory].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt)),
      historicalCustomerIds: [...new Set([...survivor.historicalCustomerIds, duplicate.id, ...duplicate.historicalCustomerIds])].sort(),
      updatedAt: occurredAt,
      updatedBy: context.actorId,
      version: survivor.version + 1n,
    };
    const mergedDuplicate: CustomerRecord = {
      ...duplicate,
      status: "merged",
      mergedIntoId: survivor.id,
      updatedAt: occurredAt,
      updatedBy: context.actorId,
      version: duplicate.version + 1n,
    };
    await this.repository.save(mergedSurvivor);
    await this.repository.save(mergedDuplicate);
    await this.audit(context, "customer.profile.merge", survivor.id, occurredAt, { duplicateId: duplicate.id }, input.reason);
    return { survivor: cloneCustomer(mergedSurvivor), duplicate: cloneCustomer(mergedDuplicate) };
  }

  async setCreditProfile(context: RequestContext, customerId: string, input: { readonly currency: string; readonly limitMinor: bigint; readonly balanceMinor: bigint; readonly paymentTermsDays: number; readonly status: CustomerCreditProfile["status"]; readonly expectedVersion: bigint }): Promise<CustomerRecord> {
    requirePermission(context, "customer.credit.manage");
    const customer = await this.requireCustomer(context.tenantId, customerId);
    assertExpectedVersion(customer, input.expectedVersion);
    if (!/^[A-Z]{3}$/.test(input.currency.toUpperCase())) throw new PlatformError("VALIDATION_FAILED", "Credit currency must be a three-letter ISO code", 400);
    if (input.limitMinor < 0n || input.balanceMinor < 0n) throw new PlatformError("VALIDATION_FAILED", "Credit limit and balance cannot be negative", 400);
    if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 365) throw new PlatformError("VALIDATION_FAILED", "paymentTermsDays must be between 0 and 365", 400);
    const occurredAt = this.now();
    const updated: CustomerRecord = {
      ...customer,
      creditProfile: {
        currency: input.currency.toUpperCase(),
        limitMinor: input.limitMinor,
        balanceMinor: input.balanceMinor,
        paymentTermsDays: input.paymentTermsDays,
        status: input.status,
        updatedAt: occurredAt,
        updatedBy: context.actorId,
      },
      updatedAt: occurredAt,
      updatedBy: context.actorId,
      version: customer.version + 1n,
    };
    await this.repository.save(updated);
    await this.audit(context, "customer.credit.manage", customerId, occurredAt, { currency: input.currency, limitMinor: input.limitMinor.toString(), status: input.status });
    return cloneCustomer(updated);
  }

  async checkCredit(context: RequestContext, input: { readonly customerId: string; readonly amountMinor: bigint; readonly currency: string }): Promise<CreditDecision> {
    requirePermission(context, "customer.profile.read");
    if (input.amountMinor < 0n) throw new PlatformError("VALIDATION_FAILED", "Credit check amount cannot be negative", 400);
    const customer = await this.requireCustomer(context.tenantId, input.customerId);
    const profile = customer.creditProfile;
    if (!profile || profile.status !== "active") return { decision: "declined", availableMinor: 0n, approvalRequired: false, reason: "credit_not_active" };
    if (profile.currency !== input.currency.toUpperCase()) return { decision: "declined", availableMinor: 0n, approvalRequired: false, reason: "currency_mismatch" };
    const availableMinor = profile.limitMinor > profile.balanceMinor ? profile.limitMinor - profile.balanceMinor : 0n;
    if (input.amountMinor <= availableMinor) return { decision: "approved", availableMinor, approvalRequired: false };
    return { decision: "approval_required", availableMinor, approvalRequired: true, excessMinor: input.amountMinor - availableMinor };
  }

  async authorizeCreditOverride(context: RequestContext, input: { readonly customerId: string; readonly amountMinor: bigint; readonly currency: string; readonly reason: string; readonly expectedVersion: bigint }): Promise<{ readonly approved: true; readonly approvalId: string; readonly approverId: string; readonly customerId: string; readonly amountMinor: bigint; readonly currency: string; readonly approvedAt: string }> {
    requirePermission(context, "customer.credit.approve");
    const customer = await this.requireCustomer(context.tenantId, input.customerId);
    assertExpectedVersion(customer, input.expectedVersion);
    if (normalizeText(input.reason).length < 8) throw new PlatformError("VALIDATION_FAILED", "Credit override reason must contain at least 8 characters", 400);
    const occurredAt = this.now();
    const updated: CustomerRecord = { ...customer, updatedAt: occurredAt, updatedBy: context.actorId, version: customer.version + 1n };
    await this.repository.save(updated);
    const approvalId = this.id();
    await this.audit(context, "customer.credit.approve", customer.id, occurredAt, { approvalId, amountMinor: input.amountMinor.toString(), currency: input.currency.toUpperCase() }, input.reason);
    return { approved: true, approvalId, approverId: context.actorId, customerId: customer.id, amountMinor: input.amountMinor, currency: input.currency.toUpperCase(), approvedAt: occurredAt };
  }

  async importCustomers(context: RequestContext, input: { readonly idempotencyKey: string; readonly rows: readonly CustomerImportRow[] }): Promise<{ readonly imported: number; readonly skipped: number; readonly errors: readonly { readonly row: number; readonly message: string }[] }> {
    requirePermission(context, "customer.import");
    if (input.rows.length > 1_000) throw new PlatformError("VALIDATION_FAILED", "Customer imports are limited to 1000 rows per job", 400);
    const requestHash = stable(input);
    const existing = await this.repository.getIdempotency(context.tenantId, "customer.import", input.idempotencyKey);
    if (existing) {
      if (existing.hash !== requestHash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Import idempotency key was reused with different rows", 409);
      return structuredClone(existing.result) as { readonly imported: number; readonly skipped: number; readonly errors: readonly { readonly row: number; readonly message: string }[] };
    }
    let imported = 0;
    let skipped = 0;
    const errors: { row: number; message: string }[] = [];
    for (const [index, row] of input.rows.entries()) {
      try {
        const alreadyExists = (await this.repository.list(context.tenantId)).some((customer) => customer.externalId === row.externalId);
        if (alreadyExists) {
          skipped += 1;
          continue;
        }
        await this.create(context, {
          idempotencyKey: `${input.idempotencyKey}:${row.externalId}`,
          externalId: row.externalId,
          kind: row.kind,
          displayName: row.displayName,
          ...(row.email || row.phone ? { contacts: [
            ...(row.email ? [{ type: "email" as const, value: row.email, primary: true }] : []),
            ...(row.phone ? [{ type: "phone" as const, value: row.phone, primary: !row.email }] : []),
          ] } : {}),
          ...(row.countryCode ? { addresses: [{ type: "billing", line1: "Imported address pending verification", city: "Imported", countryCode: row.countryCode, primary: true }] } : {}),
        });
        imported += 1;
      } catch (error) {
        errors.push({ row: index + 1, message: error instanceof Error ? error.message : "Unknown import error" });
      }
    }
    const result = { imported, skipped, errors };
    await this.repository.putIdempotency(context.tenantId, "customer.import", input.idempotencyKey, { hash: requestHash, result });
    await this.audit(context, "customer.import", input.idempotencyKey, this.now(), { imported, skipped, errors: errors.length });
    return result;
  }

  async exportCustomers(context: RequestContext, input: { readonly cursor?: string; readonly limit?: number } = {}): Promise<{ readonly rows: readonly CustomerExportRow[]; readonly nextCursor?: string }> {
    requirePermission(context, "customer.export");
    const page = await this.list({ ...context, permissions: new Set([...context.permissions, "customer.profile.read"]) }, input);
    const rows = page.items
      .filter((customer): customer is CustomerRecord & { readonly externalId: string } => customer.externalId !== undefined)
      .map((customer) => ({
        externalId: customer.externalId,
        customerId: customer.id,
        kind: customer.kind,
        displayName: customer.displayName,
        ...(customer.contacts.find((contact) => contact.type === "email")?.value ? { email: customer.contacts.find((contact) => contact.type === "email")!.value } : {}),
        ...(customer.contacts.find((contact) => contact.type === "phone" || contact.type === "mobile")?.value ? { phone: customer.contacts.find((contact) => contact.type === "phone" || contact.type === "mobile")!.value } : {}),
        ...(customer.addresses[0]?.countryCode ? { countryCode: customer.addresses[0].countryCode } : {}),
        status: customer.status,
        version: customer.version.toString(),
      }))
      .sort((left, right) => left.externalId.localeCompare(right.externalId));
    return { rows, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  private async requireCustomer(tenantId: string, customerId: string): Promise<CustomerRecord> {
    const customer = await this.repository.get(tenantId, customerId);
    if (!customer) throw new PlatformError("NOT_FOUND", "Customer not found", 404);
    return customer;
  }

  private async audit(context: RequestContext, action: string, targetId: string, occurredAt: string, metadata: Readonly<Record<string, unknown>>, reason?: string): Promise<void> {
    await this.repository.appendAudit({
      id: this.id(),
      tenantId: context.tenantId,
      action,
      actorId: context.actorId,
      targetId,
      ...(reason ? { reason } : {}),
      requestId: context.requestId,
      traceId: context.traceId,
      businessDate: context.businessDate,
      occurredAt,
      metadata,
    });
  }
}
