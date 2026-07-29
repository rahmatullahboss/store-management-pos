/// Pure operation-state and retry invariants for Store Companion sync.
library;

import 'package:store_companion_api_client/store_companion_api_client.dart';

/// Durable local lifecycle of one queued mobile command.
enum LocalOperationState {
  /// User-editable local work that has not been committed for submission.
  draft,

  /// The operation is durably committed on the device.
  locallyCommitted,

  /// Submission is waiting for usable connectivity.
  waitingForConnectivity,

  /// Submission is waiting for another local operation or attachment.
  waitingForDependency,

  /// A bounded upload attempt is in progress.
  uploading,

  /// The authoritative server accepted the operation.
  accepted,

  /// The server accepted the operation with explicit adjustments.
  acceptedWithAdjustment,

  /// The server returned the original result for a duplicate replay.
  duplicateReplay,

  /// The server retained the operation for later processing.
  deferred,

  /// The action requires a current online confirmation.
  requiresOnlineConfirmation,

  /// The action requires an owning-module approval workflow.
  requiresApproval,

  /// Current server state conflicts with the local operation.
  conflict,

  /// The authoritative command was rejected.
  rejected,

  /// A newer operation or state superseded this operation.
  superseded,

  /// An external provider state is unknown and blind retry is prohibited.
  unknownExternalState,
}

/// Retry instruction produced from local and authoritative result state.
enum RetryDisposition {
  /// No automatic retry is permitted or required.
  none,

  /// Retry after the calculated bounded delay.
  retryLater,

  /// Wait until connectivity becomes usable.
  waitForConnectivity,

  /// Wait until declared operation/attachment dependencies complete.
  waitForDependency,

  /// Require explicit user reconciliation or online confirmation.
  requireUserAction,
}

/// Immutable local metadata for one operation.
final class LocalOperationRecord {
  /// Creates a local operation record.
  LocalOperationRecord({
    required this.operation,
    required this.state,
    required this.attemptCount,
    required this.nextRetryAt,
    required this.traceId,
  }) {
    if (attemptCount < 0) {
      throw ArgumentError.value(
        attemptCount,
        'attemptCount',
        'Must not be negative.',
      );
    }
  }

  /// Versioned transport operation.
  final MobileOperationContract operation;

  /// Current durable local state.
  final LocalOperationState state;

  /// Number of completed upload attempts.
  final int attemptCount;

  /// Earliest next automatic retry time, when applicable.
  final DateTime? nextRetryAt;

  /// Latest safe server trace reference.
  final String? traceId;

  /// Whether this state represents an authoritative accepted result.
  bool get isAccepted => switch (state) {
    LocalOperationState.accepted ||
    LocalOperationState.acceptedWithAdjustment ||
    LocalOperationState.duplicateReplay => true,
    _ => false,
  };

  /// Whether the operation has reached a terminal state.
  bool get isTerminal => switch (state) {
    LocalOperationState.accepted ||
    LocalOperationState.acceptedWithAdjustment ||
    LocalOperationState.duplicateReplay ||
    LocalOperationState.rejected ||
    LocalOperationState.superseded => true,
    _ => false,
  };

  /// Returns a copy with explicit state metadata.
  LocalOperationRecord copyWith({
    LocalOperationState? state,
    int? attemptCount,
    DateTime? nextRetryAt,
    bool clearNextRetryAt = false,
    String? traceId,
  }) => LocalOperationRecord(
    operation: operation,
    state: state ?? this.state,
    attemptCount: attemptCount ?? this.attemptCount,
    nextRetryAt: clearNextRetryAt ? null : nextRetryAt ?? this.nextRetryAt,
    traceId: traceId ?? this.traceId,
  );
}

/// Result of reducing an authoritative operation result into local state.
final class OperationReduction {
  /// Creates an immutable reduction result.
  const OperationReduction({
    required this.record,
    required this.retryDisposition,
  });

  /// Updated local operation record.
  final LocalOperationRecord record;

  /// Safe retry/user-action instruction.
  final RetryDisposition retryDisposition;
}

