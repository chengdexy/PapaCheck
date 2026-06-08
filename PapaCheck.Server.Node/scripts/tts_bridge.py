#!/usr/bin/env python3
"""TTS bridge - Daemon mode (--daemon) or CLI mode (default)"""
import asyncio, sys, struct, hashlib, os


async def generate(text):
    import edge_tts
    communicate = edge_tts.Communicate(text, 'zh-CN-XiaoxiaoNeural')
    mp3_data = b''
    async for chunk in communicate.stream():
        if chunk['type'] == 'audio':
            mp3_data += chunk['data']
    return mp3_data


def _write_response(data: bytes):
    """Write length-prefixed response to stdout"""
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def _daemon_loop():
    """Synchronous stdin/stdout loop.

    使用 os.read(0) 直接从文件描述符读取 stdin，绕过 Python
    的缓冲 IO 层，避免 Windows pipe 下 readline 不返回的问题。
    """
    buf = b''
    while True:
        try:
            chunk = os.read(0, 65536)
        except OSError as e:
            print(f"[TTS] stdin read error: {e}", file=sys.stderr)
            break
        if not chunk:  # EOF
            break
        buf += chunk
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            text = line.decode('utf-8').strip()
            if not text:
                _write_response(b'')
                continue
            try:
                mp3_data = asyncio.run(generate(text))
                _write_response(mp3_data)
            except Exception as e:
                print(f"[TTS] error: {e}", file=sys.stderr)
                _write_response(b'')


if __name__ == '__main__':
    if '--daemon' in sys.argv:
        _daemon_loop()
    else:
        # CLI mode (backward compatible)
        text = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
        mp3_data = asyncio.run(generate(text))
        sys.stdout.buffer.write(mp3_data)
