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

  LocalOperationRecord uploadingRecord({int attemptCount = 0}) =>
      LocalOperationRecord(
        operation: operation(),
        state: LocalOperationState.uploading,
        attemptCount: attemptCount,
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
    );

    expect(
      reduction.record.state,
      LocalOperationState.unknownExternalState,
    );
    expect(reduction.retryDisposition, RetryDisposition.requireUserAction);
    expect(reduction.record.nextRetryAt, isNull);
  });

  test('transport failure receives bounded retry without server result', () {
    final now = DateTime.utc(2026, 7, 29, 12);
    final reduction = OperationResultReducer.transportFailure(
      current: uploadingRecord(),
      now: now,
      maximumAutomaticAttempts: 3,
      connectivityAvailable: true,
    );

    expect(reduction.record.state, LocalOperationState.waitingForRetry);
    expect(reduction.retryDisposition, RetryDisposition.retryLater);
    expect(reduction.record.attemptCount, 1);
    expect(reduction.record.nextRetryAt, now.add(const Duration(seconds: 2)));
  });

  test('missing connectivity waits without blind service retry', () {
    final reduction = OperationResultReducer.transportFailure(
      current: uploadingRecord(),
      now: DateTime.utc(2026, 7, 29, 12),
      maximumAutomaticAttempts: 3,
      connectivityAvailable: false,
    );

    expect(
      reduction.record.state,
      LocalOperationState.waitingForConnectivity,
    );
    expect(
      reduction.retryDisposition,
      RetryDisposition.waitForConnectivity,
    );
    expect(reduction.record.nextRetryAt, isNull);
  });

  test('retry ceiling requires reconciliation', () {
    final reduction = OperationResultReducer.transportFailure(
      current: uploadingRecord(attemptCount: 3),
      now: DateTime.utc(2026, 7, 29, 12),
      maximumAutomaticAttempts: 3,
      connectivityAvailable: true,
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
