#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_dir="${repo_root}/mobile/apps/store_companion"
temp_root="$(mktemp -d)"
temp_app="${temp_root}/store_companion"

cleanup() {
  rm -rf "${temp_root}"
}
trap cleanup EXIT

if ! command -v flutter >/dev/null 2>&1; then
  echo "flutter is required" >&2
  exit 1
fi

for reviewed_path in \
  "${app_dir}/pubspec.yaml" \
  "${app_dir}/lib/main.dart" \
  "${app_dir}/test"; do
  if [[ ! -e "${reviewed_path}" ]]; then
    echo "missing reviewed application path: ${reviewed_path}" >&2
    exit 1
  fi
done

reviewed_tree_before="$(
  find \
    "${app_dir}/lib" \
    "${app_dir}/test" \
    "${app_dir}/pubspec.yaml" \
    -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | awk '{print $1}'
)"

flutter create \
  --no-pub \
  --platforms=android,ios \
  --org com.ozzyl \
  --project-name store_companion \
  "${temp_app}"

rm -rf "${app_dir}/android" "${app_dir}/ios"
cp -R "${temp_app}/android" "${app_dir}/android"
cp -R "${temp_app}/ios" "${app_dir}/ios"
cp "${temp_app}/.metadata" "${app_dir}/.metadata"

reviewed_tree_after="$(
  find \
    "${app_dir}/lib" \
    "${app_dir}/test" \
    "${app_dir}/pubspec.yaml" \
    -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | awk '{print $1}'
)"
if [[ "${reviewed_tree_before}" != "${reviewed_tree_after}" ]]; then
  echo "platform generation changed reviewed Dart application source" >&2
  exit 1
fi

old_activity="${app_dir}/android/app/src/main/kotlin/com/ozzyl/store_companion/MainActivity.kt"
new_activity_dir="${app_dir}/android/app/src/main/kotlin/com/ozzyl/storecompanion"
if [[ ! -f "${old_activity}" ]]; then
  echo "generated Android MainActivity was not found at the reviewed template path" >&2
  exit 1
fi
mkdir -p "${new_activity_dir}"
sed \
  's/^package com\.ozzyl\.store_companion$/package com.ozzyl.storecompanion/' \
  "${old_activity}" > "${new_activity_dir}/MainActivity.kt"
rm "${old_activity}"
rmdir \
  "${app_dir}/android/app/src/main/kotlin/com/ozzyl/store_companion" \
  2>/dev/null || true

cat > "${app_dir}/android/app/build.gradle.kts" <<'GRADLE'
plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.ozzyl.storecompanion"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.ozzyl.storecompanion"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    flavorDimensions += "environment"
    productFlavors {
        create("development") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            resValue("string", "app_name", "Store Companion Dev")
        }
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            resValue("string", "app_name", "Store Companion Staging")
        }
        create("production") {
            dimension = "environment"
            resValue("string", "app_name", "Store Companion")
        }
    }

    // No release signing configuration is committed. Trusted release jobs must
    // inject environment-specific signing material outside source control.
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
GRADLE

python3 - "${app_dir}" <<'PY'
import sys
from pathlib import Path

app_dir = Path(sys.argv[1])
manifest = app_dir / "android/app/src/main/AndroidManifest.xml"
manifest_text = manifest.read_text()
manifest_text = manifest_text.replace(
    'android:label="store_companion"',
    'android:label="@string/app_name"',
)
if 'android:label="@string/app_name"' not in manifest_text:
    raise SystemExit("Android application label did not match the reviewed template")
manifest.write_text(manifest_text)

project = app_dir / "ios/Runner.xcodeproj/project.pbxproj"
project_text = project.read_text()
old_bundle_prefix = "com.ozzyl.storeCompanion"
if old_bundle_prefix not in project_text:
    raise SystemExit("iOS bundle identifier did not match the reviewed template")
project.write_text(
    project_text.replace(old_bundle_prefix, "com.ozzyl.storecompanion")
)

(app_dir / "android/APP-IDENTITY.md").write_text(
    "# Android application identity\n\n"
    "- development: `com.ozzyl.storecompanion.dev`\n"
    "- staging: `com.ozzyl.storecompanion.staging`\n"
    "- production: `com.ozzyl.storecompanion`\n\n"
    "Generated launcher artwork is development-only Flutter placeholder art. "
    "Signed pilot and production release remain blocked until approved Store "
    "Companion artwork is supplied and reviewed.\n"
)
(app_dir / "ios/APP-IDENTITY.md").write_text(
    "# iOS application identity\n\n"
    "The generated base bundle identifier is `com.ozzyl.storecompanion`. "
    "Development/staging schemes and bundle suffixes remain an explicit macOS "
    "platform checkpoint. Generated AppIcon artwork is development-only Flutter "
    "placeholder art and cannot be used for signed pilot or production release.\n"
)
PY

cd "${repo_root}/mobile"
flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze

cd "${app_dir}"
flutter test
flutter build apk \
  --debug \
  --flavor development \
  --dart-define=APP_ENVIRONMENT=development
flutter build apk \
  --debug \
  --flavor staging \
  --dart-define=APP_ENVIRONMENT=staging
flutter build apk \
  --debug \
  --flavor production \
  --dart-define=APP_ENVIRONMENT=production

cd "${repo_root}"
git diff --check
