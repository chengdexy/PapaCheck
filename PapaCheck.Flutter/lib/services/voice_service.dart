import 'dart:async';
import 'package:just_audio/just_audio.dart';
import 'api_service.dart';

/// 语音播报服务（对应 web 端 Voice 模块）
/// 队列播放 + 客户端缓存
class VoiceService {
  final List<String> _queue = [];
  bool _playing = false;
  final Map<String, String> _cache = {}; // text -> file path or url
  final _player = AudioPlayer();
  final _api = ApiService();

  void speak(String text) {
    _queue.add(text);
    if (!_playing) _playNext();
  }

  Future<void> _playNext() async {
    if (_queue.isEmpty) {
      _playing = false;
      return;
    }
    _playing = true;
    final text = _queue.removeAt(0);
    try {
      if (_cache.containsKey(text)) {
        // 缓存命中，直接播放已下载的文件
        await _playAudioUrl(_cache[text]!);
      } else {
        final url = _api.getSpeechUrl(text);
        _cache[text] = url;
        await _playAudioUrl(url);
      }
    } catch (_) {
      // ignore playback errors
    }
    _playNext();
  }

  Future<void> _playAudioUrl(String url) async {
    try {
      await _player.setUrl(url);
      await _player.play();
      // 等待播放完成
      await _player.processingStateStream.firstWhere(
        (s) => s == ProcessingState.completed,
      );
    } catch (_) {
      // ignore
    }
  }

  void dispose() {
    _player.dispose();
  }
}
