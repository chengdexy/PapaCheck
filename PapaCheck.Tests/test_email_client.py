import sys
import os

import pytest
pytest.skip("已迁移到 Node.js，旧测试已过时", allow_module_level=True)

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
    # Feature: 邮件头部字符串解码
    #   Scenario: 输入为 None 时返回空字符串
    #     Given decode_str 函数可用
    #     When 传入 None 作为输入
    #     Then 返回空字符串 ''
    def test_decode_str_returns_empty_for_none_input(self):
        ec = _import_email_client()
        assert ec.decode_str(None) == ''

    # Feature: 邮件头部字符串解码
    #   Scenario: 输入为普通字符串时原样返回
    #     Given decode_str 函数可用
    #     When 传入普通字符串 'Hello World'
    #     Then 返回与输入相同的字符串
    def test_decode_str_returns_plain_string_unchanged(self):
        ec = _import_email_client()
        assert ec.decode_str('Hello World') == 'Hello World'


class TestFormatAddr:
    # Feature: 邮件地址格式化
    #   Scenario: 输入为空字符串时返回空字符串
    #     Given format_addr 函数可用
    #     When 传入空字符串
    #     Then 返回空字符串 ''
    def test_format_addr_returns_empty_for_empty_input(self):
        ec = _import_email_client()
        assert ec.format_addr('') == ''

    # Feature: 邮件地址格式化
    #   Scenario: 输入邮箱地址时结果包含原始地址
    #     Given format_addr 函数可用
    #     When 传入 'test@example.com'
    #     Then 返回结果中包含 'test@example.com'
    def test_format_addr_includes_email_address(self):
        ec = _import_email_client()
        result = ec.format_addr('test@example.com')
        assert 'test@example.com' in result


