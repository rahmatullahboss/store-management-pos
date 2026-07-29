import 'package:flutter/material.dart';
import 'package:store_companion/src/store_companion_app.dart';
import 'package:store_companion_app_core/store_companion_app_core.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(StoreCompanionApp(bootstrap: CompanionBootstrap.synthetic()));
}
