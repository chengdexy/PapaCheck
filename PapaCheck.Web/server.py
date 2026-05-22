#!/usr/bin/env python3
"""
PapaCheck（爸~检查！）- 局域网服务器
用法: python server.py
大屏访问 http://<本机IP>:8080
管理端访问 http://<本机IP>:8080/admin.html
数据存储: SQLite (data.db)
"""

import json
import os
import sys
import socket
import asyncio
import io
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import db

PORT = 8080
_tts_cache = {}

def _gen_mp3(text):
    if text in _tts_cache:
        return _tts_cache[text]
    async def _run():
        import edge_tts
        communicate = edge_tts.Communicate(text, 'zh-CN-XiaoxiaoNeural')
        mp3_data = b''
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                mp3_data += chunk['data']
        return mp3_data
    try:
        loop = asyncio.new_event_loop()
        mp3_data = loop.run_until_complete(_run())
        loop.close()
    except Exception:
        mp3_data = b''
    _tts_cache[text] = mp3_data
    return mp3_data


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


class ScheduleHandler(SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/speak':
            qs = parse_qs(parsed.query)
            text = qs.get('text', [''])[0]
            if text:
                mp3_data = _gen_mp3(text)
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', len(mp3_data))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(mp3_data)
            else:
                self.send_error(400, 'Missing text')
            return

        if path == '/api/data':
            self.send_json(db.get_full_data())
            return

        if path.startswith('/api/tasks/'):
            date_key = path[len('/api/tasks/'):]
            self.send_json([])
            return

        if path.startswith('/api/homeworks/'):
            date_key = path[len('/api/homeworks/'):]
            self.send_json(db.get_homeworks(date_key))
            return

        if path.startswith('/api/settlement/'):
            date_key = path[len('/api/settlement/'):]
            self.send_json(db.get_settlement(date_key))
            return

        if path == '/api/shop':
            self.send_json(db.get_shop_items())
            return

        if path == '/api/redemptions':
            self.send_json(db.get_redemptions())
            return

        if path == '/api/reward-box':
            self.send_json(db.get_reward_box())
            return

        if path == '/api/settings':
            self.send_json(db.get_settings())
            return

        if path == '/api/active-buffs':
            self.send_json(db.get_active_buffs())
            return

        if path.startswith('/api/efficiency/'):
            date_key = path[len('/api/efficiency/'):]
            self.send_json(db.get_efficiency(date_key))
            return

        if path.startswith('/api/freetime/'):
            date_key = path[len('/api/freetime/'):]
            self.send_json(db.get_free_time(date_key))
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')

        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_error(400, 'Invalid JSON')
            return

        if path == '/api/data':
            db.import_full_data(payload)
            self.send_json({'ok': True})
            return

        if path.startswith('/api/tasks/'):
            self.send_json({'ok': True})
            return

        if path.startswith('/api/homeworks/'):
            date_key = path[len('/api/homeworks/'):]
            db.save_homeworks(date_key, payload.get('homeworks', []))
            self.send_json({'ok': True})
            return

        if path.startswith('/api/settlement/'):
            date_key = path[len('/api/settlement/'):]
            db.save_settlement(date_key, payload.get('settlement', {}))
            self.send_json({'ok': True})
            return

        if path == '/api/points':
            action = payload.get('action', 'earn')
            amount = payload.get('amount', 0)
            detail = payload.get('detail', '')
            balance = db.update_points(action, amount, detail)
            self.send_json({'ok': True, 'balance': balance})
            return

        if path == '/api/shop':
            db.save_shop_items(payload.get('items', []))
            self.send_json({'ok': True})
            return

        if path == '/api/redemptions':
            db.save_redemptions(payload.get('redemptions', []))
            self.send_json({'ok': True})
            return

        if path == '/api/reward-box':
            db.save_reward_box(payload.get('items', []))
            self.send_json({'ok': True})
            return

        if path == '/api/settings':
            db.save_settings(payload.get('settings', {}))
            self.send_json({'ok': True})
            return

        if path == '/api/active-buffs':
            db.save_active_buffs(payload.get('buffs', []))
            self.send_json({'ok': True})
            return

        if path.startswith('/api/efficiency/'):
            date_key = path[len('/api/efficiency/'):]
            db.save_efficiency(date_key, payload.get('efficiency', {}))
            self.send_json({'ok': True})
            return

        if path.startswith('/api/freetime/'):
            date_key = path[len('/api/freetime/'):]
            db.save_free_time(date_key, payload.get('tasks', []))
            self.send_json({'ok': True})
            return

        if path == '/api/defer-homework':
            date_key = payload.get('date', '')
            hw_id = payload.get('hwId', '')
            action = payload.get('action', 'request')
            if action == 'approve':
                import datetime
                tomorrow = datetime.date.today() + datetime.timedelta(days=1)
                to_key = tomorrow.isoformat()
                hw = db.move_homework(date_key, to_key, hw_id)
                if hw:
                    to_list = db.get_homeworks(to_key)
                    for h in to_list:
                        if h.get('id') == hw_id:
                            h['deferRequest'] = None
                            h['status'] = 'pending'
                            break
                    db.save_homeworks(to_key, to_list)
                self.send_json({'ok': True, 'homework': hw})
            elif action == 'reject':
                hw_list = db.get_homeworks(date_key)
                for h in hw_list:
                    if h.get('id') == hw_id and h.get('deferRequest') and h['deferRequest'].get('status') == 'pending':
                        h['deferRequest'] = None
                        break
                db.save_homeworks(date_key, hw_list)
                self.send_json({'ok': True})
            elif action == 'request':
                hw_list = db.get_homeworks(date_key)
                for h in hw_list:
                    if h.get('id') == hw_id and h.get('status') == 'pending' and not h.get('deferRequest'):
                        h['deferRequest'] = {'requestedAt': payload.get('requestedAt', ''), 'status': 'pending'}
                        break
                db.save_homeworks(date_key, hw_list)
                self.send_json({'ok': True})
            else:
                self.send_error(400, 'Unknown action')
            return

        if path == '/api/reset-date':
            date_key = payload.get('date', '')
            if date_key:
                db.reset_date(date_key)
            self.send_json({'ok': True})
            return

        self.send_error(404, 'Not Found')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def send_json(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"  [{self.log_date_time_string()}] {args[0]}", flush=True)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    db.init_db()
    ip = get_local_ip()
    server = HTTPServer(('0.0.0.0', PORT), ScheduleHandler)

    print()
    print('  ╔══════════════════════════════════════════════╗')
    print('  ║     📅 PapaCheck（爸~检查！）服务器已启动    ║')
    print('  ╠══════════════════════════════════════════════╣')
    print(f'  ║                                              ║')
    print(f'  ║  大屏端:  http://localhost:{PORT}              ║')
    print(f'  ║  管理端:  http://localhost:{PORT}/admin.html   ║')
    print(f'  ║  局域网:  http://{ip}:{PORT}          ║')
    print(f'  ║  存  储:  SQLite (data.db)                   ║')
    print(f'  ║                                              ║')
    print(f'  ║  按 Ctrl+C 停止服务器                        ║')
    print(f'  ║                                              ║')
    print('  ╚══════════════════════════════════════════════╝')
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  服务器已停止')
        server.server_close()


if __name__ == '__main__':
    main()
