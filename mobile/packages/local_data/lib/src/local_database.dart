import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as path;
import 'package:sqlite3/sqlite3.dart';
import 'package:store_companion_sync_engine/store_companion_sync_engine.dart';

import '../store_companion_local_data.dart';

/// Safe local persistence failure without payload or key disclosure.
class LocalDatabaseException implements Exception {
  /// Creates a local database exception.
  const LocalDatabaseException(this.message);

  /// Safe failure description.
  final String message;

  @override
  String toString() => 'LocalDatabaseException: $message';
}

/// One durable operation row read from encrypted local storage.
final class PendingOperationSnapshot {
  /// Creates an immutable pending-operation snapshot.
  const PendingOperationSnapshot({
    required this.operationId,
    required this.idempotencyKey,
    required this.operationType,
    required this.schemaVersion,
    required this.payloadJson,
    required this.state,
    required this.attemptCount,
    required this.nextRetryAt,
    required this.traceId,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Stable client-generated operation identifier.
  final String operationId;

  /// Stable server idempotency key.
  final String idempotencyKey;

  /// Versioned owning-module operation type.
  final String operationType;

  /// Transport schema version.
  final String schemaVersion;

  /// Validated JSON object payload.
  final String payloadJson;

  /// Durable local sync state.
  final LocalOperationState state;

  /// Completed upload-attempt count.
  final int attemptCount;

  /// Earliest permitted automatic retry time.
  final DateTime? nextRetryAt;

  /// Safe latest server trace reference.
  final String? traceId;

  /// Creation timestamp.
  final DateTime createdAt;

  /// Last durable state-change timestamp.
  final DateTime updatedAt;
}

/// One authoritative operation result retained separately from the command row.
final class AuthoritativeResultSnapshot {
  /// Creates an immutable authoritative-result snapshot.
  const AuthoritativeResultSnapshot({
    required this.operationId,
    required this.status,
    required this.resultJson,
    required this.traceId,
    required this.receivedAt,
  });

  /// Matching operation identifier.
  final String operationId;

  /// Server-returned normalized status.
  final String status;

  /// Validated JSON object result.
  final String resultJson;

  /// Safe server trace reference.
  final String? traceId;

  /// Time the authoritative response was durably stored.
  final DateTime receivedAt;
}

/// Encrypted, partition-scoped local database for Store Companion.
///
/// Rebuildable projections are physically separated from drafts, pending
/// operations, authoritative results and cursors. Purging projections can never
/// remove unsent work.
final class StoreCompanionLocalDatabase {
  StoreCompanionLocalDatabase._({
    required Database database,
    required this.partitionKey,
    required this.databasePath,
  }) : _database = database;

  /// Opens, keys, validates and transactionally migrates one database file.
  factory StoreCompanionLocalDatabase.open({
    required String databasePath,
    required String partitionKey,
    required LocalEncryptionKey encryptionKey,
  }) {
    final normalizedPartition = _validateOpaqueValue(
      partitionKey,
      'partitionKey',
    );
    final normalizedPath = path.normalize(path.absolute(databasePath));
    Directory(path.dirname(normalizedPath)).createSync(recursive: true);

    final database = sqlite3.open(normalizedPath);
    try {
      encryptionKey.configure(database);
      final result = StoreCompanionLocalDatabase._(
        database: database,
        partitionKey: normalizedPartition,
        databasePath: normalizedPath,
      );
      result._migrate();
      return result;
    } catch (_) {
      database.close();
      rethrow;
    }
  }

  final Database _database;
  bool _closed = false;

  /// Opaque user/tenant/workspace partition reference.
  final String partitionKey;

  /// Absolute private application-support database path.
  final String databasePath;

  /// Current local schema version.
  int get schemaVersion {
    _ensureOpen();
    return _readUserVersion();
  }

  /// Closes the encrypted SQLite connection.
  void close() {
    if (_closed) {
      return;
    }
    _closed = true;
    _database.close();
  }

  /// Inserts or replaces one rebuildable server projection.
  void upsertProjection({
    required String projectionType,
    required String resourceId,
    required String serverVersion,
    required String payloadJson,
    required DateTime observedAt,
    DateTime? expiresAt,
  }) {
    _ensureOpen();
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
        _validateName(projectionType, 'projectionType'),
        _validateOpaqueValue(resourceId, 'resourceId'),
        _validateOpaqueValue(serverVersion, 'serverVersion'),
        _validateJsonObject(payloadJson, 'payloadJson'),
        _timestamp(observedAt),
        expiresAt == null ? null : _timestamp(expiresAt),
      ],
    );
  }

