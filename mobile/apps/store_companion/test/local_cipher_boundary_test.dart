import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_companion_local_data/store_companion_local_data.dart';

void main() {
  test('reviewed build exposes an encrypted SQLite cipher', () {
    final key = LocalEncryptionKey.fromSecureStorage('ab' * 32);

    final evidence = LocalCipherProbe.verifyBuild(key);

    expect(evidence.cipher, isNotEmpty);
    expect(key.toString(), 'LocalEncryptionKey(redacted)');
    expect(key.toString(), isNot(contains('abababab')));
  });

  test('database key material must contain exactly 32 random bytes', () {
    expect(
      () => LocalEncryptionKey.fromSecureStorage('not-a-database-key'),
      throwsA(isA<LocalKeyMaterialException>()),
    );
  });

  test('secure-storage references must be opaque and bounded', () {
    expect(
      () => FlutterSecureLocalKeyVault(
        storage: const FlutterSecureStorage(),
        storageReference: 'tenant-123',
      ),
      throwsA(isA<LocalKeyMaterialException>()),
    );

    expect(
      () => FlutterSecureLocalKeyVault(
        storage: const FlutterSecureStorage(),
        storageReference: 'opaque_partition_reference_001',
      ),
      returnsNormally,
    );
  });
}
