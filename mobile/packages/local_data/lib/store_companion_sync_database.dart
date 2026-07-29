/// Sequenced and cursor-safe synchronization persistence for Store Companion.
library;

import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';
import 'package:store_companion_sync_engine/store_companion_sync_engine.dart';

import 'store_companion_local_data.dart';
import 'store_companion_local_database.dart';

/// A safe synchronization-persistence failure.
class LocalSyncDatabaseException implements Exception {
  /// Creates a synchronization persistence exception.
  const LocalSyncDatabaseException(this.message);

  /// Safe failure description without payload or key material.
  final String message;

  @override
  String toString() => 'LocalSyncDatabaseException: $message';
}

/// One upsert or deletion in a bounded projection page.
final class ProjectionMutation {
  const ProjectionMutation._({
    required this.projectionType,
    required this.resourceId,
    required this.serverVersion,
    required this.payloadJson,
    required this.expiresAt,
    required this.deleted,
  });

  /// Creates a validated projection upsert request.
  factory ProjectionMutation.upsert({
    required String projectionType,
    required String resourceId,
    required String serverVersion,
    required String payloadJson,
    DateTime? expiresAt,
  }) => ProjectionMutation._(
    projectionType: projectionType,
    resourceId: resourceId,
    serverVersion: serverVersion,
    payloadJson: payloadJson,
    expiresAt: expiresAt,
    deleted: false,
  );

  /// Creates a projection deletion request.
  factory ProjectionMutation.delete({
    required String projectionType,
    required String resourceId,
    required String serverVersion,
  }) => ProjectionMutation._(
    projectionType: projectionType,
    resourceId: resourceId,
    serverVersion: serverVersion,
    payloadJson: null,
    expiresAt: null,
    deleted: true,
  );

  /// Versioned projection collection name.
  final String projectionType;

  /// Opaque server resource reference.
  final String resourceId;

  /// Opaque authoritative source version.
  final String serverVersion;

  /// JSON object payload for an upsert.
  final String? payloadJson;

  /// Optional projection expiry time.
  final DateTime? expiresAt;

  /// Whether this mutation removes a cached projection.
  final bool deleted;
}

/// Result of applying one bounded projection page.
final class ProjectionPageApplyResult {
  /// Creates immutable apply evidence.
  const ProjectionPageApplyResult({
    required this.replayed,
    required this.upserts,
    required this.deletions,
    required this.nextCursor,
  });

  /// Whether the page cursor had already been committed.
  final bool replayed;

  /// Number of upserts applied.
  final int upserts;

  /// Number of deletions applied.
  final int deletions;

  /// Opaque committed high-water cursor.
  final String nextCursor;
}

/// Pending operation paired with its monotonic local sequence.
final class SequencedPendingOperationSnapshot {
  /// Creates a sequenced operation snapshot.
  const SequencedPendingOperationSnapshot({
    required this.localSequence,
    required this.operation,
  });

  /// Monotonic sequence scoped to the current partition.
  final int localSequence;

  /// Durable operation state and payload.
  final PendingOperationSnapshot operation;
}

/// Additive synchronization layer over the encrypted local database.
///
/// The base database owns drafts, pending operations, results, projections and
/// cursors. This layer adds deterministic per-partition sequencing and atomic
/// change-page application without changing the base schema version.
final class StoreCompanionSyncDatabase {
  StoreCompanionSyncDatabase._({
    required StoreCompanionLocalDatabase base,
    required Database database,
  }) : _base = base,
       _database = database;

  /// Opens the encrypted base schema and applies additive sync migrations.
  factory StoreCompanionSyncDatabase.open({
    required String databasePath,
    required String partitionKey,
    required LocalEncryptionKey encryptionKey,
  }) {
    final base = StoreCompanionLocalDatabase.open(
      databasePath: databasePath,
      partitionKey: partitionKey,
      encryptionKey: encryptionKey,
    );
    final database = sqlite3.open(base.databasePath);
    try {
      encryptionKey.configure(database);
      final result = StoreCompanionSyncDatabase._(
        base: base,
        database: database,
      );
      result._migrate();
      return result;
    } catch (_) {
      database.close();
      base.close();
      rethrow;
    }
  }

