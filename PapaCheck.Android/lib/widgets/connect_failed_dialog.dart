import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class ConnectFailedDialog extends StatelessWidget {
  final String url;

  const ConnectFailedDialog({super.key, required this.url});

  static Future<String?> show(BuildContext context, {required String url}) {
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (_) => ConnectFailedDialog(url: url),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('连接失败'),
      content: Text('无法连接到 $url\n请确认服务器已启动'),
      actions: [
        TextButton(
          onPressed: () {
            Navigator.of(context).pop();
            SystemNavigator.pop();
          },
          child: const Text('退出'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop('config'),
          child: const Text('重新配置'),
        ),
        ElevatedButton(
          onPressed: () => Navigator.of(context).pop('retry'),
          child: const Text('重试'),
        ),
      ],
    );
  }
}
