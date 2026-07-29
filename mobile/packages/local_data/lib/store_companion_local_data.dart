/// Encrypted local persistence primitives for Store Companion.
library;

import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:sqlite3/sqlite3.dart';

/// Base exception for local persistence security failures.
class LocalDataSecurityException implements Exception {
  /// Creates a safe diagnostic exception without secret material.
  const LocalDataSecurityException(this.message);

  /// Safe failure description.
  final String message;

  @override
  String toString() => 'LocalDataSecurityException: $message';
}

/// Thrown when the application was built without the reviewed cipher library.
final class LocalCipherUnavailableException extends LocalDataSecurityException {
  /// Creates a fail-closed cipher availability error.
  const LocalCipherUnavailableException()
    : super('Encrypted SQLite support is unavailable in this application build.');
}

/// Thrown when secure key material is missing, malformed or cannot be persisted.
final class LocalKeyMaterialException extends LocalDataSecurityException {
  /// Creates a safe key-material error.
  const LocalKeyMaterialException(super.message);
}

/// Safe proof that the reviewed encrypted SQLite build is active.
final class LocalCipherEvidence {
  /// Creates non-secret cipher evidence.
  const LocalCipherEvidence({required this.cipher});

  /// Cipher implementation reported by SQLite3MultipleCiphers.
  final String cipher;
}

/// A validated 256-bit database passphrase that redacts itself from diagnostics.
final class LocalEncryptionKey {
  LocalEncryptionKey._(this._hex);

  /// Validates key material read from platform secure storage.
  factory LocalEncryptionKey.fromSecureStorage(String value) {
    if (!_keyPattern.hasMatch(value)) {
      throw const LocalKeyMaterialException(
        'Local database key material must contain exactly 32 random bytes.',
      );
    }
    return LocalEncryptionKey._(value);
  }

  final String _hex;

  /// Configures and validates one SQLite3MultipleCiphers connection.
  ///
  /// The cipher capability is checked before the key is applied. The key is
  /// never returned to callers and this type deliberately redacts diagnostics.
  void configure(Database database) {
    _cipherName(database);
    database.execute("PRAGMA key = '$_hex';");
    database.select('SELECT count(*) AS object_count FROM sqlite_master;');
    database.execute('PRAGMA foreign_keys = ON;');
    database.execute('PRAGMA secure_delete = ON;');

    final foreignKeys = database.select('PRAGMA foreign_keys;');
    final enabled = foreignKeys.isNotEmpty && foreignKeys.first.values.first == 1;
    if (!enabled) {
      throw const LocalDataSecurityException(
        'SQLite foreign-key enforcement could not be enabled.',
      );
    }
  }

  @override
  String toString() => 'LocalEncryptionKey(redacted)';
}

/// Runtime proof that the selected sqlite3 native asset supports encryption.
abstract final class LocalCipherProbe {
  /// Opens an isolated database, applies a redacted key and returns safe evidence.
  static LocalCipherEvidence verifyBuild(LocalEncryptionKey key) {
    final database = sqlite3.openInMemory();
    try {
      key.configure(database);
      return LocalCipherEvidence(cipher: _cipherName(database));
    } finally {
      database.close();
    }
  }
}

/// Secure-storage-backed owner of one opaque local database key reference.
final class FlutterSecureLocalKeyVault {
  /// Creates a vault for one opaque installation/workspace partition.
  FlutterSecureLocalKeyVault({
    required FlutterSecureStorage storage,
    required String storageReference,
  }) : _storage = storage,
       _storageKey = _validatedStorageKey(storageReference);

  final FlutterSecureStorage _storage;
  final String _storageKey;
  final Random _secureRandom = Random.secure();
  Future<LocalEncryptionKey>? _pending;

  /// Reads the existing key or creates and verifies one new 256-bit key.
  Future<LocalEncryptionKey> readOrCreate() =>
      _pending ??= _readOrCreate().whenComplete(() => _pending = null);

  /// Irreversibly removes the key for an approved purge/revocation flow.
  Future<void> delete() => _storage.delete(key: _storageKey);

  Future<LocalEncryptionKey> _readOrCreate() async {
    final existing = await _storage.read(key: _storageKey);
    if (existing != null) {
      return LocalEncryptionKey.fromSecureStorage(existing);
    }

    final generated = _generateKey(_secureRandom);
    await _storage.write(key: _storageKey, value: generated);
    final verified = await _storage.read(key: _storageKey);
    if (verified != generated) {
      throw const LocalKeyMaterialException(
        'Platform secure storage did not retain the local database key.',
      );
    }
    return LocalEncryptionKey.fromSecureStorage(generated);
  }
}

final RegExp _keyPattern = RegExp(r'^[0-9a-f]{64}$');
final RegExp _storageReferencePattern = RegExp(r'^[A-Za-z0-9_-]{24,128}$');

String _cipherName(Database database) {
  final rows = database.select('PRAGMA cipher;');
  if (rows.isEmpty || rows.first.values.isEmpty) {
    throw const LocalCipherUnavailableException();
  }
  final name = rows.first.values.first?.toString().trim() ?? '';
  if (name.isEmpty) {
    throw const LocalCipherUnavailableException();
  }
  return name;
}

String _validatedStorageKey(String reference) {
  if (!_storageReferencePattern.hasMatch(reference)) {
    throw const LocalKeyMaterialException(
      'Secure-storage reference must be an opaque 24-128 character value.',
    );
  }
  return 'store-companion.database-key.$reference';
}

String _generateKey(Random random) {
  final buffer = StringBuffer();
  for (var index = 0; index < 32; index += 1) {
    buffer.write(random.nextInt(256).toRadixString(16).padLeft(2, '0'));
  }
  return buffer.toString();
}