  final StoreCompanionLocalDatabase _base;
  final Database _database;
  bool _closed = false;

  /// Active opaque user/tenant/workspace partition.
  String get partitionKey => _base.partitionKey;

  /// Absolute encrypted database path.
  String get databasePath => _base.databasePath;

  /// Current additive sync schema version.
  int get syncSchemaVersion {
    _ensureOpen();
    final rows = _database.select(
      'SELECT coalesce(max(version), 0) AS value FROM local_sync_schema_migrations;',
    );
    return rows.single['value']! as int;
  }

  /// Closes both encrypted SQLite connections.
  void close() {
    if (_closed) {
      return;
    }
    _closed = true;
    _database.close();
    _base.close();
  }

  /// Commits an immutable operation and sequence mapping in one transaction.
  int commitPendingOperation({
    required String operationId,
    required String idempotencyKey,
    required String operationType,
    required String transportSchemaVersion,
    required String payloadJson,
    required DateTime committedAt,
  }) {
    _ensureOpen();
    return _transaction(() {
      final sequence = _allocateSequence();
      final timestamp = _timestamp(committedAt);
      try {
        _database.execute(
          '''
          INSERT INTO pending_operations (
            partition_key,
            operation_id,
            idempotency_key,
            operation_type,
            transport_schema_version,
            payload_json,
            state,
            attempt_count,
            next_retry_at,
            trace_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
          ''',
          <Object?>[
            partitionKey,
            _validateOpaque(operationId, 'operationId'),
            _validateOpaque(idempotencyKey, 'idempotencyKey'),
            _validateName(operationType, 'operationType'),
            _validateVersion(transportSchemaVersion),
            _validateJsonObject(payloadJson, 'payloadJson'),
            LocalOperationState.locallyCommitted.name,
            timestamp,
            timestamp,
          ],
        );
        _database.execute(
          '''
          INSERT INTO pending_operation_sequences (
            partition_key,
            operation_id,
            local_sequence
          ) VALUES (?, ?, ?)
          ''',
          <Object?>[
            partitionKey,
            _validateOpaque(operationId, 'operationId'),
            sequence,
          ],
        );
      } on SqliteException catch (error) {
        if (error.extendedResultCode == 1555 ||
            error.extendedResultCode == 2067) {
          throw const LocalSyncDatabaseException(
            'Operation, idempotency key or local sequence already exists.',
          );
        }
        rethrow;
      }
      return sequence;
    });
  }

  /// Reads one pending operation through the base persistence boundary.
  PendingOperationSnapshot? readPendingOperation(String operationId) {
    _ensureOpen();
    return _base.readPendingOperation(operationId);
  }

  /// Applies one validated local operation transition.
  void transitionPendingOperation({
    required String operationId,
    required LocalOperationState state,
    required int attemptCount,
    required DateTime updatedAt,
    DateTime? nextRetryAt,
    String? traceId,
  }) {
    _ensureOpen();
    _base.transitionPendingOperation(
      operationId: operationId,
      state: state,
      attemptCount: attemptCount,
      updatedAt: updatedAt,
      nextRetryAt: nextRetryAt,
      traceId: traceId,
    );
  }

  /// Persists an authoritative result through the base transaction boundary.
  void recordAuthoritativeResult({
    required String operationId,
    required LocalOperationState state,
    required String status,
    required String resultJson,
    required DateTime receivedAt,
    String? traceId,
  }) {
    _ensureOpen();
    _base.recordAuthoritativeResult(
      operationId: operationId,
      state: state,
      status: status,
      resultJson: resultJson,
      receivedAt: receivedAt,
      traceId: traceId,
    );
  }

  /// Reads a stored authoritative result.
  AuthoritativeResultSnapshot? readAuthoritativeResult(String operationId) {
    _ensureOpen();
    return _base.readAuthoritativeResult(operationId);
  }

