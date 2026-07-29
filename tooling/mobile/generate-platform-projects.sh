#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_dir="${repo_root}/mobile/apps/store_companion"

if ! command -v flutter >/dev/null 2>&1; then
  echo "flutter is required" >&2
  exit 1
fi

before_pubspec="$(sha256sum "${app_dir}/pubspec.yaml" | awk '{print $1}')"
before_main="$(sha256sum "${app_dir}/lib/main.dart" | awk '{print $1}')"

flutter create \
  --platforms=android,ios \
  --org com.ozzyl \
  --project-name store_companion \
  "${app_dir}"

after_pubspec="$(sha256sum "${app_dir}/pubspec.yaml" | awk '{print $1}')"
after_main="$(sha256sum "${app_dir}/lib/main.dart" | awk '{print $1}')"

if [[ "${before_pubspec}" != "${after_pubspec}" ]]; then
  echo "flutter create changed the reviewed app pubspec" >&2
  exit 1
fi
if [[ "${before_main}" != "${after_main}" ]]; then
  echo "flutter create changed the reviewed app entry point" >&2
  exit 1
fi

cat > "${app_dir}/android/app/build.gradle.kts" <<'GRADLE'
plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.ozzyl.store_companion"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.ozzyl.store_companion"
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

    buildTypes {
        release {
            // Signing is intentionally not configured in source control.
            // Production signing is supplied through the trusted release pipeline.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}
GRADLE

python3 - "${app_dir}" <<'PY'
import json
import sys
from pathlib import Path

app_dir = Path(sys.argv[1])
manifest = app_dir / "android/app/src/main/AndroidManifest.xml"
manifest_text = manifest.read_text()
manifest_text = manifest_text.replace(
    'android:label="store_companion"',
    'android:label="@string/app_name"',
)
manifest.write_text(manifest_text)

for density in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
    icon_dir = app_dir / f"android/app/src/main/res/mipmap-{density}"
    if icon_dir.exists():
        for child in icon_dir.iterdir():
            child.unlink()
        icon_dir.rmdir()

app_icon_dir = app_dir / "ios/Runner/Assets.xcassets/AppIcon.appiconset"
for icon in app_icon_dir.glob("*.png"):
    icon.unlink()
contents_path = app_icon_dir / "Contents.json"
contents = json.loads(contents_path.read_text())
for image in contents.get("images", []):
    image.pop("filename", None)
contents_path.write_text(json.dumps(contents, indent=2) + "\n")
(app_icon_dir / "README.md").write_text(
    "# App Icon Placeholder\n\n"
    "The generated Flutter logo files are intentionally not committed because "
    "the product has no approved final public logo yet. The asset catalog "
    "remains valid for development/simulator compilation, but signed pilot or "
    "production release is blocked until approved Store Companion icon assets "
    "are supplied and reviewed.\n"
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
