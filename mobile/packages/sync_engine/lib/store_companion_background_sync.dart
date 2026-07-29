/// Platform-neutral background synchronization policy for Store Companion.
library;

/// Source that requested one synchronization evaluation.
enum SyncExecutionTrigger {
  appStart,
  appResume,
  workspaceChanged,
  userInitiated,
  queuedOperation,
  foregroundTimer,
  platformBackground,
  pushHint,
}

/// Health of the encrypted local store before synchronization begins.
enum LocalStorageHealth {
  healthy,
  lowSpace,
  quarantinedCorruption,
  incompatibleSchema,
}

/// High-level work that a native adapter may request.
enum BackgroundSyncPlanKind {
  noWork,
  delayed,
  blocked,
  localMaintenance,
  boundedWork,
  recoveryOnly,
}

/// Stable explanation for one synchronization plan.
enum BackgroundSyncPlanReason {
  noWork,
  sessionRevoked,
  authenticationRequired,
  workspaceAuthorizationRequired,
  coordinatorAlreadyRunning,
  storageRecoveryRequired,
  supportedUpdateRequired,
  connectivityUnavailable,
  backgroundRestricted,
  retryNotDue,
  lowSpaceProjectionEviction,
  ready,
  unknownExternalStateRecovery,
}

/// Immutable inputs available to a platform-neutral coordinator.
final class BackgroundSyncSnapshot {
  BackgroundSyncSnapshot({
    required this.trigger,
    required this.sessionAuthenticated,
    required this.sessionRevoked,
    required this.workspaceAuthorized,
    required this.coordinatorRunning,
    required this.storageHealth,
    required this.connectivityAvailable,
    required this.batterySaverEnabled,
    required this.dataSaverEnabled,
    required this.pendingOperationCount,
    required this.hasUnknownExternalState,
    required this.projectionRefreshDue,
    required this.now,
    required this.earliestRetryAt,
    this.maximumBatchSize = 25,
  }) {
    if (pendingOperationCount < 0) {
      throw ArgumentError.value(
        pendingOperationCount,
        'pendingOperationCount',
        'Must not be negative.',
      );
    }
    if (maximumBatchSize < 1 || maximumBatchSize > 100) {
      throw ArgumentError.value(
        maximumBatchSize,
        'maximumBatchSize',
        'Must be between 1 and 100.',
      );
    }
  }

  final SyncExecutionTrigger trigger;
  final bool sessionAuthenticated;
  final bool sessionRevoked;
  final bool workspaceAuthorized;
  final bool coordinatorRunning;
  final LocalStorageHealth storageHealth;
  final bool connectivityAvailable;
  final bool batterySaverEnabled;
  final bool dataSaverEnabled;
  final int pendingOperationCount;
  final bool hasUnknownExternalState;
  final bool projectionRefreshDue;
  final DateTime now;
  final DateTime? earliestRetryAt;
  final int maximumBatchSize;

  bool get isUserInitiated => trigger == SyncExecutionTrigger.userInitiated;

  bool get isBackgroundTrigger => switch (trigger) {
    SyncExecutionTrigger.platformBackground ||
    SyncExecutionTrigger.pushHint => true,
    _ => false,
  };
}

/// Bounded instruction consumed by foreground and native scheduling adapters.
final class BackgroundSyncPlan {
  const BackgroundSyncPlan({
    required this.kind,
    required this.reason,
    required this.requestProjectionPull,
    required this.requestOperationPush,
    required this.operationBatchLimit,
    required this.purgeExpiredProjectionsFirst,
    required this.lockRestrictedCache,
    required this.clearCredentialReferences,
    required this.requiresForegroundReconciliation,
    required this.scheduleAfter,
  });

  final BackgroundSyncPlanKind kind;
  final BackgroundSyncPlanReason reason;
  final bool requestProjectionPull;
  final bool requestOperationPush;
  final int operationBatchLimit;
  final bool purgeExpiredProjectionsFirst;
  final bool lockRestrictedCache;
  final bool clearCredentialReferences;
  final bool requiresForegroundReconciliation;
  final Duration? scheduleAfter;
}