  /// Selects a bounded upload batch in monotonic local sequence order.
  List<SequencedPendingOperationSnapshot> readDispatchableOperations({
    required DateTime now,
    int limit = 25,
  }) {
    _ensureOpen();
    if (limit < 1 || limit > 100) {
      throw const LocalSyncDatabaseException(
        'Dispatch batch limit must be between 1 and 100.',
      );
    }
    final rows = _database.select(
      '''
      SELECT sequence.operation_id, sequence.local_sequence
      FROM pending_operation_sequences AS sequence
      JOIN pending_operations AS operation
        ON operation.partition_key = sequence.partition_key
       AND operation.operation_id = sequence.operation_id
      WHERE sequence.partition_key = ?
        AND (
          operation.state IN (?, ?)
          OR (
            operation.state = ?
            AND (
              operation.next_retry_at IS NULL
              OR operation.next_retry_at <= ?
            )
          )
        )
      ORDER BY sequence.local_sequence ASC
      LIMIT ?
      ''',
      <Object?>[
        partitionKey,
        LocalOperationState.locallyCommitted.name,
        LocalOperationState.waitingForConnectivity.name,
        LocalOperationState.waitingForRetry.name,
        _timestamp(now),
        limit,
      ],
    );

    return rows.map((Row row) {
      final operationId = row['operation_id']! as String;
      final operation = _base.readPendingOperation(operationId);
      if (operation == null) {
        throw const LocalDataSecurityException(
          'A sequenced operation is missing its durable operation row.',
        );
      }
      return SequencedPendingOperationSnapshot(
        localSequence: row['local_sequence']! as int,
        operation: operation,
      );
    }).toList(growable: false);
  }

  /// Atomically applies one bounded change page and advances its cursor.
  ProjectionPageApplyResult applyProjectionPage({
    required String streamName,
    required String? fromCursor,
    required String nextCursor,
    required List<ProjectionMutation> mutations,
    required DateTime observedAt,
  }) {
    _ensureOpen();
    if (mutations.length > 1000) {
      throw const LocalSyncDatabaseException(
        'Projection pages cannot contain more than 1000 mutations.',
      );
    }
    final normalizedStream = _validateName(streamName, 'streamName');
    final normalizedNextCursor = _validateCursor(nextCursor, 'nextCursor');
    final normalizedFromCursor = fromCursor == null
        ? null
        : _validateCursor(fromCursor, 'fromCursor');

    return _transaction(() {
      final currentCursor = _readCursor(normalizedStream);
      if (currentCursor == normalizedNextCursor) {
        return ProjectionPageApplyResult(
          replayed: true,
          upserts: 0,
          deletions: 0,
          nextCursor: normalizedNextCursor,
        );
      }
      if (currentCursor != normalizedFromCursor) {
        throw const LocalSyncDatabaseException(
          'Projection cursor gap or cross-scope replay was detected.',
        );
      }

      var upserts = 0;
      var deletions = 0;
      for (final mutation in mutations) {
        final projectionType = _validateName(
          mutation.projectionType,
          'projectionType',
        );
        final resourceId = _validateOpaque(
          mutation.resourceId,
          'resourceId',
        );
        final serverVersion = _validateOpaque(
          mutation.serverVersion,
          'serverVersion',
        );
        if (mutation.deleted) {
          _database.execute(
            '''
            DELETE FROM local_projections
            WHERE partition_key = ?
              AND projection_type = ?
              AND resource_id = ?
            ''',
            <Object?>[partitionKey, projectionType, resourceId],
          );
          deletions += _database.updatedRows;
          continue;
        }

        final payloadJson = mutation.payloadJson;
        if (payloadJson == null) {
          throw const LocalSyncDatabaseException(
            'Projection upserts require a JSON object payload.',
          );
        }
        _database.execute(
          '''
          INSERT INTO local_projections (
            partition_key,
            projection_type,
            resource_id,
            server_version,
            payload_json,
            observed_at,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (partition_key, projection_type, resource_id) DO UPDATE SET
            server_version = excluded.server_version,
            payload_json = excluded.payload_json,
            observed_at = excluded.observed_at,
            expires_at = excluded.expires_at
          ''',
          <Object?>[
            partitionKey,
            projectionType,
            resourceId,
            serverVersion,
            _validateJsonObject(payloadJson, 'payloadJson'),
            _timestamp(observedAt),
            mutation.expiresAt == null
                ? null
                : _timestamp(mutation.expiresAt!),
          ],
        );
        upserts += 1;
      }

      _database.execute(
        '''
        INSERT INTO sync_cursors (
          partition_key,
          stream_name,
          cursor_value,
          observed_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT (partition_key, stream_name) DO UPDATE SET
          cursor_value = excluded.cursor_value,
          observed_at = excluded.observed_at
        ''',
        <Object?>[
          partitionKey,
          normalizedStream,
          normalizedNextCursor,
          _timestamp(observedAt),
        ],
      );
      return ProjectionPageApplyResult(
        replayed: false,
        upserts: upserts,
        deletions: deletions,
        nextCursor: normalizedNextCursor,
      );
    });
  }

