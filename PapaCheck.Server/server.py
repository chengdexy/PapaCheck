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
import re
import sys
import socket
import asyncio
import io
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
import datetime
import db

PORT = int(os.environ.get('PAPACHECK_PORT', 8080))
_BASE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
_WEB_ROOT = os.path.join(_BASE, 'PapaCheck.Web')
if not os.path.isdir(_WEB_ROOT):
    _WEB_ROOT = os.path.join(_BASE, 'Web')
_TTS_CACHE_DIR = os.path.join(os.environ.get('PAPACHECK_DB_DIR', os.path.dirname(os.path.abspath(__file__))), 'tts_cache')
_tts_cache = {}
_show_polling_log = False
_server = None

os.makedirs(_TTS_CACHE_DIR, exist_ok=True)

def _gen_mp3(text):
    if text in _tts_cache:
        return _tts_cache[text]

    import hashlib
    safe_name = hashlib.md5(text.encode()).hexdigest() + '.mp3'
    cache_path = os.path.join(_TTS_CACHE_DIR, safe_name)
    if os.path.exists(cache_path):
        with open(cache_path, 'rb') as f:
            mp3_data = f.read()
        _tts_cache[text] = mp3_data
        return mp3_data

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
        asyncio.set_event_loop(loop)
        mp3_data = loop.run_until_complete(_run())
        loop.close()
    except Exception:
        mp3_data = b''
    if mp3_data:
        _tts_cache[text] = mp3_data
        os.makedirs(_TTS_CACHE_DIR, exist_ok=True)
        with open(cache_path, 'wb') as f:
            f.write(mp3_data)
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
        super().__init__(*args, directory=_WEB_ROOT, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/ping':
            self.send_json({
                'ok': True,
                'serverTime': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            })
            return

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

        if path == '/api/version':
            try:
                apk_dir = os.path.join(_WEB_ROOT, 'apk')
                ver = '1.0.0'
                if os.path.isdir(apk_dir):
                    apks = sorted(
                        [f for f in os.listdir(apk_dir) if f.endswith('.apk')],
                        reverse=True
                    )
                    if apks:
                        m = re.match(r'PapaCheck-(.+)\.apk$', apks[0])
                        if m:
                            ver = m.group(1)
                self.send_json({'clientVersion': ver})
            except Exception as e:
                print(f'  [/api/version 错误] {e}', flush=True)
                self.send_json({'clientVersion': '1.0.0'})
            return

        if path == '/api/sync/pull':
            qs = parse_qs(parsed.query)
            last_sync = qs.get('lastSync', [''])[0]
            if not last_sync:
                last_sync = '1970-01-01T00:00:00+00:00'
            changes = db.get_modified_since(last_sync)
            self.send_json({
                'changes': changes,
                'serverTime': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            })
            return

        if path == '/api/download':
            apk_dir = os.path.join(_WEB_ROOT, 'apk')
            if os.path.isdir(apk_dir):
                apks = sorted(
                    [f for f in os.listdir(apk_dir) if f.endswith('.apk')],
                    reverse=True
                )
                if apks:
                    apk_name = apks[0]
                    apk_path = os.path.join(apk_dir, apk_name)
                    with open(apk_path, 'rb') as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/vnd.android.package-archive')
                    self.send_header('Content-Length', len(data))
                    self.send_header('Content-Disposition', f'attachment; filename="{apk_name}"')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(data)
                    return
            self.send_error(404, 'APK not found')
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

        if path == '/api/bounty-tasks':
            self.send_json(db.get_bounty_tasks())
            return

        if path.startswith('/api/bounty-submissions/'):
            date_key = path[len('/api/bounty-submissions/'):]
            self.send_json(db.get_bounty_submissions(date_key))
            return

        if path.startswith('/api/bounty-completions/'):
            date_key = path[len('/api/bounty-completions/'):]
            self.send_json(db.get_bounty_completions(date_key))
            return

        try:
            super().do_GET()
        except (ConnectionAbortedError, ConnectionResetError):
            pass

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
            data = payload.get('settings', {})
            db.save_settings(data)
            global _show_polling_log
            _show_polling_log = data.get('show_polling_log', False)
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

        if path == '/api/bounty-tasks':
            db.save_bounty_tasks(payload.get('items', []))
            self.send_json({'ok': True})
            return

        if path.startswith('/api/bounty-submissions/'):
            date_key = path[len('/api/bounty-submissions/'):]
            db.save_bounty_submissions(date_key, payload.get('submissions', []))
            self.send_json({'ok': True})
            return

        if path.startswith('/api/bounty-completions/'):
            date_key = path[len('/api/bounty-completions/'):]
            db.save_bounty_completions(date_key, payload.get('completions', {}))
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

        if path == '/api/pregen-speech':
            texts = payload.get('texts', [])
            import threading
            def _bg():
                for text in texts:
                    if text and text.strip():
                        _gen_mp3(text)
            threading.Thread(target=_bg, daemon=True).start()
            self.send_json({'ok': True})
            return

        if path == '/api/reset-date':
            date_key = payload.get('date', '')
            if date_key:
                db.reset_date(date_key)
            self.send_json({'ok': True})
            return

        if path == '/api/sync/push':
            changes = payload.get('changes', [])
            db.push_merge(changes)
            self.send_json({'ok': True})
            return

        self.send_error(404, 'Not Found')

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/reward-box/'):
            item_id = path[len('/api/reward-box/'):]
            db.delete_reward_box_item(item_id)
            self.send_json({'ok': True})
            return

        self.send_error(404, 'Not Found')

    def end_headers(self):
        if self.path.endswith(('.js', '.html', '.css', '.json', '.png', '.ico', '.svg')):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def send_json(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError):
            pass

    def log_message(self, format, *args):
        try:
            msg = unquote(args[0])
        except TypeError:
            msg = str(args[0])
        if not _show_polling_log and 'GET /api/data' in msg:
            return
        if 'GET /api/ping' in msg or 'POST /api/ping' in msg:
            return
        print(f"  [{self.log_date_time_string()}] {msg}", flush=True)


def init_server(quiet=False):
    """初始化服务器：数据库、TTS 预生成等，返回 (server, ip)
    quiet=True: 不打印 banner（GUI/EXE 模式）
    """
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, OSError):
        pass
    db.init_db()
    ip = get_local_ip()

    s = db.get_settings()
    if s:
        global _show_polling_log
        _show_polling_log = s.get('show_polling_log', False)

    import threading
    fixed_texts = [
        '已申请延后，等待爸爸确认',
        '任务已暂停',
        '任务已继续',
        '还剩5分钟',
        '还剩1分钟',
        '已超时，请尽快完成',
        '全部作业已完成，等待爸爸评级',
        '作业被驳回，请查看',
        '奖励箱有新奖励，快去看看吧',
        '屏幕已唤醒',
        '已提交申请，等待爸爸确认',
        '兑换成功！',
        '积分商店上新啦',
        '收到云端作业，请查看',
        '收到新作业，请查看',
        '今天作业获得的评价是……优！',
        '今天作业获得的评价是……良！',
        '今天作业获得的评价是……可！',
        '今天作业获得的评价是……差！',
        '已提交',
    ] + ['现在是' + str(h) + '点' for h in range(24)]

    def _pregen_fixed():
        import hashlib
        valid = {hashlib.md5(t.encode()).hexdigest() + '.mp3' for t in fixed_texts}
        for text in fixed_texts:
            _gen_mp3(text)
        for fname in os.listdir(_TTS_CACHE_DIR):
            if fname.endswith('.mp3') and fname not in valid:
                try:
                    os.remove(os.path.join(_TTS_CACHE_DIR, fname))
                except Exception:
                    pass
        if not quiet:
            print('  [TTS] 固定短语预生成完成 (' + str(len(fixed_texts)) + ' 条)', flush=True)
        else:
            print('[TTS] 固定短语预生成完成 (' + str(len(fixed_texts)) + ' 条)', flush=True)
    threading.Thread(target=_pregen_fixed, daemon=True).start()

    server = HTTPServer(('0.0.0.0', PORT), ScheduleHandler)

    if not quiet:
        print()
        print('  ╔══════════════════════════════════════════════╗')
        print('  ║     📅 PapaCheck（爸~检查！）服务器已启动    ║')
        print('  ╠══════════════════════════════════════════════╣')
        print(f'  ║                                              ║')
        print(f'  ║  大屏端:  http://localhost:{PORT}              ║')
        print(f'  ║  管理端:  http://localhost:{PORT}/admin.html   ║')
        print(f'  ║  局域网:  http://{ip}:{PORT}          ║')
        print(f'  ║  存  储:  {db.DB_FILE}                   ║')
        print(f'  ║                                              ║')
        print(f'  ║  按 Ctrl+C 停止服务器                        ║')
        print(f'  ║                                              ║')
        print('  ╚══════════════════════════════════════════════╝')
        print()
    else:
        print('PapaCheck 服务器已启动', flush=True)
        print('数据库: ' + db.DB_FILE, flush=True)
        print('大屏端: http://localhost:' + str(PORT), flush=True)
        print('管理端: http://localhost:' + str(PORT) + '/admin.html', flush=True)
        print('局域网: http://' + ip + ':' + str(PORT), flush=True)

    return server, ip


def main():
    """命令行入口（保持兼容）"""
    server, ip = init_server()
    global _server
    _server = server
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  服务器已停止')
        server.server_close()
        db.close_connection()


if __name__ == '__main__':
    main()
