import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";

export type FinanceReadinessCheckStatus = "pass" | "warning" | "fail";

export interface FinanceReadinessCheck {
  readonly code: string;
  readonly label: string;
  readonly status: FinanceReadinessCheckStatus;
  readonly observed: string;
  readonly expected: string;
  readonly detail: string;
}

export interface FinanceReadinessReport {
  readonly overall: "ready" | "degraded" | "blocked";
  readonly generatedAt: string;
  readonly checks: readonly FinanceReadinessCheck[];
}

interface FinanceReadinessRow extends Record<string, unknown> {
  readonly migration_count: string;
  readonly unknown_payment_count: string;
  readonly stuck_idempotency_count: string;
  readonly unbalanced_journal_count: string;
  readonly stale_unreconciled_count: string;
  readonly open_reconciliation_exception_count: string;
  readonly stale_outbox_count: string;
  readonly finance_dead_letter_count: string;
  readonly generated_at: string;
}

function countStatus(value: string, severity: "warning" | "fail"): FinanceReadinessCheckStatus {
  return value === "0" ? "pass" : severity;
}

function check(
  code: string,
  label: string,
  status: FinanceReadinessCheckStatus,
  observed: string,
  expected: string,
  detail: string,
): FinanceReadinessCheck {
  return Object.freeze({ code, label, status, observed, expected, detail });
}

function reportFromRow(row: FinanceReadinessRow): FinanceReadinessReport {
  const migrationStatus: FinanceReadinessCheckStatus = row.migration_count === "3" ? "pass" : "fail";
  const checks = Object.freeze([
    check("command_migrations", "Finance command migrations", migrationStatus, row.migration_count, "3", "Apply PAY-0002, ACC-0002 and BNK-0002 before release."),
    check("unknown_payments", "Stale unknown payment states", countStatus(row.unknown_payment_count, "warning"), row.unknown_payment_count, "0", "Run provider status recovery before retrying payment effects."),
    check("stuck_idempotency", "Stuck finance idempotency records", countStatus(row.stuck_idempotency_count, "warning"), row.stuck_idempotency_count, "0", "Inspect abandoned processing records before replay."),
    check("journal_balance", "Unbalanced posted journals", countStatus(row.unbalanced_journal_count, "fail"), row.unbalanced_journal_count, "0", "Block release and investigate journal integrity immediately."),
    check("stale_unreconciled", "Stale unreconciled statement lines", countStatus(row.stale_unreconciled_count, "warning"), row.stale_unreconciled_count, "0", "Complete or explicitly except bank reconciliation differences."),
    check("reconciliation_exceptions", "Open reconciliation exceptions", countStatus(row.open_reconciliation_exception_count, "warning"), row.open_reconciliation_exception_count, "0", "Assign, resolve or waive each exception with evidence."),
    check("stale_outbox", "Stale finance outbox events", countStatus(row.stale_outbox_count, "fail"), row.stale_outbox_count, "0", "Restore event publishing and replay the outbox before release."),
    check("finance_dead_letters", "Pending finance dead letters", countStatus(row.finance_dead_letter_count, "fail"), row.finance_dead_letter_count, "0", "Resolve or explicitly discard each dead letter before release."),
  ]);
  const overall = checks.some((item) => item.status === "fail")
    ? "blocked"
    : checks.some((item) => item.status === "warning")
      ? "degraded"
      : "ready";
  return Object.freeze({ overall, generatedAt: row.generated_at, checks });
}

export async function readFinanceReadiness(context: RequestContext, database: NeonDatabase): Promise<FinanceReadinessReport> {
  if (!context.permissions.has("platform.audit.read")) {
    throw new PlatformError("FORBIDDEN", "platform.audit.read permission is required", 403);
  }
  return await database.withClientTransaction(context, async (client) => {
    const result = await client.query<FinanceReadinessRow>(
      `SELECT
         (SELECT count(*)::text FROM platform.schema_migrations
           WHERE migration_id IN ('PAY-0002','ACC-0002','BNK-0002')) AS migration_count,
         (SELECT count(*)::text FROM payment.payment_intents
           WHERE status = 'unknown'
             AND COALESCE(unknown_since, last_observed_at, created_at) < now() - interval '15 minutes') AS unknown_payment_count,
         (SELECT count(*)::text FROM platform.idempotency_records
           WHERE status = 'processing' AND updated_at < now() - interval '10 minutes'
             AND (scope LIKE 'payment.%' OR scope LIKE 'payments.%' OR scope LIKE 'accounting.%' OR scope LIKE 'banking.%')) AS stuck_idempotency_count,
         (SELECT count(*)::text FROM accounting.journal_entries
           WHERE total_debit_minor <> total_credit_minor
              OR total_base_debit_minor <> total_base_credit_minor) AS unbalanced_journal_count,
         (SELECT count(*)::text FROM banking.unreconciled_statement_lines_v
           WHERE unmatched_minor <> 0 AND booked_at < now() - interval '24 hours') AS stale_unreconciled_count,
         (SELECT count(*)::text FROM banking.reconciliation_exceptions
           WHERE status IN ('open','investigating','reopened')) AS open_reconciliation_exception_count,
         (SELECT count(*)::text FROM platform.outbox_events
           WHERE published_at IS NULL AND occurred_at < now() - interval '5 minutes'
             AND (event_type LIKE 'payment.%' OR event_type LIKE 'accounting.%' OR event_type LIKE 'banking.%')) AS stale_outbox_count,
         (SELECT count(*)::text FROM platform.dead_letter_records
           WHERE replay_status = 'pending'
             AND (source LIKE 'payment%' OR source LIKE 'accounting%' OR source LIKE 'banking%' OR source LIKE 'finance%')) AS finance_dead_letter_count,
         now()::text AS generated_at`,
    );
    const row = result.rows[0];
    if (!row) throw new PlatformError("DATABASE_UNAVAILABLE", "Finance readiness query returned no result", 503);
    return reportFromRow(row);
  });
}

export async function handleFinanceReadiness(context: RequestContext, database: NeonDatabase): Promise<Response> {
  const report = await readFinanceReadiness(context, database);
  return Response.json({ data: report });
}