  /// Reads one committed opaque stream cursor.
  String? readCursor(String streamName) {
    _ensureOpen();
    return _readCursor(_validateName(streamName, 'streamName'));
  }

  /// Counts projections in the active partition.
  int projectionCount() {
    _ensureOpen();
    final rows = _database.select(
      'SELECT count(*) AS value FROM local_projections WHERE partition_key = ?',
      <Object?>[partitionKey],
    );
    return rows.single['value']! as int;
  }

  /// Removes only expired rebuildable projections.
  int purgeExpiredProjections(DateTime now) {
    _ensureOpen();
    _database.execute(
      '''
      DELETE FROM local_projections
      WHERE partition_key = ?
        AND expires_at IS NOT NULL
        AND expires_at <= ?
      ''',
      <Object?>[partitionKey, _timestamp(now)],
    );
    return _database.updatedRows;
  }

  void _migrate() {
    _transaction(() {
      _database.execute(_syncSchemaVersionOne);
      final currentRows = _database.select(
        'SELECT coalesce(max(version), 0) AS value FROM local_sync_schema_migrations;',
      );
      final current = currentRows.single['value']! as int;
      if (current > _currentSyncSchemaVersion) {
        throw LocalSyncDatabaseException(
          'Sync schema $current is newer than supported '
          'schema $_currentSyncSchemaVersion.',
        );
      }
      if (current < 1) {
        _backfillSequences();
        _database.execute(
          '''
          INSERT INTO local_sync_schema_migrations (version, applied_at)
          VALUES (?, ?)
          ''',
          <Object?>[1, _timestamp(DateTime.now().toUtc())],
        );
      }
    });
  }

  void _backfillSequences() {
    final rows = _database.select(
      '''
      SELECT operation.partition_key, operation.operation_id
      FROM pending_operations AS operation
      LEFT JOIN pending_operation_sequences AS sequence
        ON sequence.partition_key = operation.partition_key
       AND sequence.operation_id = operation.operation_id
      WHERE sequence.operation_id IS NULL
      ORDER BY operation.partition_key, operation.created_at, operation.operation_id
      ''',
    );
    String? activePartition;
    var nextSequence = 1;
    for (final row in rows) {
      final rowPartition = row['partition_key']! as String;
      if (activePartition != rowPartition) {
        activePartition = rowPartition;
        nextSequence = _nextSequenceForBackfill(rowPartition);
      }
      _database.execute(
        '''
        INSERT INTO pending_operation_sequences (
          partition_key,
          operation_id,
          local_sequence
        ) VALUES (?, ?, ?)
        ''',
        <Object?>[
          rowPartition,
          row['operation_id']! as String,
          nextSequence,
        ],
      );
      nextSequence += 1;
      _database.execute(
        '''
        INSERT INTO local_partition_sequences (partition_key, next_sequence)
        VALUES (?, ?)
        ON CONFLICT (partition_key) DO UPDATE SET
          next_sequence = excluded.next_sequence
        ''',
        <Object?>[rowPartition, nextSequence],
      );
    }
  }

  int _nextSequenceForBackfill(String rowPartition) {
    final rows = _database.select(
      '''
      SELECT coalesce(max(local_sequence), 0) + 1 AS value
      FROM pending_operation_sequences
      WHERE partition_key = ?
      ''',
      <Object?>[rowPartition],
    );
    return rows.single['value']! as int;
  }

