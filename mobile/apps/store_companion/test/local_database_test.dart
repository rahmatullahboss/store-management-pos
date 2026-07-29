import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_local_data/store_companion_local_data.dart';
import 'package:store_companion_local_data/store_companion_local_database.dart';
import 'package:store_companion_sync_engine/store_companion_sync_engine.dart';

void main() {
  late Directory directory;
  late String databasePath;
  late LocalEncryptionKey key;

  setUp(() {
    directory = Directory.systemTemp.createTempSync(
      'store-companion-local-database-test-',
    );
    databasePath = '${directory.path}/store-companion.sqlite3';
    key = LocalEncryptionKey.fromSecureStorage('01' * 32);
  });

  tearDown(() {
    if (directory.existsSync()) {
      directory.deleteSync(recursive: true);
    }
  });

  test('creates schema and preserves durable state across restart', () {
    final database = _open(databasePath, key);
    expect(database.schemaVersion, 1);

    database.saveDraft(
      draftId: 'draft-001',
      operationType: 'inventory.count.submit',
      payloadJson: '{"count":"42"}',
      updatedAt: _time(0),
    );
    database.commitPendingOperation(
      operationId: 'operation-001',
      idempotencyKey: 'idempotency-001',
      operationType: 'inventory.count.submit',
      transportSchemaVersion: '1.0',
      payloadJson: '{"count":"42"}',
      committedAt: _time(1),
    );
    database.writeCursor(
      streamName: 'inventory.counts',
      cursor: 'cursor-001',
      observedAt: _time(2),
    );
    database.close();

    final reopened = _open(databasePath, key);
    expect(reopened.schemaVersion, 1);
    expect(reopened.readDraft('draft-001'), '{"count":"42"}');
    expect(reopened.readCursor('inventory.counts'), 'cursor-001');
    expect(
      reopened.readPendingOperation('operation-001')?.state,
      LocalOperationState.locallyCommitted,
    );
    expect(reopened.activePendingOperationCount(), 1);
    reopened.close();
  });

  test('wrong key cannot reopen an encrypted database', () {
    final database = _open(databasePath, key);
    database.saveDraft(
      draftId: 'draft-001',
      operationType: 'sales.return.create',
      payloadJson: '{"reason":"damaged"}',
      updatedAt: _time(0),
    );
    database.close();

    final wrongKey = LocalEncryptionKey.fromSecureStorage('02' * 32);
    expect(
      () => _open(databasePath, wrongKey),
      throwsA(
        predicate<Object>(
          (error) =>
              !error.toString().contains('0101010101') &&
              !error.toString().contains('0202020202'),
          'fails without disclosing either database key',
        ),
      ),
    );
  });

  test(
    'projection purge never removes drafts operations results or cursors',
    () {
      final database = _open(databasePath, key);
      database.upsertProjection(
        projectionType: 'inventory.summary',
        resourceId: 'warehouse-001',
        serverVersion: 'version-001',
        payloadJson: '{"available":"10"}',
        observedAt: _time(0),
      );
      database.saveDraft(
        draftId: 'draft-001',
        operationType: 'inventory.adjustment.create',
        payloadJson: '{"quantity":"1"}',
        updatedAt: _time(1),
      );
      database.commitPendingOperation(
        operationId: 'operation-001',
        idempotencyKey: 'idempotency-001',
        operationType: 'inventory.adjustment.create',
        transportSchemaVersion: '1.0',
        payloadJson: '{"quantity":"1"}',
        committedAt: _time(2),
      );
      database.transitionPendingOperation(
        operationId: 'operation-001',
        state: LocalOperationState.uploading,
        attemptCount: 1,
        updatedAt: _time(3),
        traceId: 'trace-upload-001',
      );
      database.recordAuthoritativeResult(
        operationId: 'operation-001',
        state: LocalOperationState.accepted,
        status: 'accepted',
        resultJson: '{"serverVersion":"version-002"}',
        receivedAt: _time(4),
        traceId: 'trace-result-001',
      );
      database.writeCursor(
        streamName: 'inventory.summary',
        cursor: 'cursor-002',
        observedAt: _time(5),
      );

      expect(database.projectionCount(), 1);
      expect(database.purgeRebuildableProjections(), 1);
      expect(database.projectionCount(), 0);
      expect(database.readDraft('draft-001'), '{"quantity":"1"}');
      expect(database.readCursor('inventory.summary'), 'cursor-002');
      expect(
        database.readPendingOperation('operation-001')?.state,
        LocalOperationState.accepted,
      );
      expect(
        database.readAuthoritativeResult('operation-001')?.status,
        'accepted',
      );
      expect(database.activePendingOperationCount(), 0);
      database.close();
    },
  );

  test('duplicate operation and idempotency keys are rejected', () {
    final database = _open(databasePath, key);
    database.commitPendingOperation(
      operationId: 'operation-001',
      idempotencyKey: 'idempotency-001',
      operationType: 'sales.order.create',
      transportSchemaVersion: '1.0',
      payloadJson: '{"totalMinor":"1000"}',
      committedAt: _time(0),
    );

    expect(
      () => database.commitPendingOperation(
        operationId: 'operation-002',
        idempotencyKey: 'idempotency-001',
        operationType: 'sales.order.create',
        transportSchemaVersion: '1.0',
        payloadJson: '{"totalMinor":"1000"}',
        committedAt: _time(1),
      ),
      throwsA(isA<LocalDatabaseException>()),
    );
    expect(
      () => database.commitPendingOperation(
        operationId: 'operation-001',
        idempotencyKey: 'idempotency-002',
        operationType: 'sales.order.create',
        transportSchemaVersion: '1.0',
        payloadJson: '{"totalMinor":"1000"}',
        committedAt: _time(2),
      ),
      throwsA(isA<LocalDatabaseException>()),
    );
    database.close();
  });

  test('invalid state transitions and decreasing attempts are rejected', () {
    final database = _open(databasePath, key);
    database.commitPendingOperation(
      operationId: 'operation-001',
      idempotencyKey: 'idempotency-001',
      operationType: 'procurement.receipt.create',
      transportSchemaVersion: '1.0',
      payloadJson: '{"lines":[]}',
      committedAt: _time(0),
    );

    expect(
      () => database.transitionPendingOperation(
        operationId: 'operation-001',
        state: LocalOperationState.accepted,
        attemptCount: 1,
        updatedAt: _time(1),
      ),
      throwsA(isA<LocalDatabaseException>()),
    );

    database.transitionPendingOperation(
      operationId: 'operation-001',
      state: LocalOperationState.uploading,
      attemptCount: 1,
      updatedAt: _time(2),
    );
    expect(
      () => database.transitionPendingOperation(
        operationId: 'operation-001',
        state: LocalOperationState.waitingForRetry,
        attemptCount: 0,
        updatedAt: _time(3),
      ),
      throwsA(isA<LocalDatabaseException>()),
    );
    database.close();
  });

  test('authoritative result replay is exact and mismatch fails closed', () {
    final database = _open(databasePath, key);
    database.commitPendingOperation(
      operationId: 'operation-001',
      idempotencyKey: 'idempotency-001',
      operationType: 'customer.address.update',
      transportSchemaVersion: '1.0',
      payloadJson: '{"city":"Dhaka"}',
      committedAt: _time(0),
    );
    database.transitionPendingOperation(
      operationId: 'operation-001',
      state: LocalOperationState.uploading,
      attemptCount: 1,
      updatedAt: _time(1),
    );

    void record(String resultJson) => database.recordAuthoritativeResult(
      operationId: 'operation-001',
      state: LocalOperationState.acceptedWithAdjustment,
      status: 'accepted_with_adjustment',
      resultJson: resultJson,
      receivedAt: _time(2),
      traceId: 'trace-result-001',
    );

    record('{"city":"DHAKA"}');
    expect(() => record('{"city":"DHAKA"}'), returnsNormally);
    expect(
      () => record('{"city":"Dhaka"}'),
      throwsA(isA<LocalDatabaseException>()),
    );
    database.close();
  });

  test('destructive migration guard blocks unresolved pending work', () {
    final database = _open(databasePath, key);
    database.commitPendingOperation(
      operationId: 'operation-001',
      idempotencyKey: 'idempotency-001',
      operationType: 'inventory.transfer.create',
      transportSchemaVersion: '1.0',
      payloadJson: '{"quantity":"5"}',
      committedAt: _time(0),
    );

    expect(
      database.requireDestructiveMigrationSafety,
      throwsA(isA<LocalDatabaseException>()),
    );

    database.transitionPendingOperation(
      operationId: 'operation-001',
      state: LocalOperationState.uploading,
      attemptCount: 1,
      updatedAt: _time(1),
    );
    database.recordAuthoritativeResult(
      operationId: 'operation-001',
      state: LocalOperationState.accepted,
      status: 'accepted',
      resultJson: '{"accepted":true}',
      receivedAt: _time(2),
    );
    expect(database.requireDestructiveMigrationSafety, returnsNormally);
    database.close();
  });

  test('partitions remain isolated inside the same encrypted file', () {
    final first = _open(
      databasePath,
      key,
      partitionKey: 'user-a:tenant-a:workspace-a',
    );
    first.saveDraft(
      draftId: 'draft-001',
      operationType: 'catalog.product.update',
      payloadJson: '{"name":"A"}',
      updatedAt: _time(0),
    );
    first.close();

    final second = _open(
      databasePath,
      key,
      partitionKey: 'user-b:tenant-b:workspace-b',
    );
    expect(second.readDraft('draft-001'), isNull);
    second.saveDraft(
      draftId: 'draft-001',
      operationType: 'catalog.product.update',
      payloadJson: '{"name":"B"}',
      updatedAt: _time(1),
    );
    second.close();

    final reopenedFirst = _open(
      databasePath,
      key,
      partitionKey: 'user-a:tenant-a:workspace-a',
    );
    expect(reopenedFirst.readDraft('draft-001'), '{"name":"A"}');
    reopenedFirst.close();
  });

  test('malformed and non-object JSON are rejected before storage', () {
    final database = _open(databasePath, key);
    expect(
      () => database.saveDraft(
        draftId: 'draft-001',
        operationType: 'sales.quote.create',
        payloadJson: 'not-json',
        updatedAt: _time(0),
      ),
      throwsA(isA<LocalDatabaseException>()),
    );
    expect(
      () => database.saveDraft(
        draftId: 'draft-002',
        operationType: 'sales.quote.create',
        payloadJson: '[1,2,3]',
        updatedAt: _time(1),
      ),
      throwsA(isA<LocalDatabaseException>()),
    );
    database.close();
  });
}

StoreCompanionLocalDatabase _open(
  String databasePath,
  LocalEncryptionKey key, {
  String partitionKey = 'user-001:tenant-001:workspace-001',
}) => StoreCompanionLocalDatabase.open(
  databasePath: databasePath,
  partitionKey: partitionKey,
  encryptionKey: key,
);

DateTime _time(int seconds) =>
    DateTime.utc(2026, 7, 29, 12).add(Duration(seconds: seconds));
