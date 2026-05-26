# -*- coding: utf-8 -*-
import sys
import os
import re
import json
import shutil
import socket
import threading
import time
import webbrowser
import queue
import tkinter as tk
import tkinter.messagebox as tkmsg
from tkinter import filedialog
from datetime import datetime
import ctypes
import ctypes.wintypes
import urllib.request
import urllib.error

_CUR_DIR = os.path.dirname(os.path.abspath(__file__))

# --- 必须在任何 import db 之前设置 PAPACHECK_DB_DIR ---
if getattr(sys, 'frozen', False):
    _LOCAL_APP_DATA = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
    _DB_DIR = os.path.join(_LOCAL_APP_DATA, 'PapaCheck', 'Server')
    os.makedirs(_DB_DIR, exist_ok=True)
else:
    _DB_DIR = os.path.normpath(os.path.join(_CUR_DIR, '..', 'PapaCheck.Server'))
os.environ['PAPACHECK_DB_DIR'] = _DB_DIR

# --- email_client 导入（需在 import server 之前，确保 db 可寻址） ---
_EMAIL_DIR = os.path.normpath(os.path.join(_CUR_DIR, '..', 'PapaCheck.Email'))
_SERVER_DIR2 = os.path.normpath(os.path.join(_CUR_DIR, '..', 'PapaCheck.Server'))
for p in (_EMAIL_DIR, _SERVER_DIR2):
    if p not in sys.path:
        sys.path.insert(0, p)
import email_client

# --- Windows Credential Manager ---
_CredWriteW = ctypes.windll.advapi32.CredWriteW
_CredReadW = ctypes.windll.advapi32.CredReadW
_CredDeleteW = ctypes.windll.advapi32.CredDeleteW
_CRED_TYPE_GENERIC = 1
_CRED_PERSIST_LOCAL_MACHINE = 2


class _CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ('Flags', ctypes.wintypes.DWORD),
        ('Type', ctypes.wintypes.DWORD),
        ('TargetName', ctypes.wintypes.LPCWSTR),
        ('Comment', ctypes.wintypes.LPCWSTR),
        ('LastWritten', ctypes.wintypes.FILETIME),
        ('CredentialBlobSize', ctypes.wintypes.DWORD),
        ('CredentialBlob', ctypes.wintypes.LPBYTE),
        ('Persist', ctypes.wintypes.DWORD),
        ('AttributeCount', ctypes.wintypes.DWORD),
        ('Attributes', ctypes.c_void_p),
        ('TargetAlias', ctypes.wintypes.LPCWSTR),
        ('UserName', ctypes.wintypes.LPCWSTR),
    ]


def _credential_write(name, value):
    value_bytes = (value + '\0').encode('utf-16-le')
    blob = (ctypes.c_byte * len(value_bytes)).from_buffer_copy(value_bytes)
    cred = _CREDENTIAL(
        Type=_CRED_TYPE_GENERIC,
        TargetName=name,
        CredentialBlobSize=len(value_bytes),
        CredentialBlob=ctypes.cast(blob, ctypes.wintypes.LPBYTE),
        Persist=_CRED_PERSIST_LOCAL_MACHINE,
        UserName=None,
    )
    _CredWriteW(ctypes.byref(cred), 0)


def _credential_read(name):
    pcred = ctypes.POINTER(_CREDENTIAL)()
    ok = _CredReadW(name, _CRED_TYPE_GENERIC, 0, ctypes.byref(pcred))
    if not ok:
        return None
    cred = pcred.contents
    blob_size = cred.CredentialBlobSize
    addr = ctypes.cast(cred.CredentialBlob, ctypes.c_void_p).value
    raw = (ctypes.c_byte * blob_size).from_address(addr)
    value = bytes(raw).decode('utf-16-le').rstrip('\0')
    ctypes.windll.advapi32.CredFree(pcred)
    return value


def _credential_delete(name):
    return _CredDeleteW(name, _CRED_TYPE_GENERIC, 0)


# --- 配置路径 ---
_CONFIG_DIR = os.path.join(os.environ['APPDATA'], 'PapaCheck')
_CONFIG_PATH = os.path.join(_CONFIG_DIR, 'config.json')


def _load_config():
    if not os.path.exists(_CONFIG_PATH):
        return None
    try:
        with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _save_config(data):
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    with open(_CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def _ensure_config():
    if not os.path.exists(_CONFIG_PATH):
        template = {
            'imap_server': '',
            'port': 993,
            'email': '',
            'sender': '',
            'server_url': 'http://localhost:8080',
            'mark_as_read': True,
            'ai_base_url': 'https://api.deepseek.com',
            'ai_model': 'deepseek-chat',
            'show_apk_hint': True,
            'email_attachment_dir': '',
            'use_ai_email': False,
            'auto_start_server': True,
        }
        _save_config(template)
    return _load_config()


def _get_default_attachment_dir():
    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
    else:
        base = _CUR_DIR
    return os.path.join(base, 'Download')


def _get_attachment_dir(cfg):
    path = cfg.get('email_attachment_dir', '').strip()
    if path:
        return path
    return _get_default_attachment_dir()


# --- HTTP API ---
def save_homeworks_via_api(server_url, date_key, new_items):
    url = f'{server_url}/api/homeworks/{date_key}'

    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        existing = json.loads(resp.read())
    manual = [h for h in existing if h.get('source') != 'email']

    merged = manual + new_items
    data = json.dumps({'homeworks': merged}).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    urllib.request.urlopen(req, timeout=10)


if getattr(sys, 'frozen', False):
    _SERVER_DIR = os.path.join(sys._MEIPASS, 'Server')

    _bundled_db = os.path.join(_SERVER_DIR, 'data.db')
    _target_db = os.path.join(_DB_DIR, 'data.db')
    if os.path.exists(_bundled_db) and not os.path.exists(_target_db):
        try:
            shutil.copy2(_bundled_db, _target_db)
        except Exception:
            pass

    ICON_TRAY = os.path.join(sys._MEIPASS, 'icon.ico')
    ICON_TBAR = os.path.join(sys._MEIPASS, 'icon.ico')
else:
    _SERVER_DIR = os.path.normpath(os.path.join(_CUR_DIR, '..', 'PapaCheck.Server'))
    ICON_TRAY = os.path.join(_CUR_DIR, 'icon.ico')
    ICON_TBAR = os.path.join(_CUR_DIR, 'icon.ico')

if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

import winreg
from server import init_server

AUTORUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = "PapaCheckServer"
PORT = 8080
_SINGLE_INSTANCE_PORT = 58080

# --- Unicode symbols for UI ---
SYMBOL_STOP = '\u23f9'      # ⏹
SYMBOL_PHONE = '\U0001f4f1' # 📱
SYMBOL_CLIPBOARD = '\U0001f4cb'  # 📋
SYMBOL_MAN = '\U0001f468'   # 👨
SYMBOL_CALENDAR = '\U0001f4c5'  # 📅


def _resource_path(relative):
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, relative)
    return os.path.normpath(os.path.join(_CUR_DIR, '..', relative))


