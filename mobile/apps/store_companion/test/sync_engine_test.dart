import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_api_client/store_companion_api_client.dart';
import 'package:store_companion_sync_engine/store_companion_sync_engine.dart';

void main() {
  MobileOperationContract operation() => MobileOperationContract(
    operationId: '0198-operation-1',
    localSequence: 1,
    operationType: 'inventory.count.submit.v1',
    schemaVersion: 1,
    createdAtUtc: DateTime.utc(2026, 7, 29, 12),
    businessDate: '2026-07-29',
    idempotencyKey: 'idempotency-1',
    payloadHash: 'sha256:synthetic',
    payload: const <String, Object?>{'count_id': 'synthetic-count'},
    dependencies: const <String>[],
    baseVersion: '1',
  );

  LocalOperationRecord uploadingRecord() => LocalOperationRecord(
    operation: operation(),
    state: LocalOperationState.uploading,
    attemptCount: 0,
    nextRetryAt: null,
    traceId: null,
  );

  test('accepted replay becomes terminal without retry', () {
    final reduction = OperationResultReducer.apply(
      current: uploadingRecord(),
      result: MobileOperationResultContract(
        operationId: '0198-operation-1',
        status: 'duplicate_replay',
        serverReference: 'count-result-1',
        serverVersion: '2',
        traceId: 'trace-accepted',
        error: null,
        adjustments: const <Map<String, Object?>>[],
      ),
      now: DateTime.utc(2026, 7, 29, 12, 1),
      maximumAutomaticAttempts: 3,
    );

    expect(reduction.record.state, LocalOperationState.duplicateReplay);
    expect(reduction.record.isAccepted, isTrue);
    expect(reduction.record.isTerminal, isTrue);
    expect(reduction.retryDisposition, RetryDisposition.none);
    expect(reduction.record.nextRetryAt, isNull);
  });

  test('unknown external state blocks blind retry', () {
    final reduction = OperationResultReducer.apply(
      current: uploadingRecord(),
      result: MobileOperationResultContract(
        operationId: '0198-operation-1',
        status: 'unknown_external_state',
        serverReference: 'payment-intent-1',
        serverVersion: '3',
        traceId: 'trace-unknown',
        error: MobileApiError(
          code: 'payment.external_state_unknown',
          message: 'Payment status requires recovery.',
          traceId: 'trace-unknown',
          retryable: false,
          recovery: 'query_status',
          details: const <String, Object?>{},
        ),
        adjustments: const <Map<String, Object?>>[],
      ),
      now: DateTime.utc(2026, 7, 29, 12, 1),
      maximumAutomaticAttempts: 3,
    );

    expect(
      reduction.record.state,
      LocalOperationState.unknownExternalState,
    );
    expect(reduction.retryDisposition, RetryDisposition.requireUserAction);
    expect(reduction.record.nextRetryAt, isNull);
  });

  test('retryable transient result receives bounded backoff', () {
    final reduction = OperationResultReducer.apply(
      current: uploadingRecord(),
      result: MobileOperationResultContract(
        operationId: '0198-operation-1',
        status: 'temporary_provider_failure',
        serverReference: null,
        serverVersion: null,
        traceId: 'trace-retry',
        error: MobileApiError(
          code: 'provider.temporary_unavailable',
          message: 'Try again later.',
          traceId: 'trace-retry',
          retryable: true,
          recovery: 'retry',
          details: const <String, Object?>{},
        ),
        adjustments: const <Map<String, Object?>>[],
      ),
      now: DateTime.utc(2026, 7, 29, 12),
      maximumAutomaticAttempts: 3,
    );

    expect(reduction.record.state, LocalOperationState.conflict);
    expect(reduction.retryDisposition, RetryDisposition.requireUserAction);
    expect(reduction.record.nextRetryAt, isNull);
  });

  test('terminal operation cannot transition back to upload', () {
    expect(
      LocalOperationTransitions.allows(
        LocalOperationState.accepted,
        LocalOperationState.uploading,
      ),
      isFalse,
    );
    expect(
      LocalOperationTransitions.allows(
        LocalOperationState.locallyCommitted,
        LocalOperationState.uploading,
      ),
      isTrue,
    );
  });
}
