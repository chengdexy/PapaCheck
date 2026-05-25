import json
import os
import sys
import re
import getpass
import imaplib
import email
import email.policy
import socket
import urllib.request
import urllib.error
from datetime import date
from email.header import decode_header


sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'PapaCheck.Server'))
import db


IMAP_SERVERS = {
    'gmail.com': 'imap.gmail.com',
    'googlemail.com': 'imap.gmail.com',
    'outlook.com': 'outlook.office365.com',
    'hotmail.com': 'outlook.office365.com',
    'live.com': 'outlook.office365.com',
    'qq.com': 'imap.qq.com',
    'foxmail.com': 'imap.qq.com',
    '163.com': 'imap.163.com',
    '126.com': 'imap.126.com',
    'yeah.net': 'imap.yeah.net',
    'sina.com': 'imap.sina.com',
    'sina.cn': 'imap.sina.cn',
    'sohu.com': 'imap.sohu.com',
    'aliyun.com': 'imap.aliyun.com',
}

PROMPT_SYSTEM = '''你是一个作业清单解析器。下面一段分隔线之间的内容是待解析的原始文本，请从中提取作业信息，并严格按照要求输出。

## 输出格式

按科目名称排序，每行一项作业：
序号. 科目: 作业内容

示例：
1. 道德与法治: 完成第10课练习题
2. 数学: 练习册第15-20页
3. 数学: 口算一页
4. 英语: 熟读Unit 5单词
5. 语文: 背诵课文第3课

## 规则

1. 判断作业内容：只提取明确描述作业/任务的条目，过滤聊天记录、问候语、签名等无关内容。如果整段与作业无关，输出空内容。
2. 提取科目：从描述中识别科目（如语文/数学/英语/科学/道德与法治等）。同一科目有多项作业时分行列出。无法判断时用"未知"，不要臆造。
3. 排序与编号：按科目名称排序，序号从1连续编号。

## 约束

只输出作业清单，不要输出任何解释、说明或额外文字。无作业内容时输出空字符串。'''


def decode_str(s):
    if s is None:
        return ''
    parts = decode_header(s)
    result = []
    for data, charset in parts:
        if isinstance(data, bytes):
            try:
                result.append(data.decode(charset or 'utf-8', errors='replace'))
            except (LookupError, UnicodeDecodeError):
                result.append(data.decode('utf-8', errors='replace'))
        else:
            result.append(data)
    return ''.join(result)


def format_addr(addr_str):
    if not addr_str:
        return ''
    addrs = email.utils.getaddresses([addr_str])
    parts = []
    for name, addr in addrs:
        name = decode_str(name)
        if name:
            parts.append(f'{name} <{addr}>')
        else:
            parts.append(addr)
    return '; '.join(parts)


def guess_imap_server(email_addr):
    domain = email_addr.lower().split('@')[-1] if '@' in email_addr else ''
    return IMAP_SERVERS.get(domain, None)


def load_config():
    config_path = os.path.join(os.path.dirname(__file__), 'config.json')
    if not os.path.exists(config_path):
        print(f'错误: 配置文件不存在: {config_path}')
        print('请复制 config.json 模板并填写邮箱信息后重新运行')
        raise FileNotFoundError(f'config.json not found at {config_path}')

    with open(config_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)

    print('=' * 50)
    print('PapaCheck.Email - 邮件收取工具')
    print('=' * 50)

    email_addr = cfg.get('email', '').strip()
    if not email_addr or '@' not in email_addr:
        email_addr = input('邮箱地址: ').strip()
        while not email_addr or '@' not in email_addr:
            email_addr = input('请输入有效的邮箱地址: ').strip()

    password = cfg.get('password', '').strip()
    if not password:
        password = getpass.getpass('密码/授权码: ')
        while not password:
            password = getpass.getpass('密码/授权码不能为空: ')

    sender = cfg.get('sender', '').strip()
    if not sender or '@' not in sender:
        sender = input('指定发件人邮箱: ').strip()
        while not sender or '@' not in sender:
            sender = input('请输入有效的发件人邮箱地址: ').strip()

    imap_server = cfg.get('imap_server', '').strip()
    if not imap_server:
        imap_server = guess_imap_server(email_addr)
        if not imap_server:
            imap_server = input('IMAP 服务器: ').strip()
            while not imap_server:
                imap_server = input('IMAP 服务器不能为空: ').strip()

    port = cfg.get('port', 993)
    if not isinstance(port, int) or port < 1 or port > 65535:
        port = 993

    mark_as_read = cfg.get('mark_as_read', False)
    search_all = cfg.get('search_all', False)

    ai_api_key = cfg.get('ai_api_key', '').strip()
    if not ai_api_key:
        ai_api_key = getpass.getpass('AI API Key: ')
        while not ai_api_key:
            ai_api_key = getpass.getpass('AI API Key 不能为空: ')

    ai_base_url = cfg.get('ai_base_url', '').strip().rstrip('/')
    if not ai_base_url:
        ai_base_url = input('AI API Base URL: ').strip()
        while not ai_base_url:
            ai_base_url = input('AI API Base URL 不能为空: ').strip()

    ai_model = cfg.get('ai_model', '').strip()
    if not ai_model:
        ai_model = input('AI 模型: ').strip()
        while not ai_model:
            ai_model = input('AI 模型不能为空: ').strip()

    server_db_path = cfg.get('server_db_path', '').strip()
    if server_db_path:
        server_db_path = os.path.join(os.path.dirname(__file__), server_db_path)
        server_db_path = os.path.normpath(server_db_path)
    else:
        server_db_path = os.path.normpath(os.path.join(
            os.path.dirname(__file__), '..', 'PapaCheck.Server', 'data.db'
        ))

    print(f'  邮箱: {email_addr}')
    print(f'  IMAP: {imap_server}:{port}')
    print(f'  发件人: {sender}')
    print(f'  同时搜索已读邮件: {"是" if search_all else "否"}')
    print(f'  自动标记已读: {"是" if mark_as_read else "否"}')
    print(f'  AI模型: {ai_model}')
    print(f'  数据库: {server_db_path}')
    print()

    return {
        'email': email_addr,
        'password': password,
        'imap_server': imap_server,
        'port': port,
        'sender': sender,
        'search_all': search_all,
        'mark_as_read': mark_as_read,
        'ai_api_key': ai_api_key,
        'ai_base_url': ai_base_url,
        'ai_model': ai_model,
        'server_db_path': server_db_path,
    }