class ServerThread(threading.Thread):
    def __init__(self, server):
        super().__init__(daemon=True)
        self.server = server
        self._stopped = False

    def run(self):
        try:
            self.server.serve_forever()
        except Exception:
            pass

    def stop(self):
        if not self._stopped:
            self._stopped = True
            threading.Thread(target=self._do_shutdown, daemon=True).start()

    def _do_shutdown(self):
        try:
            self.server.shutdown()
        except Exception:
            pass


class LogRedirector:
    def __init__(self, log_queue):
        self.log_queue = log_queue
        self._stdout = sys.stdout
        self._stderr = sys.stderr

    def write(self, text):
        if text and text.strip():
            self.log_queue.put(text)
        if self._stdout:
            try:
                self._stdout.write(text)
            except Exception:
                pass

    def flush(self):
        if self._stdout:
            try:
                self._stdout.flush()
            except Exception:
                pass

    def __enter__(self):
        sys.stdout = self
        sys.stderr = self
        return self

    def __exit__(self, *args):
        sys.stdout = self._stdout
        sys.stderr = self._stderr


class PapaCheckApp:
    def __init__(self):
        self.root = tk.Tk()
        self._instance_sock = None

        if not self._ensure_single_instance():
            self.root.withdraw()
            self.root.destroy()
            return

        self.root.title('PapaCheck 服务器')
        self.root.resizable(False, False)
        self.root.configure(bg='#0f172a')

        self.root.withdraw()
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        self._screen_w = sw
        self._screen_h = sh

        self._apk_hint_visible = True

        self.server = None
        self.server_thread = None
        self.ip = '127.0.0.1'
        self.running = False
        self.tray_icon = None
        self.tray_thread = None
        self.destroyed = False

        self.log_queue = queue.Queue()
        self.log_redirector = LogRedirector(self.log_queue)

        self._auto_start_var = tk.BooleanVar(value=self._is_autostart())

        try:
            self.root.iconbitmap(ICON_TBAR)
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('PapaCheck')
        except Exception:
            pass

        self._build_ui()

        self.root.deiconify()

        self.root.protocol('WM_DELETE_WINDOW', self._on_close)

        self._build_menu()
        self._email_sync_btn = self._plain_btn(
            self._btn_frame, 'AI 发作业', self._on_email_sync)

        cfg = _load_config() or {}
        if cfg.get('use_ai_email', False):
            self._email_sync_btn.pack(side=tk.LEFT, padx=(8, 0))

        self.root.after(100, self._start_server) if cfg.get('auto_start_server', True) else None
        self.root.after(200, self._poll_log_queue)
        self.root.after(300, self._start_tray)

    def _ensure_single_instance(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(('127.0.0.1', _SINGLE_INSTANCE_PORT))
            sock.listen(1)
            self._instance_sock = sock
            t = threading.Thread(target=self._listen_instance, daemon=True)
            t.start()
            return True
        except OSError:
            sock.close()
            try:
                s2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s2.settimeout(2)
                s2.connect(('127.0.0.1', _SINGLE_INSTANCE_PORT))
                s2.sendall(b'RESTORE\n')
                s2.close()
            except Exception:
                pass
            return False

    def _listen_instance(self):
        while True:
            try:
                conn, _ = self._instance_sock.accept()
                conn.recv(1024)
                conn.close()
                self.root.after(0, self._restore_window)
            except Exception:
                break

    # ===== UI 布局 =====

    def _build_ui(self):
        bg = '#0f172a'
        fg = '#e2e8f0'
        card_bg = '#1e293b'
        border = '#334155'
        green = '#4ade80'
        red = '#f87171'

        # --- 标题行 ---
        title_frame = tk.Frame(self.root, bg=bg)
        title_frame.pack(fill=tk.X, padx=20, pady=(18, 8))
        tk.Label(title_frame,
                 text=f'{SYMBOL_CALENDAR} PapaCheck 服务器',
                 font=('Microsoft YaHei UI', 16, 'bold'), bg=bg, fg=fg).pack(side=tk.LEFT)

        # --- 状态行：圆点 + 运行中 + 局域网 IP ---
        status_frame = tk.Frame(self.root, bg=bg)
        status_frame.pack(fill=tk.X, padx=20, pady=(0, 10))

        self.status_canvas = tk.Canvas(status_frame, width=14, height=14,
                                       bg=bg, highlightthickness=0)
        self.status_canvas.pack(side=tk.LEFT, padx=(0, 6))
        self._status_dot = self.status_canvas.create_oval(2, 2, 12, 12, fill=red, outline='')

        self.status_label = tk.Label(status_frame, text='未启动',
                                     font=('Microsoft YaHei UI', 10, 'bold'), bg=bg, fg=red)
        self.status_label.pack(side=tk.LEFT)

        self.ip_label = tk.Label(status_frame, text='局域网 IP: ...',
                                 font=('Consolas', 10), bg=bg, fg='#94a3b8')
        self.ip_label.pack(side=tk.RIGHT)

        # --- URL 卡片区域（带边框） ---
        url_outer = tk.Frame(self.root, bg=border)
        url_outer.pack(fill=tk.X, padx=20, pady=(0, 10))
        urls_frame = tk.Frame(url_outer, bg=card_bg)
        urls_frame.pack(fill=tk.X, padx=1, pady=1)

        self._url_row(urls_frame,
                      f'{SYMBOL_PHONE} 孩子端',
                      PORT, '', 'child_url', green, border)

        self._url_row(urls_frame,
                      f'{SYMBOL_MAN} 爸爸管理端',
                      PORT, '/admin.html', 'parent_url', '#38bdf8', None)

        # --- APK 下载提示 ---
        cfg_hint = _load_config()
        if cfg_hint and cfg_hint.get('show_apk_hint', True):
            self._apk_hint_visible = True
            hint_row = tk.Frame(urls_frame, bg='#1e293b')
            hint_row.pack(fill=tk.X, padx=16, pady=(12, 0))
            self._apk_hint_row = hint_row
            self._apk_hint_label = tk.Label(hint_row,
                text='📦 首次使用？在 Android 设备浏览器中访问:',
                font=('Microsoft YaHei UI', 9), bg='#1e293b', fg='#fbbf24')
            self._apk_hint_label.pack(side=tk.LEFT)
            self._apk_dismiss_btn = tk.Label(hint_row,
                text='不再提醒', font=('Microsoft YaHei UI', 8),
                fg='#64748b', bg='#1e293b', cursor='hand2')
            self._apk_dismiss_btn.bind('<Button-1>', lambda e: self._dismiss_apk_hint())
            self._apk_dismiss_btn.pack(side=tk.RIGHT)
            self._apk_url_label = tk.Label(urls_frame,
                text='',
                font=('Consolas', 9), bg='#1e293b', fg='#94a3b8')
            self._apk_url_label.pack(fill=tk.X, padx=16, pady=(0, 12))
        else:
            self._apk_hint_visible = False

        # --- 分隔线标题：服务器日志 ---
        self._log_sep = tk.Frame(self.root, bg=bg)
        self._log_sep.pack(fill=tk.X, padx=20, pady=(4, 2))
        tk.Label(self._log_sep, text='── 服务器日志 ──',
                 font=('Microsoft YaHei UI', 9), bg=bg, fg='#64748b').pack(anchor=tk.W)

        # --- 日志区域（带边框，固定高度防止挤压按钮） ---
        log_outer = tk.Frame(self.root, bg=border, height=200)
        log_outer.pack(fill=tk.X, padx=20, pady=(0, 10))
        log_outer.pack_propagate(False)
        log_frame = tk.Frame(log_outer, bg=card_bg)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=1, pady=1)

        self.log_text = tk.Text(log_frame, bg='#020617', fg='#94a3b8',
                                font=('Consolas', 9), wrap=tk.WORD, state=tk.DISABLED,
                                bd=0, padx=10, pady=8, highlightthickness=0)
        self.log_text.pack(fill=tk.BOTH, expand=True)
        self.log_text.tag_config('success', foreground='#4ade80')
        self.log_text.tag_config('error', foreground='#f87171')
        self.log_text.tag_config('warning', foreground='#fbbf24')
        self.log_text.tag_config('info', foreground='#94a3b8')
        self.log_text.tag_config('highlight', foreground='#60a5fa')

        # --- 按钮行：打开孩子端/管理端（左）+ 开机自启动/启动服务器（右） ---
        btn_frame = tk.Frame(self.root, bg=bg)
        self._btn_frame = btn_frame
        btn_frame.pack(fill=tk.X, padx=20, pady=(0, 10))

        left_btns = tk.Frame(btn_frame, bg=bg)
        left_btns.pack(side=tk.LEFT)
        self._plain_btn(left_btns,
                        '打开孩子端',
                        self._open_child).pack(side=tk.LEFT)
        self._plain_btn(left_btns,
                        '打开管理端',
                        self._open_parent).pack(side=tk.LEFT, padx=(8, 0))
        self._open_attach_btn = self._plain_btn(left_btns,
                        '查看作业附件', self._open_attach_dir)
        cfg_ui = _load_config() or {}
        if cfg_ui.get('use_ai_email', False):
            self._open_attach_btn.pack(side=tk.LEFT, padx=(8, 0))

        right_btns = tk.Frame(btn_frame, bg=bg)
        right_btns.pack(side=tk.RIGHT)
        self.start_btn = tk.Button(right_btns,
                                   text=f'{SYMBOL_STOP} 启动服务器',
                                   font=('Microsoft YaHei UI', 9),
                                   bg='#22c55e', fg='white',
                                   activebackground='#16a34a', activeforeground='white',
                                   relief=tk.FLAT, bd=0, padx=14, pady=7,
                                   cursor='hand2', command=self._toggle_server)
        self.start_btn.pack(side=tk.RIGHT)
        self.auto_start_cb = tk.Checkbutton(right_btns,
                                            text='开机自启动',
                                            variable=self._auto_start_var,
                                            font=('Microsoft YaHei UI', 9),
                                            bg=bg, fg=fg,
                                            selectcolor=bg,
                                            activebackground=bg, activeforeground=fg,
                                            command=self._toggle_autostart)
        self.auto_start_cb.pack(side=tk.RIGHT, padx=(0, 16))

        h = 580 if self._apk_hint_visible else 520
        self.root.geometry(f'720x{h}+{(self._screen_w - 720) // 2}+{(self._screen_h - h) // 2}')

    def _apply_window_height(self, visible):
        self._apk_hint_visible = visible
        h = 580 if visible else 520
        x = self.root.winfo_x()
        y = self.root.winfo_y()
        self.root.geometry(f'720x{h}+{x}+{y}')

    def _dismiss_apk_hint(self):
        self._apk_hint_row.pack_forget()
        self._apk_url_label.pack_forget()
        self._apply_window_height(False)
        cfg = _load_config() or {}
        cfg['show_apk_hint'] = False
        _save_config(cfg)

    def _restore_apk_hint(self):
        self._apk_hint_row.pack(fill=tk.X, padx=16, pady=(12, 0),
                                before=self._log_sep)
        self._apk_url_label.pack(fill=tk.X, padx=16, pady=(0, 12),
                                 before=self._log_sep)
        self._apply_window_height(True)
        cfg = _load_config() or {}
        cfg['show_apk_hint'] = True
        _save_config(cfg)

    def _plain_btn(self, parent, text, command):
        return tk.Button(parent, text=text, font=('Microsoft YaHei UI', 9),
                         bg='#334155', fg='#e2e8f0',
                         activebackground='#475569', activeforeground='#e2e8f0',
                         relief=tk.FLAT, bd=0, padx=14, pady=7,
                         cursor='hand2', command=command)

    def _url_row(self, parent, label, port, path, attr_name, accent_color, sep_color):
        if sep_color:
            s = tk.Frame(parent, bg=sep_color, height=1)
            s.pack(fill=tk.X, padx=12)

        row = tk.Frame(parent, bg='#1e293b')
        row.pack(fill=tk.X, padx=16, pady=12)

        tk.Label(row, text=label, font=('Microsoft YaHei UI', 10, 'bold'),
                 bg='#1e293b', fg=accent_color).pack(side=tk.LEFT)

        url_var = tk.StringVar(value=f'http://127.0.0.1:{port}{path}')
        setattr(self, f'_{attr_name}_var', url_var)

        tk.Label(row, textvariable=url_var, font=('Consolas', 9),
                 bg='#1e293b', fg='#e2e8f0').pack(side=tk.LEFT, padx=(10, 0))

        copy_btn = tk.Button(row, text='复制', font=('Microsoft YaHei UI', 8),
                             bg='#334155', fg='#94a3b8',
                             activebackground='#475569', activeforeground='white',
                             relief=tk.FLAT, bd=0, padx=12, pady=3,
                             cursor='hand2',
                             command=lambda v=url_var: self._copy_url(v.get()))
        copy_btn.pack(side=tk.RIGHT)

    def _copy_url(self, url):
        self.root.clipboard_clear()
        self.root.clipboard_append(url)
        self._append_log('已复制: ' + url)

    def _open_child(self):
        webbrowser.open('http://localhost:' + str(PORT))

    def _open_parent(self):
        webbrowser.open('http://localhost:' + str(PORT) + '/admin.html')

    # ===== 菜单栏 =====

    def _build_menu(self):
        menubar = tk.Menu(self.root)
        self.root.config(menu=menubar)

        def _open_settings():
            self.root.after(0, self._show_settings)

        menubar.add_command(label='服务配置', accelerator='Ctrl+P',
                            command=_open_settings)
        menubar.add_command(label='最小化到托盘', accelerator='Ctrl+M',
                            command=self._minimize_to_tray)
        menubar.add_command(label='退出', accelerator='Ctrl+Q',
                            command=self._quit_app)

        self.root.bind_all('<Control-p>', lambda e: self._show_settings())
        self.root.bind_all('<Control-P>', lambda e: self._show_settings())
        self.root.bind_all('<Control-m>', lambda e: self._minimize_to_tray())
        self.root.bind_all('<Control-M>', lambda e: self._minimize_to_tray())
        self.root.bind_all('<Control-q>', lambda e: self._quit_app())
        self.root.bind_all('<Control-Q>', lambda e: self._quit_app())

    # ===== 开机自启动 =====

    def _is_autostart(self):
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTORUN_KEY, 0, winreg.KEY_READ)
            winreg.QueryValueEx(key, APP_NAME)
            winreg.CloseKey(key)
            return True
        except FileNotFoundError:
            return False
        except Exception:
            return False

    def _set_autostart(self, enable):
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTORUN_KEY, 0, winreg.KEY_SET_VALUE)
            if enable:
                exe_path = sys.executable
                script_path = os.path.abspath(__file__)
                if getattr(sys, 'frozen', False):
                    winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, '"' + exe_path + '"')
                else:
                    winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ,
                                      '"' + exe_path + '" "' + script_path + '"')
            else:
                try:
                    winreg.DeleteValue(key, APP_NAME)
                except FileNotFoundError:
                    pass
            winreg.CloseKey(key)
        except Exception as e:
            self._append_log('开机自启动设置失败: ' + str(e))

    def _toggle_autostart(self):
        self._set_autostart(self._auto_start_var.get())

    # ===== 服务器生命周期 =====

    def _start_server(self):
        if self.server:
            try:
                self.server.server_close()
            except Exception:
                pass
            self.server = None

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        in_use = False
        try:
            sock.bind(('0.0.0.0', PORT))
        except OSError:
            in_use = True
        finally:
            sock.close()

        if in_use:
            self._append_log('端口 ' + str(PORT) + ' 已被占用（可能已有服务器在运行）')
            self._append_log('请先停止其他 PapaCheck 服务器后再启动')
            self._handle_server_exit()
            return

        self._append_log('正在启动服务器...')
        self.log_redirector.__enter__()
        try:
            self.server, self.ip = init_server(quiet=True)
        except Exception as e:
            self.log_redirector.__exit__(None, None, None)
            self._append_log('服务器启动失败: ' + str(e))
            self._handle_server_exit()
            return

        self.server_thread = ServerThread(self.server)
        self.server_thread.start()
        self.running = True
        self._set_status(True)

        self._child_url_var.set('http://' + self.ip + ':' + str(PORT))
        self._parent_url_var.set('http://' + self.ip + ':' + str(PORT) + '/admin.html')
        self.ip_label.config(text='局域网 IP: ' + self.ip)
        if self._apk_hint_visible:
            self._apk_url_label.config(
                text='http://' + self.ip + ':' + str(PORT) + '/api/download')

        self._append_log('服务器启动成功 (端口 ' + str(PORT) + ', 局域网 IP: ' + self.ip + ')')
        self._append_log('数据库位置: ' + os.path.join(_DB_DIR, 'data.db'))

        self.root.after(2000, self._check_still_running)

    def _stop_server(self):
        if self.server_thread and self.server_thread.is_alive():
            self._append_log('正在停止服务器...')
            self.start_btn.config(state=tk.DISABLED)
            self.server_thread.stop()
            self.root.after(200, self._wait_shutdown)

    def _wait_shutdown(self):
        if self.server_thread and self.server_thread.is_alive():
            self.root.after(200, self._wait_shutdown)
        else:
            self._handle_server_exit()
            self.start_btn.config(state=tk.NORMAL)

    def _toggle_server(self):
        if self.running:
            self._stop_server()
        else:
            self._start_server()

    def _check_still_running(self):
        if self.destroyed:
            return
        if not self.server_thread or not self.server_thread.is_alive():
            if self.running:
                self._handle_server_exit()
        else:
            self.root.after(2000, self._check_still_running)

    def _handle_server_exit(self):
        if self.server:
            try:
                self.server.server_close()
            except Exception:
                pass
            self.server = None
        self.log_redirector.__exit__(None, None, None)
        self.running = False
        self._set_status(False)
        self._append_log('服务器已停止')

    def _set_status(self, running):
        green = '#4ade80'
        red = '#f87171'
        if running:
            self.status_canvas.itemconfig(self._status_dot, fill=green)
            self.status_label.config(text='运行中', fg=green)
            self.start_btn.config(text=f'{SYMBOL_STOP} 停止服务器',
                                  bg='#ef4444', activebackground='#dc2626')
        else:
            self.status_canvas.itemconfig(self._status_dot, fill=red)
            self.status_label.config(text='未启动', fg=red)
            self.start_btn.config(text=f'{SYMBOL_STOP} 启动服务器',
                                  bg='#22c55e', activebackground='#16a34a')

    # ===== 日志 =====

    def _append_log(self, text):
        self.log_queue.put(text)

    def _poll_log_queue(self):
        if self.destroyed:
            return
        try:
            while True:
                text = self.log_queue.get_nowait()
                self._write_log(text)
        except queue.Empty:
            pass
        if not self.destroyed:
            self.root.after(250, self._poll_log_queue)

    def _write_log(self, text):
        timestamp = time.strftime('%H:%M:%S')
        self.log_text.config(state=tk.NORMAL)
        tag = self._log_tag(text)
        self.log_text.insert(tk.END, '[' + timestamp + '] ', 'info')
        for line in text.split('\n'):
            stripped = line.strip()
            if stripped:
                stripped = re.sub(r'^\s*\[\d{2}/\w{3}/\d{4}\s\d{2}:\d{2}:\d{2}\]\s*', '', stripped)
                self.log_text.insert(tk.END, stripped + '\n', tag)
        self.log_text.see(tk.END)
        self.log_text.config(state=tk.DISABLED)

    @staticmethod
    def _log_tag(text):
        err_kw = ('错误', '失败', '拒绝', '已被占用')
        if any(k in text for k in err_kw):
            return 'error'
        warn_kw = ('请先', '未找到', '未匹配', '不存在', '无读写', 'AI 未解析')
        if any(k in text for k in warn_kw):
            return 'warning'
        succ_kw = ('成功', '完成', '已复制', '已添加', '已保存', '已清除')
        if any(k in text for k in succ_kw):
            return 'success'
        high_kw = ('服务器启动成功', '数据库位置', '下载了')
        if any(k in text for k in high_kw):
            return 'highlight'
        return 'info'

    # ===== 窗口 & 托盘 =====

    def _on_close(self):
        self._minimize_to_tray()

    def _minimize_to_tray(self):
        self.root.withdraw()

    def _restore_window(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def _start_tray(self):
        self._append_log('正在启动系统托盘...')

        if not os.path.exists(ICON_TRAY):
            self._append_log('系统托盘启动失败: icon.ico 不存在')
            return

        try:
            from PIL import Image
            import pystray

            image = Image.open(ICON_TRAY)

            def _build_menu():
                return pystray.Menu(
                    pystray.MenuItem(
                        '显示主窗口',
                        self._restore_window, default=True
                    ),
                    pystray.MenuItem(
                        '停止服务器' if self.running else '启动服务器',
                        self._tray_toggle_server
                    ),
                    pystray.MenuItem(
                        '开机自启动' if self._auto_start_var.get()
                        else '开机自启动',
                        self._tray_toggle_autostart,
                        checked=lambda item: self._auto_start_var.get()
                    ),
                    pystray.Menu.SEPARATOR,
                    pystray.MenuItem('退出', self._quit_app),
                )

            self.tray_icon = pystray.Icon('PapaCheck', image, 'PapaCheck 服务器', _build_menu())
            self._append_log('托盘图标已创建，正在启动...')

            def _run_tray():
                self.tray_icon.run()

            self.tray_thread = threading.Thread(target=_run_tray, daemon=True)
            self.tray_thread.start()
            self._append_log('系统托盘已启动')
        except ImportError as e:
            self._append_log('系统托盘模块导入失败: ' + str(e))
        except Exception as e:
            self._append_log('系统托盘启动失败: ' + str(e))

    def _update_tray_menu(self):
        if self.tray_icon:
            try:
                self.tray_icon.update_menu()
            except Exception:
                pass

    def _tray_toggle_server(self):
        self.root.after(0, self._toggle_server)
        self.root.after(200, self._update_tray_menu)

    def _tray_toggle_autostart(self):
        current = self._auto_start_var.get()
        self._auto_start_var.set(not current)
        self._set_autostart(not current)
        self.root.after(200, self._update_tray_menu)

    def _quit_app(self):
        self.destroyed = True
        self.running = False
        if self.server_thread and self.server_thread.is_alive():
            self._append_log('正在停止服务器...')
            self.server_thread.stop()
            self._quit_wait_count = 0
            self.root.after(200, self._wait_quit)
        else:
            self._do_destroy()

    def _wait_quit(self):
        self._quit_wait_count += 1
        if self.server_thread and self.server_thread.is_alive():
            if self._quit_wait_count < 25:
                self.root.after(200, self._wait_quit)
            else:
                self._append_log('服务器停止超时，强制退出')
                self._do_destroy()
        else:
            self._append_log('服务器已安全停止')
            self._do_destroy()

    def _do_destroy(self):
        if self._instance_sock:
            try:
                self._instance_sock.close()
            except Exception:
                pass
        if self.tray_icon:
            try:
                self.tray_icon.stop()
            except Exception:
                pass
        self.root.after(100, self.root.destroy)

    # ===== 服务配置窗口 & 邮件作业同步 =====

    def _show_settings(self):
        cfg = _ensure_config()

        win = tk.Toplevel(self.root)
        win.title('服务配置')
        win.configure(bg='#0f172a')
        win.transient(self.root)
        win.withdraw()

        fg = '#e2e8f0'
        label_bg = '#0f172a'
        entry_bg = '#1e293b'
        entry_fg = '#e2e8f0'

        row = 0

        # --- 分隔: 服务器设置 ---
        tk.Label(win, text='── 服务器设置 ──', font=('Microsoft YaHei UI', 9),
                 bg=label_bg, fg='#64748b').grid(row=row, column=0, columnspan=3,
                                                  sticky='w', padx=16, pady=(12, 4))
        row += 1

        # 服务器地址
        tk.Label(win, text='服务器地址', font=('Microsoft YaHei UI', 10),
                 bg=label_bg, fg='#94a3b8').grid(row=row, column=0, sticky='w', padx=16, pady=4)
        _server_url_var = tk.StringVar(value=cfg.get('server_url', 'http://localhost:8080'))
        server_ent = tk.Entry(win, textvariable=_server_url_var, font=('Consolas', 10),
                               bg=entry_bg, fg=entry_fg, bd=0,
                               highlightthickness=0, state='disabled',
                               disabledforeground=entry_fg, disabledbackground=entry_bg,
                               width=36)
        server_ent.grid(row=row, column=1, padx=(0, 10), pady=4, sticky='w')
        row += 1

        _email_ai_widgets = []

        def _toggle_email_ai_sections():
            if _use_ai_email_var.get():
                for w in _email_ai_widgets:
                    w.grid()
            else:
                for w in _email_ai_widgets:
                    w.grid_remove()
            win.resizable(True, True)
            win.geometry('')
            win.update_idletasks()
            w = max(520, win.winfo_reqwidth())
            h = win.winfo_reqheight()
            rwx = self.root.winfo_x()
            rwy = self.root.winfo_y()
            rww = self.root.winfo_width()
            rwh = self.root.winfo_height()
            x = rwx + (rww - w) // 2
            y = rwy + (rwh - h) // 2
            win.geometry(f'{w}x{h}+{x}+{y}')
            win.resizable(False, False)

        _use_ai_email_var = tk.BooleanVar(value=cfg.get('use_ai_email', False))
        tk.Checkbutton(win, text='使用AI 解析邮件，自动发布作业到孩子端',
                       variable=_use_ai_email_var,
                       font=('Microsoft YaHei UI', 9),
                       bg=label_bg, fg='#fbbf24',
                       selectcolor=label_bg,
                       activebackground=label_bg, activeforeground='#fbbf24',
                       command=_toggle_email_ai_sections).grid(
                           row=row, column=1, sticky='w', padx=(0, 10), pady=2)
        row += 1

        _auto_start_server_var = tk.BooleanVar(value=cfg.get('auto_start_server', True))
        tk.Checkbutton(win, text='程序启动时，自动启动服务器', variable=_auto_start_server_var,
                       font=('Microsoft YaHei UI', 9),
                       bg=label_bg, fg='#94a3b8',
                       selectcolor=label_bg,
                       activebackground=label_bg, activeforeground=fg).grid(
                           row=row, column=1, sticky='w', padx=(0, 10), pady=2)
        row += 1

        show_hint_var = tk.BooleanVar(value=cfg.get('show_apk_hint', True))
        tk.Checkbutton(win, text='显示 APK 下载提示', variable=show_hint_var,
                       font=('Microsoft YaHei UI', 9),
                       bg=label_bg, fg='#94a3b8',
                       selectcolor=label_bg,
                       activebackground=label_bg, activeforeground=fg).grid(
                           row=row, column=1, sticky='w', padx=(0, 10), pady=2)
        row += 1

        _show_polling_log_var = tk.BooleanVar(value=cfg.get('show_polling_log', False))
        tk.Checkbutton(win, text='显示轮询日志', variable=_show_polling_log_var,
                       font=('Microsoft YaHei UI', 9),
                       bg=label_bg, fg='#94a3b8',
                       selectcolor=label_bg,
                       activebackground=label_bg, activeforeground=fg).grid(
                           row=row, column=1, sticky='w', padx=(0, 10), pady=2)
        row += 1

        def _import_database(win):
            if self.running:
                tkmsg.showwarning('提示',
                    '服务器正在运行，请先停止服务器再导入数据库。',
                    parent=win)
                return
            path = filedialog.askopenfilename(
                parent=win, title='选择数据库文件',
                filetypes=[('SQLite 数据库', '*.db'), ('所有文件', '*.*')])
            if not path:
                return
            target = os.path.join(_DB_DIR, 'data.db')
            backup = os.path.join(_DB_DIR, 'data.db.backup_' +
                                  datetime.now().strftime('%Y%m%d_%H%M%S'))
            try:
                if os.path.exists(target):
                    shutil.copy2(target, backup)
                shutil.copy2(path, target)
                tkmsg.showinfo('成功',
                    '数据库已导入！\n原数据库已备份为:\n' + backup +
                    '\n\n请重新启动服务器以加载新数据库。', parent=win)
            except Exception as e:
                tkmsg.showerror('导入失败', str(e), parent=win)

        tk.Button(win, text='导入数据库', font=('Microsoft YaHei UI', 9),
                  bg='#334155', fg='#fbbf24',
                  activebackground='#475569', activeforeground='white',
                  relief=tk.FLAT, bd=0, padx=12, pady=4, cursor='hand2',
                  command=lambda: _import_database(win)).grid(
                      row=row, column=1, sticky='w', padx=(0, 10), pady=2)
        row += 2

        # --- 分隔: 邮箱配置 ---
        email_section_label = tk.Label(win, text='── 邮箱配置 ──', font=('Microsoft YaHei UI', 9),
                 bg=label_bg, fg='#64748b')
        email_section_label.grid(row=row, column=0, columnspan=3,
                                  sticky='w', padx=16, pady=(4, 4))
        _email_ai_widgets.append(email_section_label)
        row += 1

        labels_and_keys = [
            ('邮箱地址', 'email'),
            ('密码/授权码', None),
            ('IMAP 服务器', 'imap_server'),
            ('端口', 'port'),
            ('指定发件人', 'sender'),
        ]
        entries = {}
        for text, key in labels_and_keys:
            lbl = tk.Label(win, text=text, font=('Microsoft YaHei UI', 10),
                     bg=label_bg, fg=fg)
            lbl.grid(row=row, column=0, sticky='w', padx=16, pady=2)
            _email_ai_widgets.append(lbl)
            if text == '密码/授权码':
                try:
                    default_pw = _credential_read('PapaCheck/email_password') or ''
                except Exception:
                    default_pw = ''
                var = tk.StringVar(value=default_pw)
                ent = tk.Entry(win, textvariable=var, font=('Consolas', 10),
                               bg=entry_bg, fg=entry_fg, bd=0,
                               highlightthickness=0, insertbackground=entry_fg,
                               show='*', width=36)
                ent.grid(row=row, column=1, padx=(0, 10), pady=2, sticky='w')
                _email_ai_widgets.append(ent)
                entries['password'] = var
            elif key == 'port':
                var = tk.StringVar(value=str(cfg.get(key, 993)))
                ent = tk.Entry(win, textvariable=var, font=('Consolas', 10),
                               bg=entry_bg, fg=entry_fg, bd=0,
                               highlightthickness=0, insertbackground=entry_fg,
                               width=36)
                ent.grid(row=row, column=1, padx=(0, 10), pady=2, sticky='w')
                _email_ai_widgets.append(ent)
                entries[key] = var
            else:
                var = tk.StringVar(value=cfg.get(key, ''))
                ent = tk.Entry(win, textvariable=var, font=('Consolas', 10),
                               bg=entry_bg, fg=entry_fg, bd=0,
                               highlightthickness=0, insertbackground=entry_fg,
                               width=36)
                ent.grid(row=row, column=1, padx=(0, 10), pady=2, sticky='w')
                _email_ai_widgets.append(ent)
                entries[key] = var
            row += 1

        win._entries = entries

        email_test_row = tk.Frame(win, bg=label_bg)
        email_test_row.grid(row=row, column=1, sticky='w', padx=(0, 10), pady=2)

        email_test_btn = tk.Button(email_test_row, text='测试连通性', font=('Microsoft YaHei UI', 9),
                  bg='#334155', fg='#94a3b8',
                  activebackground='#475569', activeforeground='white',
                  relief=tk.FLAT, bd=0, padx=12, pady=4, cursor='hand2',
                  command=lambda: self._test_email_connectivity(win))
        email_test_btn.pack(side=tk.LEFT)

        mark_read_var = tk.BooleanVar(value=cfg.get('mark_as_read', True))
        mark_read_cb = tk.Checkbutton(email_test_row, text='读取后标记为已读', variable=mark_read_var,
                       font=('Microsoft YaHei UI', 9),
                       bg=label_bg, fg='#94a3b8',
                       selectcolor=label_bg,
                       activebackground=label_bg, activeforeground=fg)
        mark_read_cb.pack(side=tk.LEFT, padx=(8, 0))

        _email_ai_widgets.append(email_test_row)
        row += 1

        default_dir = _get_attachment_dir(cfg)
        attach_lbl = tk.Label(win, text='附件下载目录', font=('Microsoft YaHei UI', 10),
                 bg=label_bg, fg=fg)
        attach_lbl.grid(row=row, column=0, sticky='w', padx=16, pady=4)
        _email_ai_widgets.append(attach_lbl)
        _attach_dir_var = tk.StringVar(value=cfg.get('email_attachment_dir', '') or _get_default_attachment_dir())
        attach_ent = tk.Entry(win, textvariable=_attach_dir_var, font=('Consolas', 10),
                               bg=entry_bg, fg=entry_fg, bd=0,
                               highlightthickness=0, insertbackground=entry_fg,
                               width=36)
        attach_ent.grid(row=row, column=1, padx=(0, 10), pady=4, sticky='w')
        _email_ai_widgets.append(attach_ent)

        def _browse_attach_dir():
            path = filedialog.askdirectory(
                parent=win, title='选择附件下载目录',
                initialdir=_attach_dir_var.get() or default_dir)
            if path:
                _attach_dir_var.set(path)

        browse_btn = tk.Button(win, text='选择文件夹', font=('Microsoft YaHei UI', 9),
                  bg='#334155', fg='#94a3b8',
                  activebackground='#475569', activeforeground='white',
                  relief=tk.FLAT, bd=0, padx=12, pady=4, cursor='hand2',
                  command=_browse_attach_dir)
        browse_btn.grid(row=row, column=2, sticky='w', padx=(0, 10), pady=2)
        _email_ai_widgets.append(browse_btn)
        row += 2

        # --- 分隔: AI 配置 ---
        ai_section_label = tk.Label(win, text='── AI 配置 ──', font=('Microsoft YaHei UI', 9),
                 bg=label_bg, fg='#64748b')
        ai_section_label.grid(row=row, column=0, columnspan=3,
                                  sticky='w', padx=16, pady=(4, 4))
        _email_ai_widgets.append(ai_section_label)
        row += 1

        ai_labels = [
            ('API Key', None),
            ('Base URL', 'ai_base_url'),
            ('模型', 'ai_model'),
        ]
        for text, key in ai_labels:
            lbl = tk.Label(win, text=text, font=('Microsoft YaHei UI', 10),
                     bg=label_bg, fg=fg)
            lbl.grid(row=row, column=0, sticky='w', padx=16, pady=2)
            _email_ai_widgets.append(lbl)
            if text == 'API Key':
                try:
                    default_key = _credential_read('PapaCheck/ai_api_key') or ''
                except Exception:
                    default_key = ''
                var = tk.StringVar(value=default_key)
                ent = tk.Entry(win, textvariable=var, font=('Consolas', 10),
                               bg=entry_bg, fg=entry_fg, bd=0,
                               highlightthickness=0, insertbackground=entry_fg,
                               show='*', width=36)
                ent.grid(row=row, column=1, padx=(0, 10), pady=2, sticky='w')
                _email_ai_widgets.append(ent)
                entries['ai_api_key'] = var
            else:
                var = tk.StringVar(value=cfg.get(key, ''))
                ent = tk.Entry(win, textvariable=var, font=('Consolas', 10),
                               bg=entry_bg, fg=entry_fg, bd=0,
                               highlightthickness=0, insertbackground=entry_fg,
                               width=36)
                ent.grid(row=row, column=1, padx=(0, 10), pady=2, sticky='w')
                _email_ai_widgets.append(ent)
                entries[key] = var
            row += 1

        ai_test_btn = tk.Button(win, text='测试连通性', font=('Microsoft YaHei UI', 9),
                  bg='#334155', fg='#94a3b8',
                  activebackground='#475569', activeforeground='white',
                  relief=tk.FLAT, bd=0, padx=12, pady=4, cursor='hand2',
                  command=lambda: self._test_ai_connectivity(win))
        ai_test_btn.grid(row=row, column=1, sticky='w', padx=(0, 10), pady=2)
        _email_ai_widgets.append(ai_test_btn)
        row += 2

        if not _use_ai_email_var.get():
            for w in _email_ai_widgets:
                w.grid_remove()

        # --- 底部按钮 ---
        btn_frame = tk.Frame(win, bg='#0f172a')
        btn_frame.grid(row=row, column=0, columnspan=3, pady=(8, 16), padx=16, sticky='e')

        def _snapshot_cfg():
            return {
                'email': entries.get('email', tk.StringVar()).get().strip(),
                'imap_server': entries.get('imap_server', tk.StringVar()).get().strip(),
                'port': entries.get('port', tk.StringVar()).get().strip(),
                'sender': entries.get('sender', tk.StringVar()).get().strip(),
                'password': entries.get('password', tk.StringVar()).get().strip(),
                'ai_api_key': entries.get('ai_api_key', tk.StringVar()).get().strip(),
                'ai_base_url': entries.get('ai_base_url', tk.StringVar()).get().strip(),
                'ai_model': entries.get('ai_model', tk.StringVar()).get().strip(),
                'server_url': _server_url_var.get().strip(),
                'mark_as_read': mark_read_var.get(),
                'show_apk_hint': show_hint_var.get(),
                'email_attachment_dir': _attach_dir_var.get().strip(),
                'use_ai_email': _use_ai_email_var.get(),
                'auto_start_server': _auto_start_server_var.get(),
            }

        _original_cfg = _snapshot_cfg()

        def _has_changes():
            curr = _snapshot_cfg()
            return curr != _original_cfg

        def _confirm_close():
            if _has_changes():
                resp = tkmsg.askyesnocancel('配置未保存',
                    '配置已修改，是否保存？',
                    parent=win)
                if resp is None:
                    return
                if resp:
                    _save()
                else:
                    win.destroy()
            else:
                win.destroy()

        def _save():
            new_cfg = {}
            for key in ('email', 'imap_server', 'sender', 'ai_base_url', 'ai_model'):
                if key in entries:
                    new_cfg[key] = entries[key].get().strip()
            try:
                new_cfg['port'] = int(entries['port'].get().strip())
            except ValueError:
                new_cfg['port'] = 993
            new_cfg['server_url'] = _server_url_var.get().strip()
            new_cfg['mark_as_read'] = mark_read_var.get()
            new_cfg['show_apk_hint'] = show_hint_var.get()
            new_cfg['email_attachment_dir'] = _attach_dir_var.get().strip()
            new_cfg['show_polling_log'] = _show_polling_log_var.get()
            new_cfg['use_ai_email'] = _use_ai_email_var.get()
            new_cfg['auto_start_server'] = _auto_start_server_var.get()

            required = {'email', 'imap_server', 'sender'}
            use_ai = _use_ai_email_var.get()
            if use_ai:
                for k in required:
                    if not new_cfg.get(k):
                        tkmsg.showwarning('提示', f'请填写 {k}', parent=win)
                        return

            _save_config(new_cfg)

            try:
                url = _server_url_var.get().strip().rstrip('/') + '/api/settings'
                payload = json.dumps({'settings': {'show_polling_log': _show_polling_log_var.get()}}).encode()
                req = urllib.request.Request(url, data=payload, method='POST')
                req.add_header('Content-Type', 'application/json')
                urllib.request.urlopen(req, timeout=5)
            except Exception:
                pass

            pw = entries['password'].get().strip()
            if pw:
                _credential_write('PapaCheck/email_password', pw)
            else:
                try:
                    existing_pw = _credential_read('PapaCheck/email_password')
                except Exception:
                    existing_pw = None
                if existing_pw is not None:
                    if tkmsg.askyesno('确认清除凭据',
                                      '确定要清除已保存的邮箱密码吗？\n此操作不可撤销。',
                                      parent=win):
                        _credential_delete('PapaCheck/email_password')
                        self._append_log('已清除邮箱密码凭据')

            ak = entries['ai_api_key'].get().strip()
            if ak:
                _credential_write('PapaCheck/ai_api_key', ak)
            else:
                try:
                    existing_ak = _credential_read('PapaCheck/ai_api_key')
                except Exception:
                    existing_ak = None
                if existing_ak is not None:
                    if tkmsg.askyesno('确认清除凭据',
                                      '确定要清除已保存的 AI API Key 吗？\n此操作不可撤销。',
                                      parent=win):
                        _credential_delete('PapaCheck/ai_api_key')
                        self._append_log('已清除 AI API Key 凭据')

            self._append_log('服务配置已保存')
            if show_hint_var.get() != self._apk_hint_visible:
                if show_hint_var.get():
                    self._restore_apk_hint()
                else:
                    self._dismiss_apk_hint()
            self._update_email_ai_buttons(_use_ai_email_var.get())
            win.destroy()

        tk.Button(btn_frame, text='保存', font=('Microsoft YaHei UI', 9),
                  bg='#22c55e', fg='white',
                  activebackground='#16a34a', activeforeground='white',
                  relief=tk.FLAT, bd=0, padx=20, pady=6, cursor='hand2',
                  command=_save).pack(side=tk.RIGHT, padx=(8, 0))
        tk.Button(btn_frame, text='取消', font=('Microsoft YaHei UI', 9),
                  bg='#334155', fg='#e2e8f0',
                  activebackground='#475569', activeforeground='white',
                  relief=tk.FLAT, bd=0, padx=20, pady=6, cursor='hand2',
                  command=_confirm_close).pack(side=tk.RIGHT)

        win.protocol('WM_DELETE_WINDOW', _confirm_close)

        win.update_idletasks()
        width = max(520, win.winfo_reqwidth())
        height = max(460, win.winfo_reqheight())
        root_x = self.root.winfo_x()
        root_y = self.root.winfo_y()
        root_w = self.root.winfo_width()
        root_h = self.root.winfo_height()
        x = root_x + (root_w - width) // 2
        y = root_y + (root_h - height) // 2
        win.geometry(f'{width}x{height}+{x}+{y}')
        win.resizable(False, False)
        win.deiconify()
        win.grab_set()

    def _update_email_ai_buttons(self, visible):
        if visible:
            if not self._email_sync_btn.winfo_ismapped():
                self._email_sync_btn.pack(side=tk.LEFT, padx=(8, 0))
            if not self._open_attach_btn.winfo_ismapped():
                self._open_attach_btn.pack(side=tk.LEFT, padx=(8, 0))
        else:
            if self._email_sync_btn.winfo_ismapped():
                self._email_sync_btn.pack_forget()
            if self._open_attach_btn.winfo_ismapped():
                self._open_attach_btn.pack_forget()

    def _test_email_connectivity(self, parent):
        entries = getattr(parent, '_entries', {})
        imap = entries.get('imap_server', tk.StringVar()).get().strip()
        port_str = entries.get('port', tk.StringVar()).get().strip()
        if not imap:
            tkmsg.showwarning('提示', '请先填写 IMAP 服务器', parent=parent)
            return
        try:
            port = int(port_str) if port_str else 993
        except ValueError:
            port = 993
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            sock.connect((imap, port))
            sock.close()
            tkmsg.showinfo('成功', '✅ 邮箱服务连接成功', parent=parent)
        except Exception as e:
            tkmsg.showerror('失败', f'连接失败: {e}', parent=parent)

    def _test_ai_connectivity(self, parent):
        entries = getattr(parent, '_entries', {})
        cfg = _load_config()
        ak = entries.get('ai_api_key', tk.StringVar()).get().strip()
        url = entries.get('ai_base_url', tk.StringVar()).get().strip()
        model = entries.get('ai_model', tk.StringVar()).get().strip()
        if not ak:
            tkmsg.showwarning('提示', '请填写 API Key', parent=parent)
            return
        if not url:
            url = cfg.get('ai_base_url', 'https://api.deepseek.com') if cfg else 'https://api.deepseek.com'
        if not model:
            model = cfg.get('ai_model', 'deepseek-chat') if cfg else 'deepseek-chat'

        test_text = 'hello'
        try:
            email_client.call_ai(ak, url, model, test_text)
            tkmsg.showinfo('成功', '✅ AI 服务连接正常', parent=parent)
        except Exception as e:
            tkmsg.showerror('失败', f'连接失败: {e}', parent=parent)

    def _open_attach_dir(self):
        cfg = _load_config()
        path = _get_attachment_dir(cfg or {})
        os.makedirs(path, exist_ok=True)
        os.startfile(path)

    def _on_email_sync(self):
        cfg = _load_config()
        if not cfg:
            tkmsg.showinfo('提示', '请先配置服务')
            self.root.after(100, self._show_settings)
            return

        required = ('email', 'imap_server', 'sender', 'ai_base_url', 'ai_model')
        for k in required:
            if not cfg.get(k):
                tkmsg.showinfo('提示', f'请完善服务配置（缺少 {k}）')
                self.root.after(100, self._show_settings)
                return

        try:
            pw = _credential_read('PapaCheck/email_password')
        except Exception:
            pw = None
        if pw is None:
            tkmsg.showinfo('提示', '请先配置邮箱密码/授权码')
            self.root.after(100, self._show_settings)
            return

        try:
            ak = _credential_read('PapaCheck/ai_api_key')
        except Exception:
            ak = None
        if ak is None:
            tkmsg.showinfo('提示', '请先配置 AI API Key')
            self.root.after(100, self._show_settings)
            return

        self._email_sync_btn.config(state=tk.DISABLED, text='⏳ 同步中...')
        self._append_log('开始邮件作业同步...')
        threading.Thread(target=self._run_email_sync,
                         args=(cfg, pw, ak), daemon=True).start()

    def _run_email_sync(self, cfg, pw, ak):
        matched_ids = None
        try:
            self.root.after(0, lambda: self._append_log('正在连接邮箱...'))
            messages, matched_ids = email_client.fetch_emails_from_sender(
                cfg['imap_server'], cfg['port'],
                cfg['email'], pw,
                cfg['sender'],
                search_all=False, mark_as_read=cfg.get('mark_as_read', True),
                attachment_dir=_get_attachment_dir(cfg),
            )
            if not messages:
                self.root.after(0, lambda: self._append_log('未找到匹配的邮件，同步结束'))
                return

            self.root.after(0, lambda: self._append_log(f'共收取 {len(messages)} 封邮件'))

            attach_count = sum(len(m.get('attachments', [])) for m in messages)
            if attach_count:
                attach_dir = _get_attachment_dir(cfg)
                self.root.after(0, lambda c=attach_count, d=attach_dir: self._append_log(f'下载了 {c} 个附件到 {d}'))
                self.root.after(100, lambda: self._open_attach_dir())

            email_text = '\n'.join(m.get('body', '') for m in messages)

            self.root.after(0, lambda: self._append_log('正在调用 AI 解析...'))
            ai_output = email_client.call_ai(ak, cfg['ai_base_url'], cfg['ai_model'], email_text)

            new_items = email_client._parse_homework_text(ai_output)
            if not new_items:
                self.root.after(0, lambda: self._append_log('AI 未解析出作业项'))
                raise Exception('AI 未解析出作业项')

            today = email_client._get_today_key()
            save_homeworks_via_api(cfg['server_url'], today, new_items)

            count = len(new_items)
            self.root.after(0, lambda: self._append_log(f'已添加 {count} 项作业到今日作业清单'))
            self.root.after(0, lambda: self._append_log('邮件作业同步完成'))

        except Exception as e:
            if matched_ids and cfg.get('mark_as_read', True):
                try:
                    email_client.mark_matched_ids_as_unread(
                        cfg['imap_server'], cfg['port'],
                        cfg['email'], pw,
                        matched_ids,
                    )
                    self.root.after(0, lambda: self._append_log('已将邮件恢复为未读状态'))
                except Exception:
                    self.root.after(0, lambda: self._append_log('恢复邮件状态失败，请手动处理'))
            self.root.after(0, lambda: self._append_log(f'错误: {e}'))
        finally:
            self.root.after(0, lambda: self._email_sync_btn.config(
                state=tk.NORMAL, text='AI 发作业'))

    def run(self):
        if self._instance_sock is None:
            return
        self.root.mainloop()


if __name__ == '__main__':
    app = PapaCheckApp()
    app.run()
