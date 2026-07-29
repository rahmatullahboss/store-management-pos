import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_local_data/store_companion_local_data.dart';
import 'package:store_companion_local_data/store_companion_local_database.dart';
import 'package:store_companion_local_data/store_companion_sync_database.dart';

void main() {
  test('reopening sync storage backfills operations created after migration', () {
    final directory = Directory.systemTemp.createTempSync(
      'store-companion-late-backfill-test-',
    );
    final databasePath = '${directory.path}/store-companion.sqlite3';
    final key = LocalEncryptionKey.fromSecureStorage('04' * 32);

    try {
      final initialSync = _openSync(databasePath, key);
      expect(initialSync.syncSchemaVersion, 1);
      initialSync.close();

      final firstBase = _openBase(databasePath, key);
      _commitBase(
        firstBase,
        operationId: 'operation-001',
        idempotencyKey: 'idempotency-001',
        committedAt: _time(0),
      );
      firstBase.close();

      final firstReopen = _openSync(databasePath, key);
      final firstBatch = firstReopen.readDispatchableOperations(now: _time(10));
      expect(firstBatch.map((value) => value.localSequence), <int>[1]);
      expect(
        firstBatch.map((value) => value.operation.operationId),
        <String>['operation-001'],
      );
      firstReopen.close();

      final secondBase = _openBase(databasePath, key);
      _commitBase(
        secondBase,
        operationId: 'operation-002',
        idempotencyKey: 'idempotency-002',
        committedAt: _time(1),
      );
      secondBase.close();

      final secondReopen = _openSync(databasePath, key);
      final secondBatch = secondReopen.readDispatchableOperations(
        now: _time(10),
      );
      expect(secondBatch.map((value) => value.localSequence), <int>[1, 2]);
      expect(
        secondBatch.map((value) => value.operation.operationId),
        <String>['operation-001', 'operation-002'],
      );
      secondReopen.close();
    } finally {
      directory.deleteSync(recursive: true);
    }
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
  StoreCompanionLocalDatabase database, {
  required String operationId,
  required String idempotencyKey,
  required DateTime committedAt,
}) {
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
    DateTime.utc(2026, 7, 29, 15).add(Duration(seconds: seconds));