  int _allocateSequence() {
    final rows = _database.select(
      '''
      SELECT next_sequence
      FROM local_partition_sequences
      WHERE partition_key = ?
      ''',
      <Object?>[partitionKey],
    );
    if (rows.isEmpty) {
      _database.execute(
        '''
        INSERT INTO local_partition_sequences (partition_key, next_sequence)
        VALUES (?, 2)
        ''',
        <Object?>[partitionKey],
      );
      return 1;
    }
    final sequence = rows.single['next_sequence']! as int;
    _database.execute(
      '''
      UPDATE local_partition_sequences
      SET next_sequence = ?
      WHERE partition_key = ?
      ''',
      <Object?>[sequence + 1, partitionKey],
    );
    return sequence;
  }

  String? _readCursor(String streamName) {
    final rows = _database.select(
      '''
      SELECT cursor_value
      FROM sync_cursors
      WHERE partition_key = ? AND stream_name = ?
      ''',
      <Object?>[partitionKey, streamName],
    );
    return rows.isEmpty ? null : rows.single['cursor_value']! as String;
  }

  T _transaction<T>(T Function() body) {
    _database.execute('BEGIN IMMEDIATE;');
    try {
      final result = body();
      _database.execute('COMMIT;');
      return result;
    } catch (_) {
      _database.execute('ROLLBACK;');
      rethrow;
    }
  }

  void _ensureOpen() {
    if (_closed) {
      throw const LocalSyncDatabaseException('Sync database is closed.');
    }
  }
}

const int _currentSyncSchemaVersion = 1;

const String _syncSchemaVersionOne = '''
CREATE TABLE IF NOT EXISTS local_sync_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS local_partition_sequences (
  partition_key TEXT PRIMARY KEY,
  next_sequence INTEGER NOT NULL CHECK (next_sequence > 0)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS pending_operation_sequences (
  partition_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  local_sequence INTEGER NOT NULL CHECK (local_sequence > 0),
  PRIMARY KEY (partition_key, operation_id),
  UNIQUE (partition_key, local_sequence),
  FOREIGN KEY (partition_key, operation_id)
    REFERENCES pending_operations (partition_key, operation_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) WITHOUT ROWID, STRICT;
''';

final RegExp _opaquePattern = RegExp(r'^[A-Za-z0-9._:-]{1,512}$');
final RegExp _namePattern = RegExp(r'^[a-z][a-z0-9._-]{0,127}$');
final RegExp _versionPattern = RegExp(r'^[0-9]+\.[0-9]+$');

String _validateOpaque(String value, String field) {
  final normalized = value.trim();
  if (!_opaquePattern.hasMatch(normalized)) {
    throw LocalSyncDatabaseException(
      '$field must be an opaque 1-512 character value.',
    );
  }
  return normalized;
}

String _validateName(String value, String field) {
  final normalized = value.trim();
  if (!_namePattern.hasMatch(normalized)) {
    throw LocalSyncDatabaseException(
      '$field must use a lowercase versioned name.',
    );
  }
  return normalized;
}

String _validateVersion(String value) {
  final normalized = value.trim();
  if (!_versionPattern.hasMatch(normalized)) {
    throw const LocalSyncDatabaseException(
      'Transport schema version must use major.minor.',
    );
  }
  return normalized;
}

String _validateCursor(String value, String field) {
  final normalized = value.trim();
  final hasControlCharacter = normalized.runes.any(
    (int rune) => rune < 0x20 || rune == 0x7f,
  );
  if (normalized.isEmpty || normalized.length > 2048 || hasControlCharacter) {
    throw LocalSyncDatabaseException(
      '$field must be an opaque value of at most 2048 characters.',
    );
  }
  return normalized;
}

String _validateJsonObject(String value, String field) {
  Object? decoded;
  try {
    decoded = jsonDecode(value);
  } on FormatException {
    throw LocalSyncDatabaseException('$field must contain valid JSON.');
  }
  if (decoded is! Map<String, Object?>) {
    throw LocalSyncDatabaseException('$field must contain a JSON object.');
  }
  return jsonEncode(decoded);
}

String _timestamp(DateTime value) => value.toUtc().toIso8601String();
