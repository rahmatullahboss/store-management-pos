/// Operations Ledger colour tokens and Flutter theme for Store Companion.
library;

import 'package:flutter/material.dart';

/// Approved Operations Ledger colour tokens.
abstract final class OperationsLedgerColors {
  /// Primary text and icons.
  static const Color ink = Color(0xFF17231E);

  /// Secondary explanatory text.
  static const Color inkSoft = Color(0xFF405049);

  /// Metadata and freshness text.
  static const Color muted = Color(0xFF59675F);

  /// Application background.
  static const Color paper = Color(0xFFF5F3EC);

  /// Primary working surface.
  static const Color surface = Color(0xFFFFFEFA);

  /// Inputs, sheets, and raised controls.
  static const Color surfaceRaised = Color(0xFFFFFFFF);

  /// Strong navigation and context surface.
  static const Color rail = Color(0xFF14251E);

  /// Secondary navigation surface.
  static const Color railSoft = Color(0xFF20372D);

  /// Standard separator.
  static const Color line = Color(0xFFD7DDD8);

  /// Strong input/control boundary.
  static const Color lineStrong = Color(0xFFAAB6AF);

  /// Primary action and healthy state.
  static const Color accent = Color(0xFF1F6A51);

  /// Pressed action emphasis.
  static const Color accentStrong = Color(0xFF15523D);

  /// Healthy state surface.
  static const Color accentSoft = Color(0xFFDCECE5);

  /// Pending, stale, or offline state.
  static const Color attention = Color(0xFF8A5A00);

  /// Pending, stale, or offline surface.
  static const Color attentionSoft = Color(0xFFFFF0C7);

  /// Failure, denied, or destructive state.
  static const Color danger = Color(0xFF9B2C2C);

  /// Failure state surface.
  static const Color dangerSoft = Color(0xFFFBE1DF);

  /// Visible keyboard/focus highlight.
  static const Color focus = Color(0xFFE09A13);
}

/// Store Companion's approved light Operations Ledger theme.
abstract final class OperationsLedgerTheme {
  /// Builds the light operational theme without a network font dependency.
  static ThemeData light() {
    final base = ThemeData.light(useMaterial3: true);
    final colorScheme = ColorScheme.fromSeed(
      seedColor: OperationsLedgerColors.accent,
      brightness: Brightness.light,
    ).copyWith(
      primary: OperationsLedgerColors.accent,
      onPrimary: Colors.white,
      primaryContainer: OperationsLedgerColors.accentSoft,
      onPrimaryContainer: OperationsLedgerColors.ink,
      secondary: OperationsLedgerColors.railSoft,
      onSecondary: Colors.white,
      surface: OperationsLedgerColors.surface,
      onSurface: OperationsLedgerColors.ink,
      error: OperationsLedgerColors.danger,
      onError: Colors.white,
      errorContainer: OperationsLedgerColors.dangerSoft,
      onErrorContainer: OperationsLedgerColors.danger,
      outline: OperationsLedgerColors.lineStrong,
      outlineVariant: OperationsLedgerColors.line,
    );

    return base.copyWith(
      colorScheme: colorScheme,
      scaffoldBackgroundColor: OperationsLedgerColors.paper,
      dividerColor: OperationsLedgerColors.line,
      textTheme: base.textTheme.apply(
        bodyColor: OperationsLedgerColors.ink,
        displayColor: OperationsLedgerColors.ink,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: OperationsLedgerColors.rail,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: OperationsLedgerColors.surfaceRaised,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: OperationsLedgerColors.lineStrong),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: OperationsLedgerColors.lineStrong),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(
            color: OperationsLedgerColors.focus,
            width: 3,
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll<Size>(Size(44, 44)),
          shape: WidgetStatePropertyAll<OutlinedBorder>(
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll<Size>(Size(44, 44)),
          shape: WidgetStatePropertyAll<OutlinedBorder>(
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: OperationsLedgerColors.line,
        thickness: 1,
        space: 1,
      ),
      navigationBarTheme: const NavigationBarThemeData(
        backgroundColor: OperationsLedgerColors.surface,
        indicatorColor: OperationsLedgerColors.accentSoft,
        height: 72,
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: OperationsLedgerColors.rail,
        indicatorColor: OperationsLedgerColors.accentSoft,
        selectedIconTheme: IconThemeData(color: OperationsLedgerColors.rail),
        unselectedIconTheme: IconThemeData(color: Colors.white70),
        selectedLabelTextStyle: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w700,
        ),
        unselectedLabelTextStyle: TextStyle(color: Colors.white70),
      ),
      focusColor: OperationsLedgerColors.focus,
      visualDensity: VisualDensity.standard,
    );
  }
}
