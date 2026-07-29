import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_local_data/store_companion_local_data.dart';
import 'package:store_companion_local_data/store_companion_local_database.dart';
import 'package:store_companion_local_data/store_companion_sync_database.dart';
import 'package:store_companion_sync_engine/store_companion_sync_engine.dart';

void main() {
  late Directory directory;
  late String databasePath;
  late LocalEncryptionKey key;

  setUp(() {
    directory = Directory.systemTemp.createTempSync(
      'store-companion-sync-database-test-',
    );
    databasePath = '${directory.path}/store-companion.sqlite3';
    key = LocalEncryptionKey.fromSecureStorage('03' * 32);
  });

  tearDown(() {
    if (directory.existsSync()) {
      directory.deleteSync(recursive: true);
    }
  });

  test('backfills existing operations and preserves monotonic sequence', () {
    final base = _openBase(databasePath, key);
    _commitBase(base, 'operation-001', 'idempotency-001', _time(0));
    _commitBase(base, 'operation-002', 'idempotency-002', _time(1));
    base.close();

    final sync = _openSync(databasePath, key);
    expect(sync.syncSchemaVersion, 1);
    final migrated = sync.readDispatchableOperations(now: _time(10));
    expect(migrated.map((value) => value.localSequence), <int>[1, 2]);
    expect(migrated.map((value) => value.operation.operationId), <String>[
      'operation-001',
      'operation-002',
    ]);
    expect(
      sync.commitPendingOperation(
        operationId: 'operation-003',
        idempotencyKey: 'idempotency-003',
        operationType: 'inventory.count.submit',
        transportSchemaVersion: '1.0',
        payloadJson: '{"count":"3"}',
        committedAt: _time(2),
      ),
      3,
    );
    sync.close();

    final reopened = _openSync(databasePath, key);
    expect(
      reopened.commitPendingOperation(
        operationId: 'operation-004',
        idempotencyKey: 'idempotency-004',
        operationType: 'inventory.count.submit',
        transportSchemaVersion: '1.0',
        payloadJson: '{"count":"4"}',
        committedAt: _time(3),
      ),
      4,
    );
    expect(
      reopened
          .readDispatchableOperations(now: _time(10))
          .map((value) => value.localSequence),
      <int>[1, 2, 3, 4],
    );
    reopened.close();
  });

  test('dispatch selection respects retry time and local sequence', () {
    final sync = _openSync(databasePath, key);
    for (var index = 1; index <= 3; index += 1) {
      sync.commitPendingOperation(
        operationId: 'operation-00$index',
        idempotencyKey: 'idempotency-00$index',
        operationType: 'sales.quote.create',
        transportSchemaVersion: '1.0',
        payloadJson: '{"index":"$index"}',
        committedAt: _time(index),
      );
    }

    sync.transitionPendingOperation(
      operationId: 'operation-002',
      state: LocalOperationState.uploading,
      attemptCount: 1,
      updatedAt: _time(4),
    );
    sync.transitionPendingOperation(
      operationId: 'operation-002',
      state: LocalOperationState.waitingForRetry,
      attemptCount: 1,
      updatedAt: _time(5),
      nextRetryAt: _time(20),
    );
    sync.transitionPendingOperation(
      operationId: 'operation-003',
      state: LocalOperationState.uploading,
      attemptCount: 1,
      updatedAt: _time(6),
    );
    sync.transitionPendingOperation(
      operationId: 'operation-003',
      state: LocalOperationState.waitingForRetry,
      attemptCount: 1,
      updatedAt: _time(7),
      nextRetryAt: _time(8),
    );

    final batch = sync.readDispatchableOperations(now: _time(10));
    expect(batch.map((value) => value.operation.operationId), <String>[
      'operation-001',
      'operation-003',
    ]);
    expect(batch.map((value) => value.localSequence), <int>[1, 3]);
    expect(
      () => sync.readDispatchableOperations(now: _time(10), limit: 0),
      throwsA(isA<LocalSyncDatabaseException>()),
    );
    sync.close();
  });

  test('projection page and cursor commit atomically and replay safely', () {
    final sync = _openSync(databasePath, key);
    final first = sync.applyProjectionPage(
      streamName: 'catalog.changes',
      fromCursor: null,
      nextCursor: 'eyJvZmZzZXQiOjF9+/==',
      observedAt: _time(0),
      mutations: <ProjectionMutation>[
        ProjectionMutation.upsert(
          projectionType: 'catalog.item',
          resourceId: 'item-001',
          serverVersion: 'version-001',
          payloadJson: '{"name":"A"}',
        ),
        ProjectionMutation.upsert(
          projectionType: 'catalog.item',
          resourceId: 'item-002',
          serverVersion: 'version-001',
          payloadJson: '{"name":"B"}',
        ),
      ],
    );
    expect(first.replayed, isFalse);
    expect(first.upserts, 2);
    expect(sync.projectionCount(), 2);
    expect(sync.readCursor('catalog.changes'), 'eyJvZmZzZXQiOjF9+/==');

    final replay = sync.applyProjectionPage(
      streamName: 'catalog.changes',
      fromCursor: null,
      nextCursor: 'eyJvZmZzZXQiOjF9+/==',
      observedAt: _time(1),
      mutations: <ProjectionMutation>[
        ProjectionMutation.delete(
          projectionType: 'catalog.item',
          resourceId: 'item-001',
          serverVersion: 'version-002',
        ),
      ],
    );
    expect(replay.replayed, isTrue);
    expect(sync.projectionCount(), 2);

    expect(
      () => sync.applyProjectionPage(
        streamName: 'catalog.changes',
        fromCursor: 'wrong-cursor',
        nextCursor: 'cursor-002',
        observedAt: _time(2),
        mutations: <ProjectionMutation>[
          ProjectionMutation.delete(
            projectionType: 'catalog.item',
            resourceId: 'item-001',
            serverVersion: 'version-002',
          ),
        ],
      ),
      throwsA(isA<LocalSyncDatabaseException>()),
    );
    expect(sync.projectionCount(), 2);
    expect(sync.readCursor('catalog.changes'), 'eyJvZmZzZXQiOjF9+/==');

    final second = sync.applyProjectionPage(
      streamName: 'catalog.changes',
      fromCursor: 'eyJvZmZzZXQiOjF9+/==',
      nextCursor: 'cursor-002',
      observedAt: _time(3),
      mutations: <ProjectionMutation>[
        ProjectionMutation.delete(
          projectionType: 'catalog.item',
          resourceId: 'item-001',
          serverVersion: 'version-002',
        ),
        ProjectionMutation.upsert(
          projectionType: 'catalog.item',
          resourceId: 'item-002',
          serverVersion: 'version-002',
          payloadJson: '{"name":"B2"}',
        ),
      ],
    );
    expect(second.deletions, 1);
    expect(second.upserts, 1);
    expect(sync.projectionCount(), 1);
    expect(sync.readCursor('catalog.changes'), 'cursor-002');
    sync.close();
  });

  test('expired projection purge does not remove cursor or operations', () {
    final sync = _openSync(databasePath, key);
    sync.commitPendingOperation(
      operationId: 'operation-001',
      idempotencyKey: 'idempotency-001',
      operationType: 'customer.create',
      transportSchemaVersion: '1.0',
      payloadJson: '{"name":"Customer"}',
      committedAt: _time(0),
    );
    sync.applyProjectionPage(
      streamName: 'customer.changes',
      fromCursor: null,
      nextCursor: 'cursor-001',
      observedAt: _time(1),
      mutations: <ProjectionMutation>[
        ProjectionMutation.upsert(
          projectionType: 'customer.summary',
          resourceId: 'customer-001',
          serverVersion: 'version-001',
          payloadJson: '{"name":"Expired"}',
          expiresAt: _time(2),
        ),
        ProjectionMutation.upsert(
          projectionType: 'customer.summary',
          resourceId: 'customer-002',
          serverVersion: 'version-001',
          payloadJson: '{"name":"Current"}',
          expiresAt: _time(20),
        ),
      ],
    );

    expect(sync.purgeExpiredProjections(_time(10)), 1);
    expect(sync.projectionCount(), 1);
    expect(sync.readCursor('customer.changes'), 'cursor-001');
    expect(sync.readPendingOperation('operation-001'), isNotNull);
    sync.close();
  });

  test('page size and cursor controls fail closed', () {
    final sync = _openSync(databasePath, key);
    expect(
      () => sync.applyProjectionPage(
        streamName: 'catalog.changes',
        fromCursor: null,
        nextCursor: 'cursor-001',
        observedAt: _time(0),
        mutations: List<ProjectionMutation>.generate(
          1001,
          (index) => ProjectionMutation.delete(
            projectionType: 'catalog.item',
            resourceId: 'item-$index',
            serverVersion: 'version-001',
          ),
        ),
      ),
      throwsA(isA<LocalSyncDatabaseException>()),
    );
    expect(
      () => sync.applyProjectionPage(
        streamName: 'catalog.changes',
        fromCursor: null,
        nextCursor: 'cursor\nunsafe',
        observedAt: _time(0),
        mutations: const <ProjectionMutation>[],
      ),
      throwsA(isA<LocalSyncDatabaseException>()),
    );
    expect(sync.projectionCount(), 0);
    expect(sync.readCursor('catalog.changes'), isNull);
    sync.close();
  });
}

StoreCompanionLocalDatabase _openBase(
  String databasePath,
  LocalEncryptionKey key,
) => StoreCompanionLocalDatabase.open(
  databasePath: databasePath,
  partitionKey: 'user-001:tenant-001:workspace-001',
  encryptionKey: key,
);

StoreCompanionSyncDatabase _openSync(
  String databasePath,
  LocalEncryptionKey key,
) => StoreCompanionSyncDatabase.open(
  databasePath: databasePath,
  partitionKey: 'user-001:tenant-001:workspace-001',
  encryptionKey: key,
);

void _commitBase(
  StoreCompanionLocalDatabase database,
  String operationId,
  String idempotencyKey,
  DateTime committedAt,
) {
  database.commitPendingOperation(
    operationId: operationId,
    idempotencyKey: idempotencyKey,
    operationType: 'inventory.count.submit',
    transportSchemaVersion: '1.0',
    payloadJson: '{"operation":"$operationId"}',
    committedAt: committedAt,
  );
}

DateTime _time(int seconds) =>
    DateTime.utc(2026, 7, 29, 14).add(Duration(seconds: seconds));
