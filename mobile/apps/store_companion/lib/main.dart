import 'package:flutter/material.dart';
import 'package:store_companion/src/store_companion_app.dart';
import 'package:store_companion_app_core/store_companion_app_core.dart';
import 'package:store_companion_runtime_config/store_companion_runtime_config.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final runtimeConfig = MobileRuntimeConfig.fromEnvironment();
  runApp(
    Title(
      color: Colors.black,
      title: runtimeConfig.displayName,
      child: StoreCompanionApp(bootstrap: CompanionBootstrap.synthetic()),
    ),
  );
}