  /// Counts rebuildable projections for the active partition.
  int projectionCount() {
    _ensureOpen();
    return _singleInt(
      'SELECT count(*) AS value FROM local_projections WHERE partition_key = ?',
      <Object?>[partitionKey],
    );
  }

  /// Purges only rebuildable projections for this partition.
  int purgeRebuildableProjections() {
    _ensureOpen();
    _database.execute(
      'DELETE FROM local_projections WHERE partition_key = ?',
      <Object?>[partitionKey],
    );
    return _database.updatedRows;
  }

  /// Saves one local draft without creating an uploadable operation.
  void saveDraft({
    required String draftId,
    required String operationType,
    required String payloadJson,
    required DateTime updatedAt,
  }) {
    _ensureOpen();
    final now = _timestamp(updatedAt);
    _database.execute(
      '''
      INSERT INTO local_drafts (
        partition_key,
        draft_id,
        operation_type,
        payload_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (partition_key, draft_id) DO UPDATE SET
        operation_type = excluded.operation_type,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
      ''',
      <Object?>[
        partitionKey,
        _validateOpaqueValue(draftId, 'draftId'),
        _validateName(operationType, 'operationType'),
        _validateJsonObject(payloadJson, 'payloadJson'),
        now,
        now,
      ],
    );
  }

  /// Reads one draft JSON object, or `null` when absent.
  String? readDraft(String draftId) {
    _ensureOpen();
    final rows = _database.select(
      '''
      SELECT payload_json
      FROM local_drafts
      WHERE partition_key = ? AND draft_id = ?
      ''',
      <Object?>[
        partitionKey,
        _validateOpaqueValue(draftId, 'draftId'),
      ],
    );
    return rows.isEmpty ? null : rows.single['payload_json']! as String;
  }

  /// Irreversibly discards one draft without touching pending operations.
  bool discardDraft(String draftId) {
    _ensureOpen();
    _database.execute(
      'DELETE FROM local_drafts WHERE partition_key = ? AND draft_id = ?',
      <Object?>[
        partitionKey,
        _validateOpaqueValue(draftId, 'draftId'),
      ],
    );
    return _database.updatedRows == 1;
  }