def _matches_sender(msg, sender):
    from_addr = msg.get('From', '')
    if not from_addr:
        return False
    return sender.lower() in from_addr.lower()


def fetch_emails_from_sender(imap_server, port, email_addr, password, sender, search_all=False, mark_as_read=False):
    print(f'\n正在连接 {imap_server}:{port} ...')

    socket.setdefaulttimeout(30)
    mail = imaplib.IMAP4_SSL(imap_server, port)

    try:
        mail.login(email_addr, password)
    except imaplib.IMAP4.error as e:
        raise Exception(f'登录失败: {e}')

    print('登录成功，正在搜索邮件...')

    mail.select('INBOX')

    if search_all:
        typ, data = mail.search(None, 'ALL')
        label = '全部邮件'
    else:
        typ, data = mail.search(None, 'UNSEEN')
        label = '未读邮件'

    if typ != 'OK':
        raise Exception('搜索邮件失败')

    all_ids = data[0].split()
    print(f'收件箱共 {len(all_ids)} 封{label}，正在逐个检查发件人...')

    matched_ids = []
    for mid in all_ids:
        typ, data = mail.fetch(mid, '(BODY.PEEK[HEADER.FIELDS (FROM)])')
        if typ == 'OK':
            raw_header = data[0][1]
            header_msg = email.message_from_bytes(raw_header)
            if _matches_sender(header_msg, sender):
                matched_ids.append(mid)

    if not matched_ids:
        print(f'\n没有找到来自 {sender} 的邮件')
        mail.logout()
        return []

    total = len(matched_ids)
    print(f'找到 {total} 封来自 {sender} 的邮件，正在获取...\n')

    messages = []
    for i, msg_id in enumerate(matched_ids, 1):
        typ, data = mail.fetch(msg_id, '(RFC822)')
        if typ == 'OK':
            raw_email = data[0][1]
            parsed = parse_email(raw_email)
            messages.append(parsed)
            print(f'[{i}/{total}] {parsed["subject"]}')

    if mark_as_read:
        for msg_id in matched_ids:
            mail.store(msg_id, '+FLAGS', '\\Seen')
        print(f'\n已将所有邮件标记为已读')

    mail.logout()
    return messages


def parse_email(raw_bytes):
    msg = email.message_from_bytes(raw_bytes, policy=email.policy.default)

    subject = decode_str(msg['Subject'])
    from_addr = format_addr(msg['From'])
    to_addr = format_addr(msg['To'])
    date = msg['Date'] or ''

    body_text = ''

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get('Content-Disposition', ''))

            if 'attachment' not in content_disposition and content_type == 'text/plain' and not body_text:
                try:
                    body_text = part.get_content().strip()
                except Exception:
                    body_text = ''
            elif 'attachment' not in content_disposition and content_type == 'text/html' and not body_text:
                try:
                    body_html = part.get_content()
                    body_text = f'[HTML 内容，共 {len(body_html)} 字符]'
                except Exception:
                    body_text = ''
    else:
        content_type = msg.get_content_type()
        if content_type == 'text/plain':
            try:
                body_text = msg.get_content().strip()
            except Exception:
                body_text = ''
        elif content_type == 'text/html':
            try:
                body_html = msg.get_content()
                body_text = f'[HTML 内容，共 {len(body_html)} 字符]'
            except Exception:
                body_text = ''

    return {
        'subject': subject or '(无主题)',
        'from': from_addr,
        'to': to_addr,
        'date': date,
        'body': body_text or '(无正文)',
    }


