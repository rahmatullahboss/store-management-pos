import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_sync_engine/store_companion_background_sync.dart';

void main() {
  final now = DateTime.utc(2026, 7, 29, 18);

  BackgroundSyncSnapshot snapshot({
    SyncExecutionTrigger trigger = SyncExecutionTrigger.platformBackground,
    bool sessionAuthenticated = true,
    bool sessionRevoked = false,
    bool workspaceAuthorized = true,
    bool coordinatorRunning = false,
    LocalStorageHealth storageHealth = LocalStorageHealth.healthy,
    bool connectivityAvailable = true,
    bool batterySaverEnabled = false,
    bool dataSaverEnabled = false,
    int pendingOperationCount = 0,
    bool hasUnknownExternalState = false,
    bool projectionRefreshDue = false,
    DateTime? earliestRetryAt,
    int maximumBatchSize = 25,
  }) => BackgroundSyncSnapshot(
    trigger: trigger,
    sessionAuthenticated: sessionAuthenticated,
    sessionRevoked: sessionRevoked,
    workspaceAuthorized: workspaceAuthorized,
    coordinatorRunning: coordinatorRunning,
    storageHealth: storageHealth,
    connectivityAvailable: connectivityAvailable,
    batterySaverEnabled: batterySaverEnabled,
    dataSaverEnabled: dataSaverEnabled,
    pendingOperationCount: pendingOperationCount,
    hasUnknownExternalState: hasUnknownExternalState,
    projectionRefreshDue: projectionRefreshDue,
    now: now,
    earliestRetryAt: earliestRetryAt,
    maximumBatchSize: maximumBatchSize,
  );

  test('revocation blocks sync, locks cache and clears credential references', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(
        sessionRevoked: true,
        pendingOperationCount: 4,
        projectionRefreshDue: true,
      ),
    );

    expect(plan.kind, BackgroundSyncPlanKind.blocked);
    expect(plan.reason, BackgroundSyncPlanReason.sessionRevoked);
    expect(plan.requestProjectionPull, isFalse);
    expect(plan.requestOperationPush, isFalse);
    expect(plan.lockRestrictedCache, isTrue);
    expect(plan.clearCredentialReferences, isTrue);
    expect(plan.requiresForegroundReconciliation, isTrue);
  });

  test('unknown external state permits recovery pull but prohibits blind push', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(
        pendingOperationCount: 8,
        hasUnknownExternalState: true,
      ),
    );

    expect(plan.kind, BackgroundSyncPlanKind.recoveryOnly);
    expect(
      plan.reason,
      BackgroundSyncPlanReason.unknownExternalStateRecovery,
    );
    expect(plan.requestProjectionPull, isTrue);
    expect(plan.requestOperationPush, isFalse);
    expect(plan.operationBatchLimit, 0);
    expect(plan.requiresForegroundReconciliation, isTrue);
  });

  test('platform background work is capped at ten operations', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(pendingOperationCount: 42),
    );

    expect(plan.kind, BackgroundSyncPlanKind.boundedWork);
    expect(plan.requestOperationPush, isTrue);
    expect(plan.operationBatchLimit, 10);
  });

  test('foreground and user work remains bounded at twenty-five operations', () {
    final foreground = BackgroundSyncPolicy.decide(
      snapshot(
        trigger: SyncExecutionTrigger.appResume,
        pendingOperationCount: 42,
      ),
    );
    final user = BackgroundSyncPolicy.decide(
      snapshot(
        trigger: SyncExecutionTrigger.userInitiated,
        pendingOperationCount: 42,
      ),
    );

    expect(foreground.operationBatchLimit, 25);
    expect(user.operationBatchLimit, 25);
  });

  test('configured batch size can make the platform cap stricter', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(
        pendingOperationCount: 42,
        maximumBatchSize: 6,
      ),
    );

    expect(plan.operationBatchLimit, 6);
  });

  test('battery or data saver delays opportunistic background work', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(
        batterySaverEnabled: true,
        pendingOperationCount: 1,
      ),
    );

    expect(plan.kind, BackgroundSyncPlanKind.delayed);
    expect(plan.reason, BackgroundSyncPlanReason.backgroundRestricted);
    expect(plan.scheduleAfter, const Duration(minutes: 15));
  });

  test('user-requested sync is not blocked by background scheduling hints', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(
        trigger: SyncExecutionTrigger.userInitiated,
        batterySaverEnabled: true,
        dataSaverEnabled: true,
        pendingOperationCount: 1,
      ),
    );

    expect(plan.kind, BackgroundSyncPlanKind.boundedWork);
    expect(plan.requestOperationPush, isTrue);
  });

  test('future retry time delays push without advancing local state', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(
        pendingOperationCount: 2,
        earliestRetryAt: now.add(const Duration(minutes: 7)),
      ),
    );

    expect(plan.kind, BackgroundSyncPlanKind.delayed);
    expect(plan.reason, BackgroundSyncPlanReason.retryNotDue);
    expect(plan.scheduleAfter, const Duration(minutes: 7));
    expect(plan.requestOperationPush, isFalse);
  });

  test('projection refresh may run while operation retry is not due', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(
        pendingOperationCount: 2,
        earliestRetryAt: now.add(const Duration(minutes: 7)),
        projectionRefreshDue: true,
      ),
    );

    expect(plan.kind, BackgroundSyncPlanKind.boundedWork);
    expect(plan.requestProjectionPull, isTrue);
    expect(plan.requestOperationPush, isFalse);
    expect(plan.operationBatchLimit, 0);
  });

  test('low storage only requests rebuildable projection eviction', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(storageHealth: LocalStorageHealth.lowSpace),
    );

    expect(plan.kind, BackgroundSyncPlanKind.localMaintenance);
    expect(plan.reason, BackgroundSyncPlanReason.lowSpaceProjectionEviction);
    expect(plan.purgeExpiredProjectionsFirst, isTrue);
    expect(plan.requestOperationPush, isFalse);
    expect(plan.lockRestrictedCache, isFalse);
  });

  test('low storage preserves sync work and evicts projections first', () {
    final plan = BackgroundSyncPolicy.decide(
      snapshot(
        storageHealth: LocalStorageHealth.lowSpace,
        pendingOperationCount: 3,
      ),
    );

    expect(plan.kind, BackgroundSyncPlanKind.boundedWork);
    expect(plan.purgeExpiredProjectionsFirst, isTrue);
    expect(plan.operationBatchLimit, 3);
  });

  test('corrupt or incompatible storage requires foreground recovery', () {
    final corrupt = BackgroundSyncPolicy.decide(
      snapshot(storageHealth: LocalStorageHealth.quarantinedCorruption),
    );
    final incompatible = BackgroundSyncPolicy.decide(
      snapshot(storageHealth: LocalStorageHealth.incompatibleSchema),
    );

    expect(corrupt.kind, BackgroundSyncPlanKind.blocked);
    expect(corrupt.reason, BackgroundSyncPlanReason.storageRecoveryRequired);
    expect(corrupt.lockRestrictedCache, isTrue);
    expect(corrupt.requiresForegroundReconciliation, isTrue);

    expect(incompatible.kind, BackgroundSyncPlanKind.blocked);
    expect(incompatible.reason, BackgroundSyncPlanReason.supportedUpdateRequired);
    expect(incompatible.lockRestrictedCache, isTrue);
  });

  test('concurrent coordinator and missing connectivity delay work', () {
    final concurrent = BackgroundSyncPolicy.decide(
      snapshot(coordinatorRunning: true, pendingOperationCount: 1),
    );
    final offline = BackgroundSyncPolicy.decide(
      snapshot(connectivityAvailable: false, pendingOperationCount: 1),
    );

    expect(
      concurrent.reason,
      BackgroundSyncPlanReason.coordinatorAlreadyRunning,
    );
    expect(concurrent.scheduleAfter, const Duration(minutes: 1));
    expect(offline.reason, BackgroundSyncPlanReason.connectivityUnavailable);
    expect(offline.scheduleAfter, const Duration(minutes: 5));
  });

  test('empty healthy snapshot produces no work', () {
    final plan = BackgroundSyncPolicy.decide(snapshot());

    expect(plan.kind, BackgroundSyncPlanKind.noWork);
    expect(plan.reason, BackgroundSyncPlanReason.noWork);
  });

  test('invalid counts and limits fail before scheduling', () {
    expect(
      () => snapshot(pendingOperationCount: -1),
      throwsArgumentError,
    );
    expect(
      () => snapshot(maximumBatchSize: 0),
      throwsArgumentError,
    );
    expect(
      () => snapshot(maximumBatchSize: 101),
      throwsArgumentError,
    );
  });
}