  /// Commits one immutable uploadable operation exactly once.
  void commitPendingOperation({
    required String operationId,
    required String idempotencyKey,
    required String operationType,
    required String transportSchemaVersion,
    required String payloadJson,
    required DateTime committedAt,
  }) {
    _ensureOpen();
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
          _validateOpaqueValue(operationId, 'operationId'),
          _validateOpaqueValue(idempotencyKey, 'idempotencyKey'),
          _validateName(operationType, 'operationType'),
          _validateVersion(transportSchemaVersion),
          _validateJsonObject(payloadJson, 'payloadJson'),
          LocalOperationState.locallyCommitted.name,
          timestamp,
          timestamp,
        ],
      );
    } on SqliteException catch (error) {
      if (error.extendedResultCode == 1555 ||
          error.extendedResultCode == 2067) {
        throw const LocalDatabaseException(
          'Operation or idempotency key already exists in this partition.',
        );
      }
      rethrow;
    }
  }

  /// Reads one pending operation.
  PendingOperationSnapshot? readPendingOperation(String operationId) {
    _ensureOpen();
    final rows = _database.select(
      '''
      SELECT
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
      FROM pending_operations
      WHERE partition_key = ? AND operation_id = ?
      ''',
      <Object?>[
        partitionKey,
        _validateOpaqueValue(operationId, 'operationId'),
      ],
    );
    if (rows.isEmpty) {
      return null;
    }
    final row = rows.single;
    return PendingOperationSnapshot(
      operationId: row['operation_id']! as String,
      idempotencyKey: row['idempotency_key']! as String,
      operationType: row['operation_type']! as String,
      schemaVersion: row['transport_schema_version']! as String,
      payloadJson: row['payload_json']! as String,
      state: _parseState(row['state']! as String),
      attemptCount: row['attempt_count']! as int,
      nextRetryAt: _optionalTimestamp(row['next_retry_at']),
      traceId: row['trace_id'] as String?,
      createdAt: DateTime.parse(row['created_at']! as String),
      updatedAt: DateTime.parse(row['updated_at']! as String),
    );
  }

  /// Counts non-terminal operations that must survive migration and restart.
  int activePendingOperationCount() {
    _ensureOpen();
    return _singleInt(
      '''
      SELECT count(*) AS value
      FROM pending_operations
      WHERE partition_key = ?
        AND state NOT IN (?, ?, ?, ?, ?)
      ''',
      <Object?>[
        partitionKey,
        LocalOperationState.accepted.name,
        LocalOperationState.acceptedWithAdjustment.name,
        LocalOperationState.duplicateReplay.name,
        LocalOperationState.rejected.name,
        LocalOperationState.superseded.name,
      ],
    );
  }

  /// Applies one validated local state transition atomically.
  void transitionPendingOperation({
    required String operationId,
    required LocalOperationState state,
    required int attemptCount,
    required DateTime updatedAt,
    DateTime? nextRetryAt,
    String? traceId,
  }) {
    _ensureOpen();
    if (attemptCount < 0) {
      throw const LocalDatabaseException(
        'Operation attempt count cannot be negative.',
      );
    }
    _transaction(() {
      final current = readPendingOperation(operationId);
      if (current == null) {
        throw const LocalDatabaseException('Pending operation was not found.');
      }
      if (!LocalOperationTransitions.allows(current.state, state)) {
        throw LocalDatabaseException(
          'Invalid local operation transition: '
          '${current.state.name} -> ${state.name}.',
        );
      }
      if (attemptCount < current.attemptCount) {
        throw const LocalDatabaseException(
          'Operation attempt count cannot move backwards.',
        );
      }
      _database.execute(
        '''
        UPDATE pending_operations
        SET
          state = ?,
          attempt_count = ?,
          next_retry_at = ?,
          trace_id = ?,
          updated_at = ?
        WHERE partition_key = ? AND operation_id = ?
        ''',
        <Object?>[
          state.name,
          attemptCount,
          nextRetryAt == null ? null : _timestamp(nextRetryAt),
          traceId == null ? null : _validateTraceId(traceId),
          _timestamp(updatedAt),
          partitionKey,
          _validateOpaqueValue(operationId, 'operationId'),
        ],
      );
      if (_database.updatedRows != 1) {
        throw const LocalDatabaseException(
          'Pending operation transition did not update exactly one row.',
        );
      }
    });
  }

  /// Stores one authoritative server result exactly once and advances state.
  void recordAuthoritativeResult({
    required String operationId,
    required LocalOperationState state,
    required String status,
    required String resultJson,
    required DateTime receivedAt,
    String? traceId,
  }) {
    _ensureOpen();
    final normalizedStatus = _validateName(status, 'status');
    final normalizedResult = _validateJsonObject(resultJson, 'resultJson');
    final normalizedTrace =
        traceId == null ? null : _validateTraceId(traceId);
    final normalizedReceivedAt = _timestamp(receivedAt);

    _transaction(() {
      final existing = readAuthoritativeResult(operationId);
      if (existing != null) {
        if (existing.status != normalizedStatus ||
            existing.resultJson != normalizedResult ||
            existing.traceId != normalizedTrace) {
          throw const LocalDatabaseException(
            'Authoritative replay does not match the stored result.',
          );
        }
        return;
      }

      final current = readPendingOperation(operationId);
      if (current == null) {
        throw const LocalDatabaseException('Pending operation was not found.');
      }
      if (!LocalOperationTransitions.allows(current.state, state)) {
        throw LocalDatabaseException(
          'Invalid authoritative operation transition: '
          '${current.state.name} -> ${state.name}.',
        );
      }

      _database.execute(
        '''
        INSERT INTO operation_results (
          partition_key,
          operation_id,
          status,
          result_json,
          trace_id,
          received_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ''',
        <Object?>[
          partitionKey,
          _validateOpaqueValue(operationId, 'operationId'),
          normalizedStatus,
          normalizedResult,
          normalizedTrace,
          normalizedReceivedAt,
        ],
      );
      _database.execute(
        '''
        UPDATE pending_operations
        SET
          state = ?,
          trace_id = ?,
          next_retry_at = NULL,
          updated_at = ?
        WHERE partition_key = ? AND operation_id = ?
        ''',
        <Object?>[
          state.name,
          normalizedTrace,
          normalizedReceivedAt,
          partitionKey,
          _validateOpaqueValue(operationId, 'operationId'),
        ],
      );
      if (_database.updatedRows != 1) {
        throw const LocalDatabaseException(
          'Authoritative result did not update exactly one operation.',
        );
      }
    });
  }

  /// Reads one authoritative server result.
  AuthoritativeResultSnapshot? readAuthoritativeResult(String operationId) {
    _ensureOpen();
    final rows = _database.select(
      '''
      SELECT operation_id, status, result_json, trace_id, received_at
      FROM operation_results
      WHERE partition_key = ? AND operation_id = ?
      ''',
      <Object?>[
        partitionKey,
        _validateOpaqueValue(operationId, 'operationId'),
      ],
    );
    if (rows.isEmpty) {
      return null;
    }
    final row = rows.single;
    return AuthoritativeResultSnapshot(
      operationId: row['operation_id']! as String,
      status: row['status']! as String,
      resultJson: row['result_json']! as String,
      traceId: row['trace_id'] as String?,
      receivedAt: DateTime.parse(row['received_at']! as String),
    );
  }

  /// Stores an opaque incremental-sync cursor for one server stream.
  void writeCursor({
    required String streamName,
    required String cursor,
    required DateTime observedAt,
  }) {
    _ensureOpen();
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
        _validateName(streamName, 'streamName'),
        _validateOpaqueValue(cursor, 'cursor'),
        _timestamp(observedAt),
      ],
    );
  }

  /// Reads an opaque incremental-sync cursor.
  String? readCursor(String streamName) {
    _ensureOpen();
    final rows = _database.select(
      '''
      SELECT cursor_value
      FROM sync_cursors
      WHERE partition_key = ? AND stream_name = ?
      ''',
      <Object?>[
        partitionKey,
        _validateName(streamName, 'streamName'),
      ],
    );
    return rows.isEmpty ? null : rows.single['cursor_value']! as String;
  }

  /// Blocks destructive migrations while unsent or unresolved work exists.
  void requireDestructiveMigrationSafety() {
    if (activePendingOperationCount() != 0) {
      throw const LocalDatabaseException(
        'Destructive local migration is blocked while pending work exists.',
      );
    }
  }

  void _migrate() {
    final current = _readUserVersion();
    if (current > _currentSchemaVersion) {
      throw LocalDatabaseException(
        'Local database schema $current is newer than supported '
        'schema $_currentSchemaVersion.',
      );
    }
    if (current == _currentSchemaVersion) {
      return;
    }

    _transaction(() {
      if (current == 0) {
        _database.execute(_schemaVersionOne);
        _database.execute(
          '''
          INSERT INTO local_schema_migrations (version, applied_at)
          VALUES (?, ?)
          ''',
          <Object?>[_currentSchemaVersion, _timestamp(DateTime.now().toUtc())],
        );
        _database.execute('PRAGMA user_version = $_currentSchemaVersion;');
      }
    });

    if (_readUserVersion() != _currentSchemaVersion) {
      throw const LocalDatabaseException(
        'Local database migration did not reach the expected schema version.',
      );
    }
  }

  int _readUserVersion() {
    final rows = _database.select('PRAGMA user_version;');
    if (rows.length != 1 || rows.single.values.isEmpty) {
      throw const LocalDatabaseException(
        'SQLite did not return a valid schema version.',
      );
    }
    return rows.single.values.first! as int;
  }

  int _singleInt(String sql, List<Object?> parameters) {
    final rows = _database.select(sql, parameters);
    if (rows.length != 1) {
      throw const LocalDatabaseException(
        'Local database count query returned an invalid result.',
      );
    }
    return rows.single['value']! as int;
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
      throw const LocalDatabaseException('Local database is closed.');
    }
  }
}