def print_email(info):
    sep = '=' * 50
    sub_sep = '-' * 50

    lines = [sep]
    lines.append(f'  发件人: {info["from"]}')
    lines.append(f'  收件人: {info["to"]}')
    lines.append(f'  主  题: {info["subject"]}')
    lines.append(f'  日  期: {info["date"]}')
    lines.append(sub_sep)
    lines.append(f'  正文内容:')
    for line in info['body'].splitlines():
        lines.append(f'  {line}')
    lines.append(sep)
    print('\n'.join(lines))


def _build_email_text(messages):
    lines = []
    for i, msg in enumerate(messages, 1):
        if len(messages) > 1:
            lines.append('=' * 60)
            lines.append(f'邮件 {i}/{len(messages)}')
            lines.append(f'发件人: {msg["from"]}')
            lines.append(f'主  题: {msg["subject"]}')
            lines.append(f'日  期: {msg["date"]}')
            lines.append('-' * 60)
        lines.append(msg['body'])
        lines.append('')
    return '\n'.join(lines).strip()


def call_ai(api_key, base_url, model, user_text):
    api_url = f'{base_url}/v1/chat/completions'
    payload = json.dumps({
        'model': model,
        'messages': [
            {'role': 'system', 'content': PROMPT_SYSTEM},
            {'role': 'user', 'content': user_text},
        ],
    }).encode('utf-8')

    req = urllib.request.Request(api_url, data=payload, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', f'Bearer {api_key}')

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            return result['choices'][0]['message']['content']
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise Exception(f'AI API 请求失败 (HTTP {e.code}): {body}')
    except urllib.error.URLError as e:
        raise Exception(f'AI API 连接失败: {e.reason}')
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise Exception(f'AI API 返回格式异常: {e}')


def _generate_homework_id():
    import time
    import random
    import string
    ts = int(time.time() * 1000)
    ts_str = ''
    n = ts
    chars = string.digits + string.ascii_lowercase
    while n > 0:
        ts_str = chars[n % 36] + ts_str
        n //= 36
    rand = ''.join(random.choice(chars) for _ in range(5))
    return ts_str + rand


def _build_homework_item(subject, content):
    return {
        'id': _generate_homework_id(),
        'subject': subject,
        'content': content,
        'mode': 'pending',
        'suggestedDuration': 20,
        'basePoints': 10,
        'status': 'pending',
        'startedAt': None,
        'completedAt': None,
        'actualDuration': None,
        'deferRequest': None,
        'source': 'email',
    }


def _parse_homework_text(text):
    items = []
    last_subject = None
    last_content = ''

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r'^\d+[\.\、]\s*(.+?)[:：]\s*(.+)$', line)
        if m:
            if last_subject and last_content:
                items.append(_build_homework_item(last_subject, last_content))
            last_subject = m.group(1).strip()
            last_content = m.group(2).strip()
        else:
            if last_subject:
                last_content += line

    if last_subject and last_content:
        items.append(_build_homework_item(last_subject, last_content))

    return items


def _get_today_key():
    return date.today().isoformat()


def _check_db(db_path):
    if not os.path.exists(db_path):
        print(f'数据库文件不存在: {db_path}')
        print('请确保 PapaCheck.Server 至少启动过一次')
        return False
    if not os.access(db_path, os.R_OK | os.W_OK):
        print(f'数据库文件无读写权限: {db_path}')
        return False
    return True


def main():
    try:
        config = load_config()

        if not _check_db(config['server_db_path']):
            print('\n程序退出')
            return

        messages = fetch_emails_from_sender(
            config['imap_server'],
            config['port'],
            config['email'],
            config['password'],
            config['sender'],
            config['search_all'],
            config['mark_as_read'],
        )

        if not messages:
            print('\n未获取到邮件')
            return

        print(f'\n共获取到 {len(messages)} 封邮件')

        email_text = _build_email_text(messages)
        print('\n正在调用 AI 解析作业...')

        ai_output = call_ai(
            config['ai_api_key'],
            config['ai_base_url'],
            config['ai_model'],
            email_text,
        )

        new_items = _parse_homework_text(ai_output)

        if not new_items:
            print('\nAI 未解析出任何作业，不执行写入')
            return

        print(f'\nAI 解析出 {len(new_items)} 项作业')

        today = _get_today_key()
        today_homeworks = db.get_homeworks(today) or []
        manual_homeworks = [h for h in today_homeworks if h.get('source') != 'email']
        replaced_count = len(today_homeworks) - len(manual_homeworks)
        merged = manual_homeworks + new_items
        db.save_homeworks(today, merged)

        print('\n' + '=' * 50)
        print('作业清单')
        print('=' * 50)
        for item in new_items:
            print(f'  {item["subject"]}: {item["content"]}')
        print('=' * 50)
        print(f'\n已添加 {len(new_items)} 项作业到今日作业清单')
        if replaced_count:
            print(f'已替换 {replaced_count} 项之前通过邮件添加的作业')
        print(f'今日作业总数: {len(merged)}')

        print('\n程序结束')

    except (FileNotFoundError, ValueError) as e:
        print(f'\n配置错误: {e}')
    except KeyboardInterrupt:
        print('\n\n用户取消操作')
    except Exception as e:
        print(f'\n错误: {e}')


if __name__ == '__main__':
    main()