class TestGuessIMAPServer:
    # Feature: 根据邮箱域名推测 IMAP 服务器
    #   Scenario: QQ 邮箱返回 imap.qq.com
    #     Given guess_imap_server 函数可用
    #     When 传入 'user@qq.com'
    #     Then 返回 'imap.qq.com'
    def test_guess_imap_server_returns_qq_imap_for_qq_email(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@qq.com') == 'imap.qq.com'

    # Feature: 根据邮箱域名推测 IMAP 服务器
    #   Scenario: Gmail 邮箱返回 imap.gmail.com
    #     Given guess_imap_server 函数可用
    #     When 传入 'user@gmail.com'
    #     Then 返回 'imap.gmail.com'
    def test_guess_imap_server_returns_gmail_imap_for_gmail_email(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@gmail.com') == 'imap.gmail.com'

    # Feature: 根据邮箱域名推测 IMAP 服务器
    #   Scenario: Outlook 邮箱返回 outlook.office365.com
    #     Given guess_imap_server 函数可用
    #     When 传入 'user@outlook.com'
    #     Then 返回 'outlook.office365.com'
    def test_guess_imap_server_returns_office365_for_outlook_email(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@outlook.com') == 'outlook.office365.com'

    # Feature: 根据邮箱域名推测 IMAP 服务器
    #   Scenario: 163 邮箱返回 imap.163.com
    #     Given guess_imap_server 函数可用
    #     When 传入 'user@163.com'
    #     Then 返回 'imap.163.com'
    def test_guess_imap_server_returns_163_imap_for_163_email(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@163.com') == 'imap.163.com'

    # Feature: 根据邮箱域名推测 IMAP 服务器
    #   Scenario: 未知域名返回 None
    #     Given guess_imap_server 函数可用
    #     When 传入未知域名的邮箱 'user@unknown-example.xyz'
    #     Then 返回 None
    def test_guess_imap_server_returns_none_for_unknown_domain(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('user@unknown-example.xyz') is None

    # Feature: 根据邮箱域名推测 IMAP 服务器
    #   Scenario: 域名大小写不敏感
    #     Given guess_imap_server 函数可用
    #     When 传入大写域名邮箱 'User@QQ.COM'
    #     Then 返回 'imap.qq.com'
    def test_guess_imap_server_ignores_email_case(self):
        ec = _import_email_client()
        assert ec.guess_imap_server('User@QQ.COM') == 'imap.qq.com'


class TestBuildEmailText:
    # Feature: 构建邮件文本摘要
    #   Scenario: 单封邮件时文本包含邮件正文
    #     Given _build_email_text 函数可用
    #     When 传入包含一封邮件的列表
    #     Then 返回文本中包含该邮件的正文内容
    def test_build_email_text_includes_body_of_single_email(self):
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

    # Feature: 构建邮件文本摘要
    #   Scenario: 多封邮件时文本包含编号和正文
    #     Given _build_email_text 函数可用
    #     When 传入包含两封邮件的列表
    #     Then 返回文本中包含 '邮件 1/2' 和 '邮件 2/2' 编号及各邮件正文
    def test_build_email_text_numbers_multiple_emails(self):
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
    # Feature: 从文本解析作业条目
    #   Scenario: 编号列表格式的文本可提取科目
    #     Given _parse_homework_text 函数可用
    #     When 传入 '1. 数学: 练习册第15页\n2. 英语: 朗读Unit5单词'
    #     Then 返回两个条目，科目分别为 '数学' 和 '英语'
    def test_parse_homework_text_extracts_subjects_from_numbered_list(self):
        ec = _import_email_client()
        text = '1. 数学: 练习册第15页\n2. 英语: 朗读Unit5单词'
        items = ec._parse_homework_text(text)
        assert len(items) == 2
        assert items[0]['subject'] == '数学'
        assert items[1]['subject'] == '英语'

    # Feature: 从文本解析作业条目
    #   Scenario: 空字符串返回空列表
    #     Given _parse_homework_text 函数可用
    #     When 传入空字符串
    #     Then 返回空列表
    def test_parse_homework_text_returns_empty_for_empty_string(self):
        ec = _import_email_client()
        items = ec._parse_homework_text('')
        assert items == []

    # Feature: 从文本解析作业条目
    #   Scenario: 非作业文本返回空列表
    #     Given _parse_homework_text 函数可用
    #     When 传入不含作业格式的文本 '今天天气不错'
    #     Then 返回空列表
    def test_parse_homework_text_returns_empty_for_non_homework_text(self):
        ec = _import_email_client()
        items = ec._parse_homework_text('今天天气不错')
        assert items == []

    # Feature: 从文本解析作业条目
    #   Scenario: 解析结果去除首尾空白
    #     Given _parse_homework_text 函数可用
    #     When 传入含多余空白的编号列表文本
    #     Then 返回条目的科目字段已去除空白
    def test_parse_homework_text_trims_whitespace_from_items(self):
        ec = _import_email_client()
        text = '  1. 语文: 背诵课文  \n\n2. 科学: 观察植物  '
        items = ec._parse_homework_text(text)
        assert len(items) >= 1
        assert items[0]['subject'] == '语文'


class TestBuildHomeworkItem:
    # Feature: 构建作业条目
    #   Scenario: 设置科目和内容字段
    #     Given _build_homework_item 函数可用
    #     When 传入科目 '数学' 和内容 '练习册第10页'
    #     Then 返回条目的 subject 为 '数学'，content 为 '练习册第10页'
    def test_build_homework_item_sets_subject_and_content(self):
        ec = _import_email_client()
        item = ec._build_homework_item('数学', '练习册第10页')
        assert item['subject'] == '数学'
        assert item['content'] == '练习册第10页'

    # Feature: 构建作业条目
    #   Scenario: 标记来源为 email
    #     Given _build_homework_item 函数可用
    #     When 传入科目和内容构建条目
    #     Then 返回条目的 source 为 'email'
    def test_build_homework_item_marks_source_as_email(self):
        ec = _import_email_client()
        item = ec._build_homework_item('数学', '练习册第10页')
        assert item['source'] == 'email'

    # Feature: 构建作业条目
    #   Scenario: 默认状态和模式为 pending
    #     Given _build_homework_item 函数可用
    #     When 传入科目和内容构建条目
    #     Then 返回条目的 status 为 'pending'，mode 为 'pending'
    def test_build_homework_item_defaults_status_and_mode_to_pending(self):
        ec = _import_email_client()
        item = ec._build_homework_item('数学', '练习册第10页')
        assert item['status'] == 'pending'
        assert item['mode'] == 'pending'

    # Feature: 构建作业条目
    #   Scenario: 设置默认时长和积分
    #     Given _build_homework_item 函数可用
    #     When 传入科目和内容构建条目
    #     Then 返回条目的 suggestedDuration 为 20，basePoints 为 10
    def test_build_homework_item_sets_default_duration_and_points(self):
        ec = _import_email_client()
        item = ec._build_homework_item('数学', '练习册第10页')
        assert item['suggestedDuration'] == 20
        assert item['basePoints'] == 10

    # Feature: 构建作业条目
    #   Scenario: 生成的条目包含 id 字段
    #     Given _build_homework_item 函数可用
    #     When 传入科目和内容构建条目
    #     Then 返回条目包含 'id' 字段
    def test_build_homework_item_contains_id_field(self):
        ec = _import_email_client()
        item = ec._build_homework_item('数学', '练习册第10页')
        assert 'id' in item

    # Feature: 构建作业条目
    #   Scenario: 多次调用生成不重复的 id
    #     Given _build_homework_item 函数可用
    #     When 连续调用 100 次构建条目
    #     Then 生成的 100 个 id 互不重复
    def test_build_homework_item_generates_unique_ids_across_calls(self):
        ec = _import_email_client()
        ids = set()
        for _ in range(100):
            item = ec._build_homework_item('科目', '内容')
            ids.add(item['id'])
        assert len(ids) == 100