const int _currentSchemaVersion = 1;

const String _schemaVersionOne = '''
CREATE TABLE local_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE local_projections (
  partition_key TEXT NOT NULL,
  projection_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  server_version TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  observed_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (partition_key, projection_type, resource_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX local_projections_expiry_idx
  ON local_projections (partition_key, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE local_drafts (
  partition_key TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (partition_key, draft_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX local_drafts_updated_idx
  ON local_drafts (partition_key, updated_at DESC);

CREATE TABLE pending_operations (
  partition_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  transport_schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  state TEXT NOT NULL CHECK (state IN (
    'draft',
    'locallyCommitted',
    'waitingForConnectivity',
    'waitingForRetry',
    'waitingForDependency',
    'uploading',
    'accepted',
    'acceptedWithAdjustment',
    'duplicateReplay',
    'deferred',
    'requiresOnlineConfirmation',
    'requiresApproval',
    'conflict',
    'rejected',
    'superseded',
    'unknownExternalState'
  )),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  next_retry_at TEXT,
  trace_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (partition_key, operation_id),
  UNIQUE (partition_key, idempotency_key)
) WITHOUT ROWID, STRICT;

CREATE INDEX pending_operations_dispatch_idx
  ON pending_operations (partition_key, state, next_retry_at, created_at);

CREATE TABLE operation_results (
  partition_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  trace_id TEXT,
  received_at TEXT NOT NULL,
  PRIMARY KEY (partition_key, operation_id),
  FOREIGN KEY (partition_key, operation_id)
    REFERENCES pending_operations (partition_key, operation_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) WITHOUT ROWID, STRICT;

CREATE TABLE sync_cursors (
  partition_key TEXT NOT NULL,
  stream_name TEXT NOT NULL,
  cursor_value TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (partition_key, stream_name)
) WITHOUT ROWID, STRICT;
''';

