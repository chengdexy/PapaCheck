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


async def _daemon_loop():
    """Read text lines from stdin, write MP3 responses to stdout"""
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        line = await reader.readline()
        if not line:  # EOF
            break
        text = line.decode('utf-8').strip()
        if not text:
            _write_response(b'')
            continue
        try:
            mp3_data = await generate(text)
            _write_response(mp3_data)
        except Exception as e:
            print(f"[TTS] error: {e}", file=sys.stderr)
            _write_response(b'')


if __name__ == '__main__':
    if '--daemon' in sys.argv:
        asyncio.run(_daemon_loop())
    else:
        # CLI mode (backward compatible)
        text = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
        mp3_data = asyncio.run(generate(text))
        sys.stdout.buffer.write(mp3_data)
