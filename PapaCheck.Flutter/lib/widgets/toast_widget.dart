import 'package:flutter/material.dart';
import 'dart:async';
import '../theme/app_theme.dart';

/// Toast 提示组件
class ToastWidget extends StatefulWidget {
  final String message;
  final VoidCallback onDismiss;

  const ToastWidget({
    super.key,
    required this.message,
    required this.onDismiss,
  });

  @override
  State<ToastWidget> createState() => _ToastWidgetState();
}

class _ToastWidgetState extends State<ToastWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    _fadeAnim = CurvedAnimation(parent: _controller, curve: Curves.easeIn);
    _controller.forward();

    Timer(const Duration(seconds: 3), () {
      if (mounted) {
        _controller.reverse().then((_) => widget.onDismiss());
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      bottom: 40,
      left: 0,
      right: 0,
      child: FadeTransition(
        opacity: _fadeAnim,
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 20),
            decoration: BoxDecoration(
              color: AppTheme.card,
              borderRadius: BorderRadius.circular(40),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x66000000),
                  blurRadius: 40,
                  offset: Offset(0, 8),
                ),
              ],
            ),
            child: Text(
              widget.message,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w600,
                color: AppTheme.text,
              ),
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }
}
