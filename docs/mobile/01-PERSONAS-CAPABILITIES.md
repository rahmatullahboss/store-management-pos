# Store Companion — Personas, Workspaces and Capabilities

## 1. Access model

Store Companion does not grant access because a screen is present or because the client believes a user has a role. Every command and query is authorised by the server using verified identity and current context.

Decision inputs include:

- tenant membership;
- legal entity;
- store and warehouse scope;
- role/action permission;
- document and workflow state;
- approval amount or discount threshold;
- device registration and risk state;
- session assurance/MFA level;
- business date and country-pack limitation;
- current assignment, such as purchase order, stock count or sales territory.

The mobile client uses capability results to compose navigation and explain unavailable actions. Hiding a control is never the only authorization control.

## 2. Workspace model

A user may select an active workspace after authentication:

```text
tenant
  -> legal entity
    -> store or warehouse
      -> operational persona/context
```

Examples:

- `Ozzyl Retail / Dhaka Entity / Dhanmondi Store / Store Manager`
- `Ozzyl Retail / Dhaka Entity / Central Warehouse / Inventory Operator`
- `Ozzyl Retail / Group Scope / Owner Review`

Workspace selection does not mint new authority. It narrows the current context to a server-approved membership and scope. Every API request carries a server-issued workspace-context reference or equivalent verified claims; arbitrary client-supplied tenant/store IDs are rejected.

## 3. Persona outcomes

### Business owner or director

Primary outcomes:

- review business health and exceptions;
- compare authorised stores and periods;
- approve high-risk requests;
- drill from a metric or alert to its source;
- see freshness, currency, timezone and business-date context.

The authoritative KPI implementation depends on MOD-G. Before MOD-G, this persona receives bounded operational queues and source-document summaries only.

### Store manager

Primary outcomes:

- review store exceptions and device/sync health;
- approve permitted discounts, refunds, stock variances and cash-independent requests;
- review low stock, transfer and receiving discrepancies;
- inspect sale, return, payment and fulfilment state;
- coordinate daily store work without running native POS.

### Inventory or warehouse operator

Primary outcomes:

- scan and identify products/variants;
- inspect assigned-location stock;
- receive purchase orders;
- dispatch/receive transfers;
- perform counts and recounts;
- capture serial, batch, expiry, condition and evidence;
- complete assigned pick/pack actions.

### Purchaser or receiving manager

Primary outcomes:

- review requisitions, purchase orders and supplier terms;
- approve within policy;
- inspect receiving exceptions and three-way-match status;
- review cost and lead-time history;
- act on replenishment proposals when the read model exists.

### Sales representative

Primary outcomes:

- find/create permitted customers;
- create and revise quotations;
- review orders, availability, credit and fulfilment;
- request approvals;
- inspect collection/payment status without handling card secrets.

### Accountant or finance reviewer

Primary outcomes:

- review payment unknown states, allocations, settlements and reconciliation exceptions;
- inspect receivable/payable and close-readiness status;
- approve only explicitly mobile-enabled finance workflows;
- drill through to immutable journals and operational sources;
- avoid unrestricted mobile manual-journal entry in P0.

## 4. Capability naming

Capabilities are business-oriented and versioned. Suggested first-party mobile vocabulary:

```text
mobile.bootstrap.read
mobile.device.enrol
mobile.device.revoke_self
mobile.notification.read
mobile.notification.preference.manage

catalog.item.read
catalog.barcode.lookup
pricing.snapshot.read

inventory.balance.read
inventory.movement.read
inventory.count.read
inventory.count.create
inventory.count.submit
inventory.count.approve
inventory.transfer.read
inventory.transfer.dispatch
inventory.transfer.receive
inventory.adjustment.request
inventory.adjustment.approve

procurement.requisition.read
procurement.requisition.approve
procurement.purchase_order.read
procurement.purchase_order.approve
procurement.receipt.create
procurement.receipt.post
procurement.inspection.decide

customer.read
customer.create_limited
customer.update_limited
sales.quote.read
sales.quote.create
sales.quote.revise
sales.order.read
sales.order.create
sales.order.approval.request
fulfillment.work.read
fulfillment.pick
fulfillment.pack
fulfillment.dispatch
fulfillment.delivery.confirm
return.read
return.approve

approval.inbox.read
approval.decision.submit

payment.status.read
finance.receivable.read
finance.payable.read
finance.reconciliation.read
finance.close_readiness.read
reporting.dashboard.read
reporting.metric.drill
```

These names are a mobile composition proposal. Domain modules retain ownership of their existing permission names. The final bootstrap contract maps domain permissions to client capabilities without silently broadening access.

## 5. Capability matrix

| Workflow | Owner | Store manager | Inventory/warehouse | Purchaser | Sales | Finance | Offline classification |
|---|---:|---:|---:|---:|---:|---:|---|
| Product/barcode lookup | Read | Read | Read | Read | Read | Optional | Cached read |
| Stock balance lookup | Read | Read | Scoped read | Read | Scoped read | Optional | Cached read with freshness |
| Purchase-order receiving | No | Optional | Assigned | Assigned | No | Read | Draft/queued; final policy-dependent |
| Stock count | Read | Manage/approve | Assigned | No | No | Read | Draft/queued |
| Transfer dispatch/receive | Read | Manage | Assigned | Read | No | Read | Draft; authoritative post normally online |
| Quotation | Read | Read | No | No | Create/revise | Read | Draft/queued |
| Sales order | Read | Manage | Fulfilment view | No | Create/read | Read | Reads cached; state transitions usually online |
| Refund approval | Threshold | Threshold | No | No | Request | Optional control | Online only |
| Discount/price override approval | Threshold | Threshold | No | No | Request | No | Online only |
| Inventory variance approval | Threshold | Threshold | Request | No | No | Read | Online only |
| Purchase approval | Threshold | Optional | No | Threshold | No | Optional control | Online only |
| Finance reconciliation/close | Read | No | No | No | No | Manage | Online only |
| Governed KPI dashboard | Read | Scoped | Operational | Procurement | Sales | Finance | Cached read after MOD-G |

The table describes expected product behaviour, not grants. Tenant-configured policy and current server decisions are authoritative.

## 6. Approval contract

A mobile approval decision contains:

- approval request ID and version;
- source document type and opaque ID;
- requested action;
- policy/version that created the request;
- amount/currency or relevant threshold data;
- reason and evidence summary;
- actor, workspace and device context;
- assurance/MFA evidence where required;
- decision, reason and optional attachment references;
- idempotency key and trace ID.

The server rejects stale, superseded, unauthorised or out-of-scope approvals. A push notification or deep link is never approval evidence.

## 7. Navigation rules

- Show only destinations that contain at least one permitted task or useful authorised read.
- Do not reveal restricted counts, document existence or exception details through badges.
- A missing capability produces a stable restricted state, not a client crash.
- When access changes, the next bootstrap/sync invalidates routes and cached restricted data.
- Multi-role users switch workspace without signing into separate accounts.
- Deep links are re-authorised after opening and never trust notification payload data.

## 8. Bootstrap requirements

The mobile bootstrap response must include or reference:

- user identity and current session assurance;
- memberships and selectable workspaces;
- active workspace;
- effective capabilities and approval limits;
- enabled modules/entitlements;
- effective locale, timezone, currency and business date;
- country-pack capability/limitation summary;
- minimum and recommended client versions;
- API, sync and local-schema compatibility ranges;
- device registration and revocation state;
- data-classification/cache restrictions;
- feature flags with version and expiry.

The bootstrap is bounded and versioned. It does not dump the full role or policy database to the device.
