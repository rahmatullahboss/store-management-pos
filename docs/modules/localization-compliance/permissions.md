# MOD-F permissions

MOD-F uses permission-scoped APIs and UI routes. Database runtime roles receive read access plus reviewed security-definer command execution; permissions never grant direct table writes.

| Permission | Risk | Intended capability |
| --- | --- | --- |
| `localization.pack.read` | sensitive | Read country-pack versions, locale, currency and business-day metadata. |
| `localization.pack.activate` | privileged | Activate an effective pack for a legal entity/store through the controlled command. |
| `localization.number.allocate` | privileged | Allocate a collision-free legal number for an effective business date. |
| `localization.document.read` | sensitive | Read immutable legal-document, archive and numbering evidence. |
| `localization.document.publish` | privileged | Publish a new immutable legal-document snapshot; never edit an issued document. |
| `localization.fiscal.read` | sensitive | Read fiscal submissions, transitions and provider reconciliation evidence. |
| `localization.fiscal.submit` | privileged | Create and transition a fiscal submission through a configured provider adapter. |
| `localization.privacy.read` | sensitive | Read retention policies and privacy-operation evidence. |
| `localization.privacy.execute` | privileged | Approve, run and complete retention-aware privacy workflows. |

## Route policy

- `/localization` requires `localization.pack.read`.
- `/compliance` requires `localization.document.read`.
- Publish/activate buttons remain disabled unless the caller also holds the corresponding privileged permission.
- Fiscal and privacy queues may be read independently through `localization.fiscal.read` and `localization.privacy.read` in API/report projections.

## Separation of duties

Pack publication and pack activation should be assigned to different people where local compliance policy requires dual control. Fiscal submission recovery must not be combined with unrestricted provider credential administration. Privacy completion requires evidence references and should be independently reviewable through audit history.

## Prohibited grants

- Do not grant `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` or `TRIGGER` on `localization.*` tables to `store_app_runtime`.
- Do not grant `PUBLIC EXECUTE` on MOD-F security-definer functions.
- Do not use a privileged permission to bypass tenant, legal-entity, store, business-date, support-level or country-capability checks.