final RegExp _opaquePattern = RegExp(r'^[A-Za-z0-9._:-]{1,512}$');
final RegExp _namePattern = RegExp(r'^[a-z][a-z0-9._-]{0,127}$');
final RegExp _versionPattern = RegExp(r'^[0-9]+\.[0-9]+$');
final RegExp _tracePattern = RegExp(r'^[A-Za-z0-9._:-]{1,256}$');

String _validateOpaqueValue(String value, String field) {
  final normalized = value.trim();
  if (!_opaquePattern.hasMatch(normalized)) {
    throw LocalDatabaseException(
      '$field must be an opaque 1-512 character value.',
    );
  }
  return normalized;
}

String _validateName(String value, String field) {
  final normalized = value.trim();
  if (!_namePattern.hasMatch(normalized)) {
    throw LocalDatabaseException(
      '$field must use a lowercase versioned name.',
    );
  }
  return normalized;
}

String _validateVersion(String value) {
  final normalized = value.trim();
  if (!_versionPattern.hasMatch(normalized)) {
    throw const LocalDatabaseException(
      'Transport schema version must use major.minor.',
    );
  }
  return normalized;
}

String _validateTraceId(String value) {
  final normalized = value.trim();
  if (!_tracePattern.hasMatch(normalized)) {
    throw const LocalDatabaseException('Trace ID is invalid.');
  }
  return normalized;
}

String _validateJsonObject(String value, String field) {
  Object? decoded;
  try {
    decoded = jsonDecode(value);
  } on FormatException {
    throw LocalDatabaseException('$field must contain valid JSON.');
  }
  if (decoded is! Map<String, Object?>) {
    throw LocalDatabaseException('$field must contain a JSON object.');
  }
  return jsonEncode(decoded);
}

String _timestamp(DateTime value) => value.toUtc().toIso8601String();

DateTime? _optionalTimestamp(Object? value) =>
    value == null ? null : DateTime.parse(value as String);

LocalOperationState _parseState(String value) {
  for (final state in LocalOperationState.values) {
    if (state.name == value) {
      return state;
    }
  }
  throw const LocalDataSecurityException(
    'Encrypted local database contains an unknown operation state.',
  );
}
