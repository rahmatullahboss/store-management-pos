import type { ComplianceService, CreateFiscalSubmissionCommand, TransitionPrivacyOperationCommand } from "../../../modules/compliance/src/service.js";
import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { JsonLogger, NoopMetricSink, type MetricSink } from "../../../packages/foundation/src/observability.js";

export interface FiscalSubmissionDispatchJob extends CreateFiscalSubmissionCommand {
  readonly type: "fiscal_submission_dispatch";
}

export interface PrivacyOperationTransitionJob extends TransitionPrivacyOperationCommand {
  readonly type: "privacy_operation_transition";
}

export type ComplianceJob = FiscalSubmissionDispatchJob | PrivacyOperationTransitionJob;

export interface ComplianceJobServices {
  readonly compliance: Pick<ComplianceService, "submitFiscal" | "transitionPrivacyOperation">;
}

export interface ComplianceJobObserver {
  readonly metrics?: MetricSink;
}

export interface ComplianceJobOutcome {
  readonly type: ComplianceJob["type"];
  readonly resourceId: string;
  readonly status: "completed" | "review" | "failed";
  readonly replayed?: boolean;
  readonly reason?: string;
}

function safeReason(error: unknown): string {
  if (error instanceof PlatformError) return `${error.code}:${error.message}`.slice(0, 180);
  return "UNEXPECTED:compliance job execution failed";
}

export async function executeComplianceJob(
  context: RequestContext,
  services: ComplianceJobServices,
  job: ComplianceJob,
  observer: ComplianceJobObserver = {},
): Promise<ComplianceJobOutcome> {
  const metrics = observer.metrics ?? new NoopMetricSink();
  const logger = new JsonLogger({
    requestId: context.requestId,
    traceId: context.traceId,
    tenantId: context.tenantId,
    actorId: context.actorId,
    module: "mod-f.compliance-jobs",
  });
  const startedAt = Date.now();
  const finish = (outcome: ComplianceJobOutcome): ComplianceJobOutcome => {
    const durationMs = Date.now() - startedAt;
    metrics.increment("mod_f.compliance.job", 1, { type: outcome.type, status: outcome.status });
    metrics.observe("mod_f.compliance.job.duration_ms", durationMs, { type: outcome.type, status: outcome.status });
    const fields = { type: outcome.type, resourceId: outcome.resourceId, status: outcome.status, durationMs, replayed: outcome.replayed ?? false };
    if (outcome.status === "failed") logger.error("compliance job failed", fields);
    else logger.info(outcome.status === "review" ? "compliance job requires review" : "compliance job completed", fields);
    return Object.freeze(outcome);
  };

  try {
    if (job.type === "fiscal_submission_dispatch") {
      const result = await services.compliance.submitFiscal(context, job);
      const requiresReview = result.status === "unknown" || (result.replayed && result.status === "pending");
      return finish({
        type: job.type,
        resourceId: result.submissionId,
        status: requiresReview ? "review" : result.status === "rejected" ? "failed" : "completed",
        replayed: result.replayed,
        ...(requiresReview ? { reason: "fiscal provider status requires explicit recovery or review" } : {}),
        ...(result.status === "rejected" ? { reason: result.rejectionCode ?? "fiscal submission rejected" } : {}),
      });
    }

    const result = await services.compliance.transitionPrivacyOperation(context, job);
    return finish({
      type: job.type,
      resourceId: result.operationId,
      status: result.status === "rejected" ? "failed" : "completed",
      replayed: result.replayed,
      ...(result.status === "rejected" ? { reason: "privacy operation rejected" } : {}),
    });
  } catch (error) {
    return finish({
      type: job.type,
      resourceId: job.type === "fiscal_submission_dispatch" ? job.submissionId : job.operationId,
      status: "failed",
      reason: safeReason(error),
    });
  }
}
