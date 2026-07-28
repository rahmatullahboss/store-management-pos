import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { requirePermission } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import type { MoneyV1, QuantityV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";
import type {
  CatalogItemReferenceV1,
  CustomerReferenceV1,
  DomainEventEnvelopeV1,
  PaymentStatusV1,
  PriceTaxSnapshotV1,
  SalesDocumentReferenceV1,
} from "../../../packages/contracts/src/v1/contracts.js";
import type { SalesDependencyPorts } from "./simulators.js";

export * from "./simulators.js";

export type QuoteStatus = "draft" | "sent" | "accepted" | "expired" | "cancelled";
export type OrderStatus = "draft" | "confirmed" | "on_hold" | "cancelled" | "completed";
export type OrderPaymentStatus = "unpaid" | "partially_paid" | "paid" | "partially_refunded" | "refunded";
export type OrderFulfillmentStatus = "unfulfilled" | "partially_fulfilled" | "fulfilled" | "cancelled";
export type OrderInvoiceStatus = "not_invoiced" | "partially_invoiced" | "invoiced" | "credited";
export type OrderReturnStatus = "not_returned" | "partially_returned" | "returned";
export type BackorderStatus = "none" | "backordered" | "released";
export type FulfillmentMethod = "pickup" | "local_delivery" | "ship_from_store" | "split";
export type PaymentTerms = "prepaid" | "deposit" | "layaway" | "on_account";

export interface SalesLineInput {
  readonly item: CatalogItemReferenceV1;
  readonly quantity: QuantityV1;
  readonly unitPriceMinor: bigint;
  readonly taxRateBasisPoints: number;
}

export interface SalesDocumentLine {
  readonly id: string;
  readonly item: CatalogItemReferenceV1;
  readonly quantity: QuantityV1;
  readonly priceTaxSnapshot: PriceTaxSnapshotV1;
}

export interface DocumentTotal {
  readonly netMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly grossMinor: bigint;
  readonly currency: string;
  readonly scale: number;
}

export interface QuoteRevision {
  readonly version: bigint;
  readonly status: QuoteStatus;
  readonly linesHash: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface SalesQuote {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly documentNumber: string;
  readonly customer: CustomerReferenceV1;
  readonly currency: string;
  readonly status: QuoteStatus;
  readonly expiresAt?: string;
  readonly lines: readonly SalesDocumentLine[];
  readonly total: DocumentTotal;
  readonly salespersonId?: string;
  readonly commissionBasisMetadata?: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
  readonly attachments: readonly { readonly id: string; readonly name: string; readonly objectKey: string }[];
  readonly communications: readonly { readonly id: string; readonly channel: string; readonly subject: string; readonly recordedAt: string }[];
  readonly revisions: readonly QuoteRevision[];
  readonly convertedOrderId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly version: bigint;
}

export interface PaymentObservation {
  readonly intentId: string;
  readonly status: PaymentStatusV1;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly observedAt: string;
}

export interface FulfillmentObservation {
  readonly status: OrderFulfillmentStatus;
  readonly fulfilledQuantities: readonly { readonly orderLineId: string; readonly quantity: QuantityV1 }[];
  readonly backorderedQuantities: readonly { readonly orderLineId: string; readonly quantity: QuantityV1 }[];
  readonly observedAt: string;
}

export interface SalesOrder {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly documentNumber: string;
  readonly sourceQuoteId?: string;
  readonly customer: CustomerReferenceV1;
  readonly currency: string;
  readonly lines: readonly SalesDocumentLine[];
  readonly total: DocumentTotal;
  readonly fulfillmentMethod: FulfillmentMethod;
  readonly warehouseId: string;
  readonly paymentTerms: PaymentTerms;
  readonly reservationId: string;
  readonly creditDecision?: "approved" | "approval_required";
  readonly creditApprovalId?: string;
  readonly orderStatus: OrderStatus;
  readonly paymentStatus: OrderPaymentStatus;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly invoiceStatus: OrderInvoiceStatus;
  readonly returnStatus: OrderReturnStatus;
  readonly backorderStatus: BackorderStatus;
  readonly payments: readonly PaymentObservation[];
  readonly fulfillmentObservations: readonly FulfillmentObservation[];
  readonly salespersonId?: string;
  readonly commissionBasisMetadata?: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
  readonly attachments: readonly { readonly id: string; readonly name: string; readonly objectKey: string }[];
  readonly communications: readonly { readonly id: string; readonly channel: string; readonly subject: string; readonly recordedAt: string }[];
  readonly cancellation?: { readonly reason: string; readonly approvalId?: string; readonly cancelledAt: string; readonly cancelledBy: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly version: bigint;
}

export interface OperationalInvoiceLine {
  readonly id: string;
  readonly orderLineId: string;
  readonly quantity: QuantityV1;
  readonly priceTaxSnapshot: PriceTaxSnapshotV1;
}

export interface OperationalInvoice {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly documentNumber?: string;
  readonly reference?: string;
  readonly currency: string;
  readonly lines: readonly OperationalInvoiceLine[];
  readonly total: DocumentTotal;
  readonly status: "draft" | "posted";
  readonly postedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly version: bigint;
}

export interface CreditNoteLine {
  readonly id: string;
  readonly invoiceLineId: string;
  readonly quantity: QuantityV1;
  readonly originalPriceTaxSnapshot: PriceTaxSnapshotV1;
  readonly allocatedNetMinor: bigint;
  readonly allocatedTaxMinor: bigint;
  readonly allocatedGrossMinor: bigint;
}

export interface CreditNote {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly invoiceId: string;
  readonly documentNumber: string;
  readonly reason: string;
  readonly currency: string;
  readonly lines: readonly CreditNoteLine[];
  readonly total: DocumentTotal;
  readonly status: "posted";
  readonly postedAt: string;
  readonly createdBy: string;
  readonly version: bigint;
}

export interface SalesAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly action: string;
  readonly actorId: string;
  readonly targetId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly businessDate: string;
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

type IdempotencyRecord = { readonly hash: string; readonly kind: "quote" | "order" | "invoice" | "credit_note"; readonly documentId: string };

export interface SalesRepository {
  getQuote(tenantId: string, id: string): Promise<SalesQuote | null>;
  saveQuote(quote: SalesQuote): Promise<void>;
  getOrder(tenantId: string, id: string): Promise<SalesOrder | null>;
  saveOrder(order: SalesOrder): Promise<void>;
  getInvoice(tenantId: string, id: string): Promise<OperationalInvoice | null>;
  saveInvoice(invoice: OperationalInvoice): Promise<void>;
  getCreditNote(tenantId: string, id: string): Promise<CreditNote | null>;
  saveCreditNote(creditNote: CreditNote): Promise<void>;
  nextDocumentNumber(tenantId: string, legalEntityId: string, documentType: "quote" | "order" | "invoice" | "credit_note", businessDate: string): Promise<string>;
  getIdempotency(tenantId: string, scope: string, key: string): Promise<IdempotencyRecord | null>;
  putIdempotency(tenantId: string, scope: string, key: string, record: IdempotencyRecord): Promise<void>;
  appendAudit(event: SalesAuditEvent): Promise<void>;
  appendOutbox(event: DomainEventEnvelopeV1): Promise<void>;
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function output<T>(value: T): T {
  return deepFreeze(deepClone(value));
}

export class InMemorySalesRepository implements SalesRepository {
  private readonly quotes = new Map<string, SalesQuote>();
  private readonly orders = new Map<string, SalesOrder>();
  private readonly invoices = new Map<string, OperationalInvoice>();
  private readonly creditNotes = new Map<string, CreditNote>();
  private readonly sequences = new Map<string, number>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly auditEvents: SalesAuditEvent[] = [];
  readonly outboxEvents: DomainEventEnvelopeV1[] = [];

  private key(tenantId: string, id: string): string { return `${tenantId}:${id}`; }
  private idempotencyKey(tenantId: string, scope: string, key: string): string { return `${tenantId}:${scope}:${key}`; }

  async getQuote(tenantId: string, id: string): Promise<SalesQuote | null> { const value = this.quotes.get(this.key(tenantId, id)); return value ? deepClone(value) : null; }
  async saveQuote(quote: SalesQuote): Promise<void> { this.quotes.set(this.key(quote.tenantId, quote.id), deepClone(quote)); }
  async getOrder(tenantId: string, id: string): Promise<SalesOrder | null> { const value = this.orders.get(this.key(tenantId, id)); return value ? deepClone(value) : null; }
  async saveOrder(order: SalesOrder): Promise<void> { this.orders.set(this.key(order.tenantId, order.id), deepClone(order)); }
  async getInvoice(tenantId: string, id: string): Promise<OperationalInvoice | null> { const value = this.invoices.get(this.key(tenantId, id)); return value ? deepClone(value) : null; }
  async saveInvoice(invoice: OperationalInvoice): Promise<void> { this.invoices.set(this.key(invoice.tenantId, invoice.id), deepClone(invoice)); }
  async getCreditNote(tenantId: string, id: string): Promise<CreditNote | null> { const value = this.creditNotes.get(this.key(tenantId, id)); return value ? deepClone(value) : null; }
  async saveCreditNote(creditNote: CreditNote): Promise<void> { this.creditNotes.set(this.key(creditNote.tenantId, creditNote.id), deepClone(creditNote)); }

  async nextDocumentNumber(tenantId: string, legalEntityId: string, documentType: "quote" | "order" | "invoice" | "credit_note", businessDate: string): Promise<string> {
    const sequenceKey = `${tenantId}:${legalEntityId}:${documentType}:${businessDate}`;
    const next = (this.sequences.get(sequenceKey) ?? 0) + 1;
    this.sequences.set(sequenceKey, next);
    const prefix = documentType === "quote" ? "QTE" : documentType === "order" ? "ORD" : documentType === "invoice" ? "INV" : "CRN";
    return `${prefix}-${businessDate.replaceAll("-", "")}-${String(next).padStart(6, "0")}`;
  }

  async getIdempotency(tenantId: string, scope: string, key: string): Promise<IdempotencyRecord | null> { return this.idempotency.get(this.idempotencyKey(tenantId, scope, key)) ?? null; }
  async putIdempotency(tenantId: string, scope: string, key: string, record: IdempotencyRecord): Promise<void> { this.idempotency.set(this.idempotencyKey(tenantId, scope, key), deepClone(record)); }
  async appendAudit(event: SalesAuditEvent): Promise<void> { this.auditEvents.push(deepClone(event)); }
  async appendOutbox(event: DomainEventEnvelopeV1): Promise<void> { this.outboxEvents.push(deepClone(event)); }
}

function stable(value: unknown): string {
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function scope(context: RequestContext, warehouseId?: string): ScopeContextV1 {
  if (!context.legalEntityId || !context.storeId) throw new PlatformError("VALIDATION_FAILED", "legalEntityId and storeId are required for sales operations", 400);
  return {
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    storeId: context.storeId,
    ...(warehouseId ? { warehouseId } : context.warehouseId ? { warehouseId: context.warehouseId } : {}),
    actorId: context.actorId,
    ...(context.deviceId ? { deviceId: context.deviceId } : {}),
    locale: context.locale,
    timeZone: context.timeZone,
    businessDate: context.businessDate,
  };
}

function requireLegalScope(context: RequestContext): { readonly legalEntityId: string; readonly storeId: string } {
  if (!context.legalEntityId || !context.storeId) throw new PlatformError("VALIDATION_FAILED", "legalEntityId and storeId are required for sales operations", 400);
  return { legalEntityId: context.legalEntityId, storeId: context.storeId };
}

function quantityAmount(quantity: QuantityV1): bigint {
  const amount = BigInt(quantity.amount);
  if (amount <= 0n) throw new PlatformError("VALIDATION_FAILED", "Sales line quantity must be positive", 400);
  if (!Number.isInteger(quantity.scale) || quantity.scale < 0 || quantity.scale > 6) throw new PlatformError("VALIDATION_FAILED", "Quantity scale must be between 0 and 6", 400);
  return amount;
}

function money(amountMinor: bigint, currency: string): MoneyV1 { return { amountMinor: amountMinor.toString(), currency, scale: 2 }; }

function totalFromLines(lines: readonly SalesDocumentLine[], currency: string): DocumentTotal {
  let netMinor = 0n;
  let discountMinor = 0n;
  let taxMinor = 0n;
  let grossMinor = 0n;
  for (const line of lines) {
    const snapshot = line.priceTaxSnapshot;
    if (snapshot.grossTotal.currency !== currency) throw new PlatformError("VALIDATION_FAILED", "All sales lines must use the document currency", 400);
    netMinor += BigInt(snapshot.taxableBase.amountMinor);
    discountMinor += BigInt(snapshot.discountTotal.amountMinor);
    taxMinor += snapshot.taxes.reduce((sum, tax) => sum + BigInt(tax.amount.amountMinor), 0n);
    grossMinor += BigInt(snapshot.grossTotal.amountMinor);
  }
  return { netMinor, discountMinor, taxMinor, grossMinor, currency, scale: 2 };
}

function assertVersion(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) throw new PlatformError("VERSION_CONFLICT", `${label} version conflict: expected ${expected.toString()}, found ${actual.toString()}`, 409);
}

function revision(quote: SalesQuote, status: QuoteStatus, version: bigint, at: string, actorId: string): QuoteRevision {
  return { version, status, linesHash: stable(quote.lines), recordedAt: at, recordedBy: actorId };
}

function paymentStatus(order: SalesOrder, payments: readonly PaymentObservation[]): OrderPaymentStatus {
  const captured = payments.filter((payment) => payment.status === "captured").reduce((sum, payment) => sum + payment.amountMinor, 0n);
  if (captured <= 0n) return "unpaid";
  return captured >= order.total.grossMinor ? "paid" : "partially_paid";
}

function documentReference(documentType: SalesDocumentReferenceV1["documentType"], documentId: string, version: bigint, documentNumber?: string): SalesDocumentReferenceV1 {
  return { documentType, documentId, ...(documentNumber ? { documentNumber } : {}), version: version.toString() };
}

export class SalesService {
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(private readonly repository: SalesRepository, private readonly dependencies: SalesDependencyPorts, options: { readonly now?: () => string; readonly id?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => uuidV7());
  }

  async createQuote(context: RequestContext, input: {
    readonly idempotencyKey: string;
    readonly customer: CustomerReferenceV1;
    readonly currency: string;
    readonly expiresAt?: string;
    readonly lines: readonly SalesLineInput[];
    readonly salespersonId?: string;
    readonly commissionBasisMetadata?: Readonly<Record<string, string>>;
    readonly notes?: readonly string[];
  }): Promise<SalesQuote> {
    requirePermission(context, "sales.quote.create");
    const replay = await this.replay<SalesQuote>(context, "sales.quote.create", input.idempotencyKey, input);
    if (replay) return replay;
    const { legalEntityId, storeId } = requireLegalScope(context);
    const occurredAt = this.now();
    const lines = await this.calculateLines(context, input.lines, input.currency, input.customer.customerId);
    const id = this.id();
    const quoteBase: Omit<SalesQuote, "revisions"> = {
      id,
      tenantId: context.tenantId,
      legalEntityId,
      storeId,
      documentNumber: await this.repository.nextDocumentNumber(context.tenantId, legalEntityId, "quote", context.businessDate),
      customer: deepClone(input.customer),
      currency: input.currency.toUpperCase(),
      status: "draft",
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      lines,
      total: totalFromLines(lines, input.currency.toUpperCase()),
      ...(input.salespersonId ? { salespersonId: input.salespersonId } : {}),
      ...(input.commissionBasisMetadata ? { commissionBasisMetadata: deepClone(input.commissionBasisMetadata) } : {}),
      notes: [...(input.notes ?? [])],
      attachments: [],
      communications: [],
      createdAt: occurredAt,
      updatedAt: occurredAt,
      createdBy: context.actorId,
      updatedBy: context.actorId,
      version: 1n,
    };
    const quote: SalesQuote = { ...quoteBase, revisions: [] };
    const created: SalesQuote = { ...quote, revisions: [revision(quote, "draft", 1n, occurredAt, context.actorId)] };
    await this.repository.saveQuote(created);
    await this.remember(context, "sales.quote.create", input.idempotencyKey, input, "quote", created.id);
    await this.audit(context, "sales.quote.create", created.id, occurredAt, { documentNumber: created.documentNumber, grossMinor: created.total.grossMinor.toString() });
    return output(created);
  }

  async reviseQuote(context: RequestContext, input: { readonly quoteId: string; readonly expectedVersion: bigint; readonly lines: readonly SalesLineInput[]; readonly notes?: readonly string[] }): Promise<SalesQuote> {
    requirePermission(context, "sales.quote.update");
    const quote = await this.requireQuote(context.tenantId, input.quoteId);
    assertVersion(quote.version, input.expectedVersion, "Quote");
    if (quote.status !== "draft") throw new PlatformError("CONFLICT", "Only draft quotes can be revised", 409);
    const occurredAt = this.now();
    const lines = await this.calculateLines(context, input.lines, quote.currency, quote.customer.customerId);
    const nextVersion = quote.version + 1n;
    const updatedBase: SalesQuote = { ...quote, lines, total: totalFromLines(lines, quote.currency), notes: input.notes ? [...input.notes] : quote.notes, updatedAt: occurredAt, updatedBy: context.actorId, version: nextVersion };
    const updated = { ...updatedBase, revisions: [...quote.revisions, revision(updatedBase, "draft", nextVersion, occurredAt, context.actorId)] };
    await this.repository.saveQuote(updated);
    await this.audit(context, "sales.quote.revise", quote.id, occurredAt, { version: nextVersion.toString() });
    return output(updated);
  }

  async sendQuote(context: RequestContext, input: { readonly quoteId: string; readonly expectedVersion: bigint }): Promise<SalesQuote> {
    requirePermission(context, "sales.quote.send");
    return this.transitionQuote(context, input.quoteId, input.expectedVersion, "draft", "sent", "sales.quote.sent.v1");
  }

  async acceptQuote(context: RequestContext, input: { readonly quoteId: string; readonly expectedVersion: bigint }): Promise<SalesQuote> {
    requirePermission(context, "sales.quote.accept");
    return this.transitionQuote(context, input.quoteId, input.expectedVersion, "sent", "accepted", "sales.quote.accepted.v1");
  }

  async convertQuoteToOrder(context: RequestContext, input: { readonly quoteId: string; readonly expectedQuoteVersion: bigint; readonly idempotencyKey: string; readonly fulfillmentMethod: FulfillmentMethod; readonly warehouseId: string; readonly paymentTerms: PaymentTerms }): Promise<SalesOrder> {
    requirePermission(context, "sales.order.create");
    const replay = await this.replay<SalesOrder>(context, "sales.quote.convert", input.idempotencyKey, input);
    if (replay) return replay;
    const quote = await this.requireQuote(context.tenantId, input.quoteId);
    assertVersion(quote.version, input.expectedQuoteVersion, "Quote");
    if (quote.status !== "accepted") throw new PlatformError("CONFLICT", "Only accepted quotes can be converted", 409);
    const order = await this.createOrderFromCalculatedLines(context, {
      idempotencyScope: "sales.quote.convert",
      idempotencyKey: input.idempotencyKey,
      idempotencyPayload: input,
      customer: quote.customer,
      currency: quote.currency,
      lines: quote.lines,
      fulfillmentMethod: input.fulfillmentMethod,
      warehouseId: input.warehouseId,
      paymentTerms: input.paymentTerms,
      sourceQuoteId: quote.id,
      ...(quote.salespersonId ? { salespersonId: quote.salespersonId } : {}),
      ...(quote.commissionBasisMetadata ? { commissionBasisMetadata: quote.commissionBasisMetadata } : {}),
      notes: quote.notes,
    });
    const occurredAt = this.now();
    await this.repository.saveQuote({ ...quote, convertedOrderId: order.id, updatedAt: occurredAt, updatedBy: context.actorId });
    return output(order);
  }

  async createOrder(context: RequestContext, input: { readonly idempotencyKey: string; readonly customer: CustomerReferenceV1; readonly currency: string; readonly lines: readonly SalesLineInput[]; readonly fulfillmentMethod: FulfillmentMethod; readonly warehouseId: string; readonly paymentTerms: PaymentTerms; readonly salespersonId?: string; readonly commissionBasisMetadata?: Readonly<Record<string, string>>; readonly notes?: readonly string[] }): Promise<SalesOrder> {
    requirePermission(context, "sales.order.create");
    const replay = await this.replay<SalesOrder>(context, "sales.order.create", input.idempotencyKey, input);
    if (replay) return replay;
    const calculatedLines = await this.calculateLines(context, input.lines, input.currency, input.customer.customerId);
    return this.createOrderFromCalculatedLines(context, {
      idempotencyScope: "sales.order.create",
      idempotencyKey: input.idempotencyKey,
      idempotencyPayload: input,
      customer: input.customer,
      currency: input.currency.toUpperCase(),
      lines: calculatedLines,
      fulfillmentMethod: input.fulfillmentMethod,
      warehouseId: input.warehouseId,
      paymentTerms: input.paymentTerms,
      ...(input.salespersonId ? { salespersonId: input.salespersonId } : {}),
      ...(input.commissionBasisMetadata ? { commissionBasisMetadata: input.commissionBasisMetadata } : {}),
      notes: input.notes ?? [],
    });
  }

  async getOrder(context: RequestContext, orderId: string): Promise<SalesOrder> {
    requirePermission(context, "sales.order.read");
    return output(await this.requireOrder(context.tenantId, orderId));
  }

  async recordPayment(context: RequestContext, orderId: string, input: { readonly intentId: string; readonly status: PaymentStatusV1; readonly amountMinor: bigint; readonly currency: string; readonly expectedVersion: bigint }): Promise<SalesOrder> {
    requirePermission(context, "sales.order.update");
    const order = await this.requireOrder(context.tenantId, orderId);
    assertVersion(order.version, input.expectedVersion, "Order");
    if (input.currency.toUpperCase() !== order.currency) throw new PlatformError("VALIDATION_FAILED", "Payment currency must match order currency", 400);
    if (input.amountMinor <= 0n) throw new PlatformError("VALIDATION_FAILED", "Payment amount must be positive", 400);
    if (order.payments.some((payment) => payment.intentId === input.intentId && payment.status === input.status)) return output(order);
    const occurredAt = this.now();
    const payments = [...order.payments, { intentId: input.intentId, status: input.status, amountMinor: input.amountMinor, currency: input.currency.toUpperCase(), observedAt: occurredAt }];
    const updated: SalesOrder = { ...order, payments, paymentStatus: paymentStatus(order, payments), updatedAt: occurredAt, updatedBy: context.actorId, version: order.version + 1n };
    await this.repository.saveOrder(updated);
    await this.audit(context, "sales.order.payment_observed", order.id, occurredAt, { intentId: input.intentId, status: input.status, amountMinor: input.amountMinor.toString() });
    return output(updated);
  }

  async recordFulfillment(context: RequestContext, orderId: string, input: { readonly status: OrderFulfillmentStatus; readonly fulfilledQuantities: readonly { readonly orderLineId: string; readonly quantity: QuantityV1 }[]; readonly backorderedQuantities: readonly { readonly orderLineId: string; readonly quantity: QuantityV1 }[]; readonly expectedVersion: bigint }): Promise<SalesOrder> {
    requirePermission(context, "sales.order.update");
    const order = await this.requireOrder(context.tenantId, orderId);
    assertVersion(order.version, input.expectedVersion, "Order");
    for (const line of order.lines) {
      const fulfilled = input.fulfilledQuantities.filter((entry) => entry.orderLineId === line.id).reduce((sum, entry) => sum + quantityAmount(entry.quantity), 0n);
      const backordered = input.backorderedQuantities.filter((entry) => entry.orderLineId === line.id).reduce((sum, entry) => sum + quantityAmount(entry.quantity), 0n);
      if (fulfilled + backordered > quantityAmount(line.quantity)) throw new PlatformError("CONFLICT", "Fulfillment and backorder quantity cannot exceed ordered quantity", 409);
    }
    const occurredAt = this.now();
    const observation: FulfillmentObservation = { status: input.status, fulfilledQuantities: deepClone(input.fulfilledQuantities), backorderedQuantities: deepClone(input.backorderedQuantities), observedAt: occurredAt };
    const updated: SalesOrder = {
      ...order,
      fulfillmentStatus: input.status,
      backorderStatus: input.backorderedQuantities.length > 0 ? "backordered" : order.backorderStatus === "backordered" ? "released" : "none",
      fulfillmentObservations: [...order.fulfillmentObservations, observation],
      updatedAt: occurredAt,
      updatedBy: context.actorId,
      version: order.version + 1n,
    };
    await this.repository.saveOrder(updated);
    await this.event(context, "sales.order.fulfillment_changed.v1", "order", order.id, updated.version, { fulfillmentStatus: updated.fulfillmentStatus, backorderStatus: updated.backorderStatus });
    return output(updated);
  }

  async createInvoice(context: RequestContext, input: { readonly orderId: string; readonly expectedOrderVersion: bigint; readonly idempotencyKey: string }): Promise<OperationalInvoice> {
    requirePermission(context, "sales.invoice.create");
    const replay = await this.replay<OperationalInvoice>(context, "sales.invoice.create", input.idempotencyKey, input);
    if (replay) return replay;
    const order = await this.requireOrder(context.tenantId, input.orderId);
    assertVersion(order.version, input.expectedOrderVersion, "Order");
    const occurredAt = this.now();
    const invoice: OperationalInvoice = {
      id: this.id(),
      tenantId: order.tenantId,
      legalEntityId: order.legalEntityId,
      storeId: order.storeId,
      orderId: order.id,
      currency: order.currency,
      lines: order.lines.map((line) => ({ id: this.id(), orderLineId: line.id, quantity: deepClone(line.quantity), priceTaxSnapshot: deepClone(line.priceTaxSnapshot) })),
      total: deepClone(order.total),
      status: "draft",
      createdAt: occurredAt,
      updatedAt: occurredAt,
      createdBy: context.actorId,
      updatedBy: context.actorId,
      version: 1n,
    };
    await this.repository.saveInvoice(invoice);
    await this.remember(context, "sales.invoice.create", input.idempotencyKey, input, "invoice", invoice.id);
    return output(invoice);
  }

  async postInvoice(context: RequestContext, input: { readonly invoiceId: string; readonly expectedVersion: bigint }): Promise<OperationalInvoice> {
    requirePermission(context, "sales.invoice.post");
    const invoice = await this.requireInvoice(context.tenantId, input.invoiceId);
    assertVersion(invoice.version, input.expectedVersion, "Invoice");
    if (invoice.status === "posted") return output(invoice);
    const occurredAt = this.now();
    const documentNumber = await this.repository.nextDocumentNumber(context.tenantId, invoice.legalEntityId, "invoice", context.businessDate);
    const posted: OperationalInvoice = { ...invoice, documentNumber, status: "posted", postedAt: occurredAt, updatedAt: occurredAt, updatedBy: context.actorId, version: invoice.version + 1n };
    await this.repository.saveInvoice(posted);
    const order = await this.requireOrder(context.tenantId, invoice.orderId);
    await this.repository.saveOrder({ ...order, invoiceStatus: "invoiced", updatedAt: occurredAt, updatedBy: context.actorId, version: order.version + 1n });
    await this.dependencies.accounting.post({
      schemaVersion: "1.0",
      context: scope(context),
      instructionId: this.id(),
      postingGroupId: this.id(),
      source: documentReference("invoice", posted.id, posted.version, posted.documentNumber),
      lines: [
        { accountCode: "ACCOUNTS_RECEIVABLE", debit: money(posted.total.grossMinor, posted.currency), credit: money(0n, posted.currency) },
        { accountCode: "SALES_REVENUE", debit: money(0n, posted.currency), credit: money(posted.total.netMinor, posted.currency) },
        { accountCode: "TAX_PAYABLE", debit: money(0n, posted.currency), credit: money(posted.total.taxMinor, posted.currency) },
      ],
      audit: { actorId: context.actorId, requestId: context.requestId, traceId: context.traceId, ...(context.deviceId ? { deviceId: context.deviceId } : {}) },
    });
    await this.dependencies.receipt.issue({
      schemaVersion: "1.0",
      documentId: this.id(),
      documentType: "invoice",
      source: documentReference("invoice", posted.id, posted.version, posted.documentNumber),
      legalEntityId: posted.legalEntityId,
      storeId: posted.storeId,
      issuedAt: occurredAt,
      businessDate: context.businessDate,
      locale: context.locale,
      currency: posted.currency,
      totals: { net: money(posted.total.netMinor, posted.currency), tax: money(posted.total.taxMinor, posted.currency), gross: money(posted.total.grossMinor, posted.currency), paid: money(0n, posted.currency) },
      immutableContentHash: stable(posted),
    });
    await this.event(context, "sales.invoice.posted.v1", "invoice", posted.id, posted.version, { orderId: posted.orderId, documentNumber });
    return output(posted);
  }

  async updateInvoiceReference(context: RequestContext, input: { readonly invoiceId: string; readonly expectedVersion: bigint; readonly reference: string }): Promise<OperationalInvoice> {
    requirePermission(context, "sales.invoice.create");
    const invoice = await this.requireInvoice(context.tenantId, input.invoiceId);
    assertVersion(invoice.version, input.expectedVersion, "Invoice");
    if (invoice.status === "posted") throw new PlatformError("CONFLICT", "Posted invoices are immutable", 409);
    const occurredAt = this.now();
    const updated = { ...invoice, reference: input.reference.trim(), updatedAt: occurredAt, updatedBy: context.actorId, version: invoice.version + 1n };
    await this.repository.saveInvoice(updated);
    return output(updated);
  }

  async createCreditNote(context: RequestContext, input: { readonly invoiceId: string; readonly idempotencyKey: string; readonly reason: string; readonly lines: readonly { readonly invoiceLineId: string; readonly quantity: QuantityV1 }[] }): Promise<CreditNote> {
    requirePermission(context, "sales.credit_note.create");
    const replay = await this.replay<CreditNote>(context, "sales.credit_note.create", input.idempotencyKey, input);
    if (replay) return replay;
    if (input.reason.trim().length < 8) throw new PlatformError("VALIDATION_FAILED", "Credit-note reason must contain at least 8 characters", 400);
    const invoice = await this.requireInvoice(context.tenantId, input.invoiceId);
    if (invoice.status !== "posted") throw new PlatformError("CONFLICT", "Credit notes require a posted invoice", 409);
    const lines: CreditNoteLine[] = input.lines.map((requestLine) => {
      const invoiceLine = invoice.lines.find((line) => line.id === requestLine.invoiceLineId);
      if (!invoiceLine) throw new PlatformError("NOT_FOUND", "Invoice line not found", 404);
      const requested = quantityAmount(requestLine.quantity);
      const original = quantityAmount(invoiceLine.quantity);
      if (requested > original) throw new PlatformError("CONFLICT", "Credit-note quantity cannot exceed the original invoice quantity", 409);
      const allocate = (value: string) => (BigInt(value) * requested) / original;
      const tax = invoiceLine.priceTaxSnapshot.taxes.reduce((sum, component) => sum + allocate(component.amount.amountMinor), 0n);
      return {
        id: this.id(),
        invoiceLineId: invoiceLine.id,
        quantity: deepClone(requestLine.quantity),
        originalPriceTaxSnapshot: deepClone(invoiceLine.priceTaxSnapshot),
        allocatedNetMinor: allocate(invoiceLine.priceTaxSnapshot.taxableBase.amountMinor),
        allocatedTaxMinor: tax,
        allocatedGrossMinor: allocate(invoiceLine.priceTaxSnapshot.grossTotal.amountMinor),
      };
    });
    const occurredAt = this.now();
    const total: DocumentTotal = {
      netMinor: lines.reduce((sum, line) => sum + line.allocatedNetMinor, 0n),
      discountMinor: 0n,
      taxMinor: lines.reduce((sum, line) => sum + line.allocatedTaxMinor, 0n),
      grossMinor: lines.reduce((sum, line) => sum + line.allocatedGrossMinor, 0n),
      currency: invoice.currency,
      scale: 2,
    };
    const credit: CreditNote = {
      id: this.id(),
      tenantId: invoice.tenantId,
      legalEntityId: invoice.legalEntityId,
      storeId: invoice.storeId,
      invoiceId: invoice.id,
      documentNumber: await this.repository.nextDocumentNumber(context.tenantId, invoice.legalEntityId, "credit_note", context.businessDate),
      reason: input.reason.trim(),
      currency: invoice.currency,
      lines,
      total,
      status: "posted",
      postedAt: occurredAt,
      createdBy: context.actorId,
      version: 1n,
    };
    await this.repository.saveCreditNote(credit);
    await this.remember(context, "sales.credit_note.create", input.idempotencyKey, input, "credit_note", credit.id);
    const order = await this.requireOrder(context.tenantId, invoice.orderId);
    await this.repository.saveOrder({ ...order, invoiceStatus: "credited", updatedAt: occurredAt, updatedBy: context.actorId, version: order.version + 1n });
    await this.event(context, "sales.credit_note.posted.v1", "credit_note", credit.id, credit.version, { invoiceId: invoice.id, grossMinor: credit.total.grossMinor.toString() });
    return output(credit);
  }

  async voidPostedDocument(context: RequestContext, input: { readonly documentType: "invoice" | "credit_note"; readonly documentId: string; readonly reason: string }): Promise<never> {
    requirePermission(context, input.documentType === "invoice" ? "sales.invoice.post" : "sales.credit_note.create");
    if (input.documentType === "invoice") await this.requireInvoice(context.tenantId, input.documentId);
    else await this.requireCreditNote(context.tenantId, input.documentId);
    throw new PlatformError("CONFLICT", "Posted invoice and credit-note documents are immutable; issue a reversing document", 409, { reason: input.reason });
  }

  async cancelOrder(context: RequestContext, input: { readonly orderId: string; readonly expectedVersion: bigint; readonly reason: string; readonly approvalId?: string }): Promise<SalesOrder> {
    requirePermission(context, "sales.order.cancel");
    const order = await this.requireOrder(context.tenantId, input.orderId);
    assertVersion(order.version, input.expectedVersion, "Order");
    if (order.orderStatus === "cancelled") return output(order);
    const hasEffects = order.paymentStatus !== "unpaid" || order.fulfillmentStatus !== "unfulfilled" || order.invoiceStatus !== "not_invoiced";
    if (hasEffects) {
      if (!input.approvalId) throw new PlatformError("CONFLICT", "Cancellation after payment, fulfillment or invoicing requires approval", 409);
      requirePermission(context, "sales.order.cancel_after_effects");
    }
    const occurredAt = this.now();
    const updated: SalesOrder = {
      ...order,
      orderStatus: "cancelled",
      cancellation: { reason: input.reason.trim(), ...(input.approvalId ? { approvalId: input.approvalId } : {}), cancelledAt: occurredAt, cancelledBy: context.actorId },
      updatedAt: occurredAt,
      updatedBy: context.actorId,
      version: order.version + 1n,
    };
    await this.repository.saveOrder(updated);
    await this.event(context, "sales.order.cancelled.v1", "order", order.id, updated.version, { reason: input.reason, approvalId: input.approvalId ?? "" });
    return output(updated);
  }

  private async calculateLines(context: RequestContext, lines: readonly SalesLineInput[], currency: string, customerId?: string): Promise<readonly SalesDocumentLine[]> {
    if (lines.length < 1 || lines.length > 1_000) throw new PlatformError("VALIDATION_FAILED", "Sales documents must contain between 1 and 1000 lines", 400);
    const normalizedCurrency = currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new PlatformError("VALIDATION_FAILED", "currency must be a three-letter ISO code", 400);
    return Promise.all(lines.map(async (line) => {
      quantityAmount(line.quantity);
      if (line.unitPriceMinor < 0n) throw new PlatformError("VALIDATION_FAILED", "Unit price cannot be negative", 400);
      if (!Number.isInteger(line.taxRateBasisPoints) || line.taxRateBasisPoints < 0 || line.taxRateBasisPoints > 100_000) throw new PlatformError("VALIDATION_FAILED", "Tax rate basis points are invalid", 400);
      const priceTaxSnapshot = await this.dependencies.priceTax.calculate({
        schemaVersion: "1.0",
        context: scope(context),
        item: deepClone(line.item),
        quantity: deepClone(line.quantity),
        currency: normalizedCurrency,
        ...(customerId ? { customerId } : {}),
        unitPriceMinor: line.unitPriceMinor.toString(),
        taxRateBasisPoints: line.taxRateBasisPoints.toString(),
      });
      return { id: this.id(), item: deepClone(line.item), quantity: deepClone(line.quantity), priceTaxSnapshot: deepClone(priceTaxSnapshot) };
    }));
  }

  private async createOrderFromCalculatedLines(context: RequestContext, input: {
    readonly idempotencyScope: string;
    readonly idempotencyKey: string;
    readonly idempotencyPayload: unknown;
    readonly customer: CustomerReferenceV1;
    readonly currency: string;
    readonly lines: readonly SalesDocumentLine[];
    readonly fulfillmentMethod: FulfillmentMethod;
    readonly warehouseId: string;
    readonly paymentTerms: PaymentTerms;
    readonly sourceQuoteId?: string;
    readonly salespersonId?: string;
    readonly commissionBasisMetadata?: Readonly<Record<string, string>>;
    readonly notes: readonly string[];
  }): Promise<SalesOrder> {
    const { legalEntityId, storeId } = requireLegalScope(context);
    const occurredAt = this.now();
    const id = this.id();
    const total = totalFromLines(input.lines, input.currency);
    let creditDecision: SalesOrder["creditDecision"];
    let creditApprovalId: string | undefined;
    if (input.paymentTerms === "on_account") {
      const decision = await this.dependencies.credit.check({ schemaVersion: "1.0", context: scope(context, input.warehouseId), customerId: input.customer.customerId, amount: money(total.grossMinor, input.currency), sourceType: input.sourceQuoteId ? "quote" : "order", sourceId: input.sourceQuoteId ?? id });
      if (decision.decision === "declined") throw new PlatformError("CONFLICT", "Customer credit check declined the order", 409);
      if (decision.decision === "approval_required" && !decision.approvalId) throw new PlatformError("CONFLICT", "Customer credit approval is required", 409);
      creditDecision = decision.decision;
      creditApprovalId = decision.approvalId;
    }
    const reservationId = this.id();
    const reservation = await this.dependencies.inventory.reserve({
      schemaVersion: "1.0",
      context: scope(context, input.warehouseId),
      reservationId,
      sourceType: "sales_order",
      sourceId: id,
      lines: input.lines.map((line) => ({ item: deepClone(line.item), warehouseId: input.warehouseId, quantity: deepClone(line.quantity) })),
    });
    if (reservation.status === "conflict") throw new PlatformError("CONFLICT", "Inventory reservation reported a stock conflict", 409);
    const order: SalesOrder = {
      id,
      tenantId: context.tenantId,
      legalEntityId,
      storeId,
      documentNumber: await this.repository.nextDocumentNumber(context.tenantId, legalEntityId, "order", context.businessDate),
      ...(input.sourceQuoteId ? { sourceQuoteId: input.sourceQuoteId } : {}),
      customer: deepClone(input.customer),
      currency: input.currency,
      lines: deepClone(input.lines),
      total,
      fulfillmentMethod: input.fulfillmentMethod,
      warehouseId: input.warehouseId,
      paymentTerms: input.paymentTerms,
      reservationId,
      ...(creditDecision ? { creditDecision } : {}),
      ...(creditApprovalId ? { creditApprovalId } : {}),
      orderStatus: "confirmed",
      paymentStatus: "unpaid",
      fulfillmentStatus: "unfulfilled",
      invoiceStatus: "not_invoiced",
      returnStatus: "not_returned",
      backorderStatus: "none",
      payments: [],
      fulfillmentObservations: [],
      ...(input.salespersonId ? { salespersonId: input.salespersonId } : {}),
      ...(input.commissionBasisMetadata ? { commissionBasisMetadata: deepClone(input.commissionBasisMetadata) } : {}),
      notes: [...input.notes],
      attachments: [],
      communications: [],
      createdAt: occurredAt,
      updatedAt: occurredAt,
      createdBy: context.actorId,
      updatedBy: context.actorId,
      version: 1n,
    };
    await this.repository.saveOrder(order);
    await this.remember(context, input.idempotencyScope, input.idempotencyKey, input.idempotencyPayload, "order", order.id);
    await this.event(context, "sales.order.confirmed.v1", "order", order.id, order.version, { documentNumber: order.documentNumber, reservationId, grossMinor: order.total.grossMinor.toString() });
    return output(order);
  }

  private async transitionQuote(context: RequestContext, quoteId: string, expectedVersion: bigint, from: QuoteStatus, to: QuoteStatus, eventType: string): Promise<SalesQuote> {
    const quote = await this.requireQuote(context.tenantId, quoteId);
    assertVersion(quote.version, expectedVersion, "Quote");
    if (quote.status !== from) throw new PlatformError("CONFLICT", `Quote must be ${from} before it can become ${to}`, 409);
    const occurredAt = this.now();
    const nextVersion = quote.version + 1n;
    const base: SalesQuote = { ...quote, status: to, updatedAt: occurredAt, updatedBy: context.actorId, version: nextVersion };
    const updated = { ...base, revisions: [...quote.revisions, revision(base, to, nextVersion, occurredAt, context.actorId)] };
    await this.repository.saveQuote(updated);
    await this.event(context, eventType, "quote", quote.id, nextVersion, { status: to, documentNumber: quote.documentNumber });
    return output(updated);
  }

  private async replay<T>(context: RequestContext, scopeName: string, key: string, payload: unknown): Promise<T | null> {
    if (key.trim().length < 8) throw new PlatformError("VALIDATION_FAILED", "idempotencyKey must contain at least 8 characters", 400);
    const record = await this.repository.getIdempotency(context.tenantId, scopeName, key);
    if (!record) return null;
    if (record.hash !== stable(payload)) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different sales payload", 409);
    if (record.kind === "quote") return output(await this.requireQuote(context.tenantId, record.documentId)) as T;
    if (record.kind === "order") return output(await this.requireOrder(context.tenantId, record.documentId)) as T;
    if (record.kind === "invoice") return output(await this.requireInvoice(context.tenantId, record.documentId)) as T;
    return output(await this.requireCreditNote(context.tenantId, record.documentId)) as T;
  }

  private async remember(context: RequestContext, scopeName: string, key: string, payload: unknown, kind: IdempotencyRecord["kind"], documentId: string): Promise<void> {
    await this.repository.putIdempotency(context.tenantId, scopeName, key, { hash: stable(payload), kind, documentId });
  }

  private async requireQuote(tenantId: string, id: string): Promise<SalesQuote> { const value = await this.repository.getQuote(tenantId, id); if (!value) throw new PlatformError("NOT_FOUND", "Quote not found", 404); return value; }
  private async requireOrder(tenantId: string, id: string): Promise<SalesOrder> { const value = await this.repository.getOrder(tenantId, id); if (!value) throw new PlatformError("NOT_FOUND", "Order not found", 404); return value; }
  private async requireInvoice(tenantId: string, id: string): Promise<OperationalInvoice> { const value = await this.repository.getInvoice(tenantId, id); if (!value) throw new PlatformError("NOT_FOUND", "Invoice not found", 404); return value; }
  private async requireCreditNote(tenantId: string, id: string): Promise<CreditNote> { const value = await this.repository.getCreditNote(tenantId, id); if (!value) throw new PlatformError("NOT_FOUND", "Credit note not found", 404); return value; }

  private async audit(context: RequestContext, action: string, targetId: string, occurredAt: string, metadata: Readonly<Record<string, unknown>>): Promise<void> {
    await this.repository.appendAudit({ id: this.id(), tenantId: context.tenantId, action, actorId: context.actorId, targetId, requestId: context.requestId, traceId: context.traceId, businessDate: context.businessDate, occurredAt, metadata });
  }

  private async event(context: RequestContext, eventType: string, aggregateType: string, aggregateId: string, version: bigint, payload: Readonly<Record<string, unknown>>): Promise<void> {
    const occurredAt = this.now();
    await this.repository.appendOutbox({
      schemaVersion: "1.0",
      eventId: this.id(),
      eventType,
      aggregateType,
      aggregateId,
      tenantId: context.tenantId,
      occurredAt,
      businessDate: context.businessDate,
      correlationId: context.requestId,
      actorId: context.actorId,
      payload,
      metadata: { traceId: context.traceId, version: version.toString(), ...(context.legalEntityId ? { legalEntityId: context.legalEntityId } : {}), ...(context.storeId ? { storeId: context.storeId } : {}) },
    });
    await this.audit(context, eventType.replace(/\.v\d+$/u, ""), aggregateId, occurredAt, payload);
  }
}
