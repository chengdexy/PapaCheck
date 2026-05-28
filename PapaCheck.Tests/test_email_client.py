import sys
import os

import pytest


_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))


def _import_email_client():
    email_dir = os.path.join(_PROJECT_ROOT, 'PapaCheck.Email')
    if email_dir not in sys.path:
        sys.path.insert(0, email_dir)
    if 'email_client' in sys.modules:
        del sys.modules['email_client']
    import email_client as ec
    return ec


class TestDecodeStr:
    def test_decode_str_none(self):
        ec = _import_email_client()
        assert ec.decode_str(None) == ''

    def test_decode_str_plain(self):
        ec = _import_email_client()
        assert ec.decode_str('Hello World') == 'Hello World'


class TestFormatAddr:
    def test_format_addr_empty(self):
        ec = _import_email_client()
        assert ec.format_addr('') == ''

    def test_format_addr_simple(self):
        ec = _import_email_client()
        result = ec.format_addr('test@example.com')
        assert 'test@example.com' in result


class TestGuessIMAPServer:
    def test_guess_imap_server_qq(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@qq.com') == 'imap.qq.com'

    def test_guess_imap_server_gmail(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@gmail.com') == 'imap.gmail.com'

    def test_guess_imap_server_outlook(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@outlook.com') == 'outlook.office365.com'

    def test_guess_imap_server_163(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@163.com') == 'imap.163.com'

    def test_guess_imap_server_unknown(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@unknown-example.xyz') is None

    def test_guess_imap_server_case_insensitive(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('User@QQ.COM') == 'imap.qq.com'


class TestBuildEmailText:
    def test_build_email_text_single(self):
        ec = _import_email_client()
        messages = [{
            'from': 'teacher@school.com',
            'subject': '今日作业',
            'date': '2025-06-15',
            'body': '语文: 背诵课文第三课\n数学: 练习册P20-25',
        }]
        result = ec._build_email_text(messages)
        assert '语文: 背诵课文第三课' in result
        assert '数学: 练习册P20-25' in result

    def test_build_email_text_multiple(self):
        ec = _import_email_client()
        messages = [
            {'from': 'a@x.com', 'subject': 'S1', 'date': 'D1', 'body': 'B1'},
            {'from': 'b@x.com', 'subject': 'S2', 'date': 'D2', 'body': 'B2'},
        ]
        result = ec._build_email_text(messages)
        assert '邮件 1/2' in result
        assert '邮件 2/2' in result
        assert 'B1' in result
        assert 'B2' in result


class TestParseHomeworkText:
    def test_parse_homework_text_valid(self):
        ec = _import_email_client()
        text = '1. 数学: 练习册第15页\n2. 英语: 朗读Unit5单词'
        items = ec._parse_homework_text(text)
        assert len(items) == 2
        assert items[0]['subject'] == '数学'
        assert items[1]['subject'] == '英语'

    def test_parse_homework_text_empty(self):
        ec = _import_email_client()
        items = ec._parse_homework_text('')
        assert items == []

    def test_parse_homework_text_no_homework(self):
        ec = _import_email_client()
        items = ec._parse_homework_text('今天天气不错')
        assert items == []

    def test_parse_homework_text_trims_whitespace(self):
        ec = _import_email_client()
        text = '  1. 语文: 背诵课文  \n\n2. 科学: 观察植物  '
        items = ec._parse_homework_text(text)
        assert len(items) >= 1
        assert items[0]['subject'] == '语文'


class TestBuildHomeworkItem:
    def test_build_homework_item_sets_source_to_email(self):
        ec = _import_email_client()
        item = ec._build_homework_item('数学', '练习册第10页')
        assert item['subject'] == '数学'
        assert item['content'] == '练习册第10页'
        assert item['source'] == 'email'
        assert item['status'] == 'pending'
        assert item['mode'] == 'pending'
        assert 'id' in item
        assert item['suggestedDuration'] == 20
        assert item['basePoints'] == 10

    def test_build_homework_item_generates_non_duplicate_id(self):
        ec = _import_email_client()
        ids = set()
        for _ in range(100):
            item = ec._build_homework_item('科目', '内容')
            ids.add(item['id'])
        assert len(ids) == 100