/// Pure reducer for authoritative operation outcomes.
abstract final class OperationResultReducer {
  /// Applies one authoritative result without performing network or storage I/O.
  static OperationReduction apply({
    required LocalOperationRecord current,
    required MobileOperationResultContract result,
    required DateTime now,
    required int maximumAutomaticAttempts,
  }) {
    if (current.operation.operationId != result.operationId) {
      throw ArgumentError(
        'Operation result ${result.operationId} does not match '
        '${current.operation.operationId}.',
      );
    }
    if (maximumAutomaticAttempts < 0) {
      throw ArgumentError.value(
        maximumAutomaticAttempts,
        'maximumAutomaticAttempts',
        'Must not be negative.',
      );
    }

    final state = _stateForStatus(result.status);
    final attempts = current.attemptCount + 1;
    final baseRecord = current.copyWith(
      state: state,
      attemptCount: attempts,
      clearNextRetryAt: true,
      traceId: result.traceId,
    );

    if (state == LocalOperationState.unknownExternalState ||
        state == LocalOperationState.requiresOnlineConfirmation ||
        state == LocalOperationState.requiresApproval ||
        state == LocalOperationState.conflict) {
      return OperationReduction(
        record: baseRecord,
        retryDisposition: RetryDisposition.requireUserAction,
      );
    }

    if (baseRecord.isTerminal || state == LocalOperationState.deferred) {
      return OperationReduction(
        record: baseRecord,
        retryDisposition: RetryDisposition.none,
      );
    }

    final retryable = result.error?.retryable ?? false;
    if (!retryable || attempts > maximumAutomaticAttempts) {
      return OperationReduction(
        record: baseRecord,
        retryDisposition: RetryDisposition.requireUserAction,
      );
    }

    final retryAt = now.add(_boundedBackoff(attempts));
    return OperationReduction(
      record: baseRecord.copyWith(nextRetryAt: retryAt),
      retryDisposition: RetryDisposition.retryLater,
    );
  }

  static LocalOperationState _stateForStatus(String status) => switch (status) {
    'accepted' => LocalOperationState.accepted,
    'accepted_with_adjustment' =>
      LocalOperationState.acceptedWithAdjustment,
    'duplicate_replay' => LocalOperationState.duplicateReplay,
    'deferred' => LocalOperationState.deferred,
    'requires_online_confirmation' =>
      LocalOperationState.requiresOnlineConfirmation,
    'requires_approval' => LocalOperationState.requiresApproval,
    'conflict' => LocalOperationState.conflict,
    'rejected' => LocalOperationState.rejected,
    'superseded' => LocalOperationState.superseded,
    'unknown_external_state' => LocalOperationState.unknownExternalState,
    _ => LocalOperationState.conflict,
  };

  static Duration _boundedBackoff(int attemptCount) {
    final exponent = attemptCount.clamp(1, 6);
    final seconds = 1 << exponent;
    return Duration(seconds: seconds);
  }
}

/// Validates state transitions before a storage adapter commits them.
abstract final class LocalOperationTransitions {
  /// Whether the proposed transition is valid.
  static bool allows(
    LocalOperationState from,
    LocalOperationState to,
  ) {
    if (from == to) {
      return true;
    }
    if (_terminalStates.contains(from)) {
      return false;
    }

    return switch (from) {
      LocalOperationState.draft => to == LocalOperationState.locallyCommitted,
      LocalOperationState.locallyCommitted =>
        to == LocalOperationState.waitingForConnectivity ||
            to == LocalOperationState.waitingForDependency ||
            to == LocalOperationState.uploading,
      LocalOperationState.waitingForConnectivity ||
      LocalOperationState.waitingForDependency =>
        to == LocalOperationState.uploading ||
            to == LocalOperationState.superseded,
      LocalOperationState.uploading =>
        to != LocalOperationState.draft &&
            to != LocalOperationState.locallyCommitted,
      LocalOperationState.deferred =>
        to == LocalOperationState.uploading ||
            to == LocalOperationState.superseded,
      LocalOperationState.requiresOnlineConfirmation ||
      LocalOperationState.requiresApproval ||
      LocalOperationState.conflict ||
      LocalOperationState.unknownExternalState =>
        to == LocalOperationState.uploading ||
            to == LocalOperationState.superseded ||
            to == LocalOperationState.rejected,
      LocalOperationState.accepted ||
      LocalOperationState.acceptedWithAdjustment ||
      LocalOperationState.duplicateReplay ||
      LocalOperationState.rejected ||
      LocalOperationState.superseded => false,
    };
  }

  static const Set<LocalOperationState> _terminalStates =
      <LocalOperationState>{
        LocalOperationState.accepted,
        LocalOperationState.acceptedWithAdjustment,
        LocalOperationState.duplicateReplay,
        LocalOperationState.rejected,
        LocalOperationState.superseded,
      };
}
