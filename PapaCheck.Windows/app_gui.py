# -*- coding: utf-8 -*-
import sys
import os
import re
import shutil
import socket
import threading
import time
import webbrowser
import queue
import tkinter as tk

_CUR_DIR = os.path.dirname(os.path.abspath(__file__))

if getattr(sys, 'frozen', False):
    _SERVER_DIR = os.path.join(sys._MEIPASS, 'PapaCheck.Server')
    _EXE_DIR = os.path.dirname(sys.executable)

    _neighbor_db = os.path.normpath(os.path.join(
        _EXE_DIR, '..', '..', 'PapaCheck.Server', 'data.db'))
    if os.path.exists(_neighbor_db):
        _DB_DIR = os.path.dirname(_neighbor_db)
    else:
        _DB_DIR = _EXE_DIR
        _bundled_db = os.path.join(_SERVER_DIR, 'data.db')
        _target_db = os.path.join(_EXE_DIR, 'data.db')
        if os.path.exists(_bundled_db) and not os.path.exists(_target_db):
            try:
                shutil.copy2(_bundled_db, _target_db)
            except Exception:
                pass

    ICON_TRAY = os.path.join(sys._MEIPASS, 'icon.ico')
    ICON_TBAR = os.path.join(sys._MEIPASS, 'icon.ico')
else:
    _SERVER_DIR = os.path.normpath(os.path.join(_CUR_DIR, '..', 'PapaCheck.Server'))
    _DB_DIR = _SERVER_DIR
    ICON_TRAY = os.path.join(_CUR_DIR, 'icon.ico')
    ICON_TBAR = os.path.join(_CUR_DIR, 'icon.ico')

if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

os.environ['PAPACHECK_DB_DIR'] = _DB_DIR

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
        self.root.geometry(f'620x560+{(sw - 620) // 2}+{(sh - 560) // 2}')
        self.root.deiconify()

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
        except Exception:
            pass

        self._build_ui()

        self.root.protocol('WM_DELETE_WINDOW', self._on_close)
        self.root.after(100, self._start_server)
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

        # --- 分隔线标题：服务器日志 ---
        sep_title = tk.Frame(self.root, bg=bg)
        sep_title.pack(fill=tk.X, padx=20, pady=(4, 2))
        tk.Label(sep_title, text='── 服务器日志 ──',
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

        # --- 按钮行：打开孩子端/管理端（左）+ 开机自启动/启动服务器（右） ---
        btn_frame = tk.Frame(self.root, bg=bg)
        btn_frame.pack(fill=tk.X, padx=20, pady=(0, 10))

        left_btns = tk.Frame(btn_frame, bg=bg)
        left_btns.pack(side=tk.LEFT)
        self._plain_btn(left_btns,
                        f'{SYMBOL_PHONE} 打开孩子端',
                        self._open_child).pack(side=tk.LEFT)
        self._plain_btn(left_btns,
                        f'{SYMBOL_CLIPBOARD} 打开管理端',
                        self._open_parent).pack(side=tk.LEFT, padx=(8, 0))

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

        self._append_log('服务器启动成功 (端口 ' + str(PORT) + ', 局域网 IP: ' + self.ip + ')')

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
        self.log_text.insert(tk.END, '[' + timestamp + '] ')
        for line in text.split('\n'):
            stripped = line.strip()
            if stripped:
                stripped = re.sub(r'^\s*\[\d{2}/\w{3}/\d{4}\s\d{2}:\d{2}:\d{2}\]\s*', '', stripped)
                self.log_text.insert(tk.END, stripped + '\n')
        self.log_text.see(tk.END)
        self.log_text.config(state=tk.DISABLED)

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
            self.server_thread.stop()
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

    def run(self):
        if self._instance_sock is None:
            return
        self.root.mainloop()


if __name__ == '__main__':
    app = PapaCheckApp()
    app.run()
