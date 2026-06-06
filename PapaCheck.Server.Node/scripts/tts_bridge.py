#!/usr/bin/env python3
"""TTS bridge - called as subprocess by Node.js server"""
import asyncio, sys, hashlib, os

async def generate(text):
    import edge_tts
    communicate = edge_tts.Communicate(text, 'zh-CN-XiaoxiaoNeural')
    mp3_data = b''
    async for chunk in communicate.stream():
        if chunk['type'] == 'audio':
            mp3_data += chunk['data']
    # Write to stdout as raw bytes
    sys.stdout.buffer.write(mp3_data)

if __name__ == '__main__':
    text = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    asyncio.run(generate(text))
