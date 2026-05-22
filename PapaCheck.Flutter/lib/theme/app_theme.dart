
import 'package:flutter/material.dart';

class AppTheme {
  static const bg = Color(0xFF0F172A);
  static const card = Color(0xFF1E293B);
  static const cardHover = Color(0xFF334155);
  static const text = Color(0xFFF8FAFC);
  static const textSecondary = Color(0xFF94A3B8);
  static const accent = Color(0xFF38BDF8);
  static const accentGlow = Color(0x4D38BDF8);
  static const success = Color(0xFF4ADE80);
  static const warning = Color(0xFFFBBF24);
  static const danger = Color(0xFFF87171);

  static ThemeData get darkTheme {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: bg,
      cardColor: card,
      colorScheme: const ColorScheme.dark(
        primary: accent,
        secondary: accent,
        surface: card,
        onPrimary: bg,
        onSecondary: bg,
        onSurface: text,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: bg,
        elevation: 0,
        centerTitle: true,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: bg,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}