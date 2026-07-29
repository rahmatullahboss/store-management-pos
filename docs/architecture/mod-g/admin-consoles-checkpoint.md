# MOD-G Reporting, Integration and SaaS Admin Consoles Checkpoint

**Date:** 2026-07-30  
**Branch:** `module/reporting-integrations-saas-v1`  
**Review PR:** `#45`

## Routes and permissions

- `/reporting` — `reporting.metric.read`;
- `/integrations` — `integration.connector.read`;
- `/platform/saas` — `saas.subscription.read`.

The existing application shell filters navigation by permission. Management and replay actions are independently disabled when the corresponding privileged permission is absent.

## Reporting surface

One reporting surface supports owner, store manager, finance, inventory and platform audiences. Metric cards expose:

- period and business-date context;
- tenant/store/warehouse scope;
- currency or unit;
- metric version;
- freshness and health;
- control-total reconciliation;
- drill-through links;
- asynchronous export state and retention.

Exception and export views have keyboard-scrollable table regions and explicit loading, empty, error and denied states.

## Integration surface

The integration console exposes safe operational metadata only:

- connection type and provider;
- redacted credential-reference label;
- synchronized resources;
- health, last healthy time and cursor;
- conflict count;
- webhook queued, retrying and dead-letter totals;
- permission-gated replay actions.

Raw credentials, signing references, signatures, webhook payloads and provider response bodies are never rendered.

## SaaS administration surface

The SaaS console exposes:

- current plan/version, period and subscription status;
- exact usage counters, limits and enforcement mode;
- tenant lifecycle job evidence;
- controlled feature rollouts;
- support incidents;
- visible support impersonation actor, approver, scope and expiry.

Suspension/offboarding language consistently describes data-preserving operations.

## Accessibility and responsive evidence

MOD-G has its own mandatory browser evidence command and Design CI step. Synthetic scenarios cover:

- desktop owner reporting;
- RTL inventory reporting on tablet;
- mobile reporting failure state;
- desktop integration health;
- mobile denied integration state;
- desktop SaaS administration;
- mobile RTL empty SaaS state.

The gate verifies WCAG 2 A/AA and 2.1 AA through axe, one main landmark, skip-link keyboard focus, locale/direction, unexpected clipping, viewport overflow and 200% reporting text scaling. Screenshot and JSON evidence are uploaded from `docs/architecture/mod-g/design-evidence/`.

## Security

- all user/provider labels are HTML escaped;
- prototype-like mapping paths remain rejected before they reach UI data;
- permissions filter navigation and actions;
- tables are explicit keyboard-focusable regions;
- embedded pages are sections inside the application shell, preserving one main landmark;
- synthetic fixtures contain no production customer data or credentials.