/// Produces a fail-closed, bounded synchronization plan without platform I/O.
abstract final class BackgroundSyncPolicy {
  static BackgroundSyncPlan decide(BackgroundSyncSnapshot snapshot) {
    if (snapshot.sessionRevoked) {
      return _blocked(
        BackgroundSyncPlanReason.sessionRevoked,
        clearCredentialReferences: true,
      );
    }
    if (!snapshot.sessionAuthenticated) {
      return _blocked(BackgroundSyncPlanReason.authenticationRequired);
    }
    if (!snapshot.workspaceAuthorized) {
      return _blocked(
        BackgroundSyncPlanReason.workspaceAuthorizationRequired,
      );
    }
    if (snapshot.storageHealth ==
        LocalStorageHealth.quarantinedCorruption) {
      return _blocked(BackgroundSyncPlanReason.storageRecoveryRequired);
    }
    if (snapshot.storageHealth == LocalStorageHealth.incompatibleSchema) {
      return _blocked(BackgroundSyncPlanReason.supportedUpdateRequired);
    }
    if (snapshot.coordinatorRunning) {
      return _delayed(
        BackgroundSyncPlanReason.coordinatorAlreadyRunning,
        const Duration(minutes: 1),
      );
    }
    if (!snapshot.connectivityAvailable) {
      return _delayed(
        BackgroundSyncPlanReason.connectivityUnavailable,
        const Duration(minutes: 5),
      );
    }

    final backgroundRestricted =
        snapshot.batterySaverEnabled || snapshot.dataSaverEnabled;
    if (backgroundRestricted &&
        snapshot.isBackgroundTrigger &&
        !snapshot.isUserInitiated) {
      return _delayed(
        BackgroundSyncPlanReason.backgroundRestricted,
        const Duration(minutes: 15),
      );
    }

    final purgeExpiredProjectionsFirst =
        snapshot.storageHealth == LocalStorageHealth.lowSpace;

    if (snapshot.hasUnknownExternalState) {
      return BackgroundSyncPlan(
        kind: BackgroundSyncPlanKind.recoveryOnly,
        reason: BackgroundSyncPlanReason.unknownExternalStateRecovery,
        requestProjectionPull: true,
        requestOperationPush: false,
        operationBatchLimit: 0,
        purgeExpiredProjectionsFirst: purgeExpiredProjectionsFirst,
        lockRestrictedCache: false,
        clearCredentialReferences: false,
        requiresForegroundReconciliation: true,
        scheduleAfter: null,
      );
    }

    final retryAt = snapshot.earliestRetryAt;
    final retryIsDue = retryAt == null || !snapshot.now.isBefore(retryAt);
    final hasDuePush = snapshot.pendingOperationCount > 0 && retryIsDue;

    if (!hasDuePush && !snapshot.projectionRefreshDue) {
      if (purgeExpiredProjectionsFirst) {
        return const BackgroundSyncPlan(
          kind: BackgroundSyncPlanKind.localMaintenance,
          reason: BackgroundSyncPlanReason.lowSpaceProjectionEviction,
          requestProjectionPull: false,
          requestOperationPush: false,
          operationBatchLimit: 0,
          purgeExpiredProjectionsFirst: true,
          lockRestrictedCache: false,
          clearCredentialReferences: false,
          requiresForegroundReconciliation: false,
          scheduleAfter: null,
        );
      }
      if (snapshot.pendingOperationCount > 0 && retryAt != null) {
        return _delayed(
          BackgroundSyncPlanReason.retryNotDue,
          retryAt.difference(snapshot.now),
        );
      }
      return const BackgroundSyncPlan(
        kind: BackgroundSyncPlanKind.noWork,
        reason: BackgroundSyncPlanReason.noWork,
        requestProjectionPull: false,
        requestOperationPush: false,
        operationBatchLimit: 0,
        purgeExpiredProjectionsFirst: false,
        lockRestrictedCache: false,
        clearCredentialReferences: false,
        requiresForegroundReconciliation: false,
        scheduleAfter: null,
      );
    }

    final triggerLimit = snapshot.isBackgroundTrigger ? 10 : 25;
    final configuredLimit = snapshot.maximumBatchSize < triggerLimit
        ? snapshot.maximumBatchSize
        : triggerLimit;
    final operationBatchLimit = hasDuePush
        ? (snapshot.pendingOperationCount < configuredLimit
              ? snapshot.pendingOperationCount
              : configuredLimit)
        : 0;

    return BackgroundSyncPlan(
      kind: BackgroundSyncPlanKind.boundedWork,
      reason: BackgroundSyncPlanReason.ready,
      requestProjectionPull: snapshot.projectionRefreshDue,
      requestOperationPush: hasDuePush,
      operationBatchLimit: operationBatchLimit,
      purgeExpiredProjectionsFirst: purgeExpiredProjectionsFirst,
      lockRestrictedCache: false,
      clearCredentialReferences: false,
      requiresForegroundReconciliation: false,
      scheduleAfter: null,
    );
  }

  static BackgroundSyncPlan _blocked(
    BackgroundSyncPlanReason reason, {
    bool clearCredentialReferences = false,
  }) => BackgroundSyncPlan(
    kind: BackgroundSyncPlanKind.blocked,
    reason: reason,
    requestProjectionPull: false,
    requestOperationPush: false,
    operationBatchLimit: 0,
    purgeExpiredProjectionsFirst: false,
    lockRestrictedCache: true,
    clearCredentialReferences: clearCredentialReferences,
    requiresForegroundReconciliation: true,
    scheduleAfter: null,
  );

  static BackgroundSyncPlan _delayed(
    BackgroundSyncPlanReason reason,
    Duration scheduleAfter,
  ) => BackgroundSyncPlan(
    kind: BackgroundSyncPlanKind.delayed,
    reason: reason,
    requestProjectionPull: false,
    requestOperationPush: false,
    operationBatchLimit: 0,
    purgeExpiredProjectionsFirst: false,
    lockRestrictedCache: false,
    clearCredentialReferences: false,
    requiresForegroundReconciliation: false,
    scheduleAfter: scheduleAfter,
  );
}
