import os
import sys
import json
import tempfile
import subprocess
import argparse
import zipfile
from unittest.mock import patch

import pytest

_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, _PROJECT_ROOT)

import release


def _make_args(**kwargs):
    defaults = {
        'exe_only': False,
        'apk_only': False,
        'node_only': False,
        'bump_exe': None,
        'bump_apk': None,
        'set_exe_ver': None,
        'set_apk_ver': None,
        'no_bump_exe': False,
        'no_bump_apk': False,
        'no_zip': False,
        'cloud_only': False,
        'cloud': False,
        'output_dir': release.DEFAULT_OUTPUT_DIR,
        'v': None,
    }
    defaults.update(kwargs)
    return argparse.Namespace(**defaults)


def _step_descriptions(steps):
    return [s[0] for s in steps]


class TestBuildStepsOrder:

    # Feature: 构建步骤排序
    #   Scenario: 完整发布时 APK 构建步骤排在 EXE 打包步骤之前
    #     Given 同时指定了 EXE 和 APK 的版本递增
    #     When 生成构建步骤列表
    #     Then APK 构建步骤的顺序在 EXE 打包步骤之前
    def test_full_release_builds_apk_before_exe(self):
        args = _make_args(bump_exe='patch', bump_apk='patch')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        apk_idx = descs.index('构建 Android APK')
        exe_idx = descs.index('打包 Windows EXE')
        assert apk_idx < exe_idx, \
            f'APK 构建步骤({apk_idx})应在 EXE 打包步骤({exe_idx})之前，实际顺序: {descs}'

    # Feature: 构建步骤排序
    #   Scenario: 完整发布但不递增 APK 版本时，APK 构建步骤仍排在 EXE 打包步骤之前
    #     Given 指定了 EXE 版本递增且不递增 APK 版本
    #     When 生成构建步骤列表
    #     Then APK 构建步骤的顺序在 EXE 打包步骤之前
    def test_full_release_without_apk_bump_still_builds_apk_before_exe(self):
        args = _make_args(bump_exe='patch', no_bump_apk=True)
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        apk_idx = descs.index('构建 Android APK')
        exe_idx = descs.index('打包 Windows EXE')
        assert apk_idx < exe_idx, \
            f'APK 构建步骤({apk_idx})应在 EXE 打包步骤({exe_idx})之前，实际顺序: {descs}'

    # Feature: 构建步骤筛选
    #   Scenario: 仅打包 EXE 时不包含 APK 构建步骤
    #     Given 指定了 exe_only 模式并递增 EXE 版本
    #     When 生成构建步骤列表
    #     Then 步骤列表中不包含 APK 构建步骤，但包含 EXE 打包步骤
    def test_exe_only_release_excludes_apk_steps(self):
        args = _make_args(exe_only=True, bump_exe='patch')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '构建 Android APK' not in descs
        assert '打包 Windows EXE' in descs

    # Feature: 构建步骤筛选
    #   Scenario: 仅构建 APK 时不包含 EXE 打包步骤
    #     Given 指定了 apk_only 模式并递增 APK 版本
    #     When 生成构建步骤列表
    #     Then 步骤列表中包含 APK 构建步骤，但不包含 EXE 打包步骤
    def test_apk_only_release_excludes_exe_steps(self):
        args = _make_args(apk_only=True, bump_apk='patch')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '构建 Android APK' in descs
        assert '打包 Windows EXE' not in descs

    # Feature: 版本递增步骤
    #   Scenario: 递增 APK 版本时包含版本递增步骤
    #     Given 指定了 APK 版本递增
    #     When 生成构建步骤列表
    #     Then 步骤列表中包含 APK 版本递增步骤
    def test_apk_bump_includes_version_increment_step(self):
        args = _make_args(apk_only=True, bump_apk='patch')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 APK 版本号' in descs

    # Feature: 版本递增步骤
    #   Scenario: 不递增 APK 版本时不包含版本递增步骤但仍构建 APK
    #     Given 指定了不递增 APK 版本
    #     When 生成构建步骤列表
    #     Then 步骤列表中不包含 APK 版本递增步骤，但包含 APK 构建步骤
    def test_no_apk_bump_excludes_version_increment_step(self):
        args = _make_args(apk_only=True, no_bump_apk=True)
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 APK 版本号' not in descs
        assert '构建 Android APK' in descs

    # Feature: 版本递增步骤
    #   Scenario: 递增 EXE 版本时包含版本递增步骤
    #     Given 指定了 EXE 版本递增
    #     When 生成构建步骤列表
    #     Then 步骤列表中包含 EXE 版本递增步骤
    def test_exe_bump_includes_version_increment_step(self):
        args = _make_args(exe_only=True, bump_exe='minor')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 EXE 版本号' in descs

    # Feature: 版本递增步骤
    #   Scenario: 不递增 EXE 版本时不包含版本递增步骤但仍打包 EXE
    #     Given 指定了不递增 EXE 版本
    #     When 生成构建步骤列表
    #     Then 步骤列表中不包含 EXE 版本递增步骤，但包含 EXE 打包步骤
    def test_no_exe_bump_excludes_version_increment_step(self):
        args = _make_args(exe_only=True, no_bump_exe=True)
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 EXE 版本号' not in descs
        assert '打包 Windows EXE' in descs

    # Feature: 版本设置步骤
    #   Scenario: 指定 APK 版本号时包含版本递增步骤
    #     Given 指定了 set_apk_ver 参数
    #     When 生成构建步骤列表
    #     Then 步骤列表中包含 APK 版本递增步骤
    def test_set_apk_version_includes_version_step(self):
        args = _make_args(apk_only=True, set_apk_ver='2.0.0')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 APK 版本号' in descs


class TestReadExeVersion:

    # Feature: 读取 EXE 版本号
    #   Scenario: 从配置文件中读取 EXE 版本号
    #     Given build_config.json 中存在 exe_version 字段
    #     When 调用 read_exe_version
    #     Then 返回配置文件中的版本号
    def test_read_exe_version_returns_version_from_config(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'build_config.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump({'exe_version': '2.3.4'}, f)

            original = release.BUILD_CONFIG
            release.BUILD_CONFIG = config_path
            try:
                assert release.read_exe_version() == '2.3.4'
            finally:
                release.BUILD_CONFIG = original

    # Feature: 读取 EXE 版本号
    #   Scenario: 配置文件不存在时抛出 FileNotFoundError
    #     Given build_config.json 文件不存在
    #     When 调用 read_exe_version
    #     Then 抛出 FileNotFoundError
    def test_read_exe_version_raises_when_config_missing(self):
        original = release.BUILD_CONFIG
        release.BUILD_CONFIG = '/nonexistent/path/build_config.json'
        try:
            with pytest.raises(FileNotFoundError):
                release.read_exe_version()
        finally:
            release.BUILD_CONFIG = original

    # Feature: 读取 EXE 版本号
    #   Scenario: 配置文件中缺少 exe_version 字段时返回 0.0.0
    #     Given build_config.json 中不包含 exe_version 字段
    #     When 调用 read_exe_version
    #     Then 返回默认版本号 0.0.0
    def test_read_exe_version_returns_zero_when_field_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'build_config.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump({}, f)

            original = release.BUILD_CONFIG
            release.BUILD_CONFIG = config_path
            try:
                assert release.read_exe_version() == '0.0.0'
            finally:
                release.BUILD_CONFIG = original


class TestReadApkVersion:

    # Feature: 读取 APK 版本号
    #   Scenario: 从 pubspec.yaml 中读取 APK 版本号
    #     Given pubspec.yaml 中存在 version 字段
    #     When 调用 read_apk_version
    #     Then 返回版本号部分（不含构建号）
    def test_read_apk_version_returns_version_from_pubspec(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            pubspec_path = os.path.join(tmpdir, 'pubspec.yaml')
            with open(pubspec_path, 'w', encoding='utf-8') as f:
                f.write('version: 1.2.3+45\n')

            original = release.PUBSPEC
            release.PUBSPEC = pubspec_path
            try:
                assert release.read_apk_version() == '1.2.3'
            finally:
                release.PUBSPEC = original

    # Feature: 读取 APK 版本号
    #   Scenario: 读取版本号时去除构建号后缀
    #     Given pubspec.yaml 中 version 字段包含构建号后缀
    #     When 调用 read_apk_version
    #     Then 返回不含构建号的纯版本号
    def test_read_apk_version_strips_build_number_suffix(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            pubspec_path = os.path.join(tmpdir, 'pubspec.yaml')
            with open(pubspec_path, 'w', encoding='utf-8') as f:
                f.write('version: 3.0.0+100\n')

            original = release.PUBSPEC
            release.PUBSPEC = pubspec_path
            try:
                assert release.read_apk_version() == '3.0.0'
            finally:
                release.PUBSPEC = original

    # Feature: 读取 APK 版本号
    #   Scenario: pubspec.yaml 不存在时抛出 FileNotFoundError
    #     Given pubspec.yaml 文件不存在
    #     When 调用 read_apk_version
    #     Then 抛出 FileNotFoundError
    def test_read_apk_version_raises_when_pubspec_missing(self):
        original = release.PUBSPEC
        release.PUBSPEC = '/nonexistent/path/pubspec.yaml'
        try:
            with pytest.raises(FileNotFoundError):
                release.read_apk_version()
        finally:
            release.PUBSPEC = original

    # Feature: 读取 APK 版本号
    #   Scenario: pubspec.yaml 中缺少 version 字段时返回 0.0.0
    #     Given pubspec.yaml 中不包含 version 字段
    #     When 调用 read_apk_version
    #     Then 返回默认版本号 0.0.0
    def test_read_apk_version_returns_zero_when_version_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            pubspec_path = os.path.join(tmpdir, 'pubspec.yaml')
            with open(pubspec_path, 'w', encoding='utf-8') as f:
                f.write('name: test\n')

            original = release.PUBSPEC
            release.PUBSPEC = pubspec_path
            try:
                assert release.read_apk_version() == '0.0.0'
            finally:
                release.PUBSPEC = original


class TestArchiveApk:

    # Feature: 归档 APK 文件
    #   Scenario: 将构建产物按版本号复制到归档目录
    #     Given APK 构建产物存在于构建输出路径
    #     When 调用 archive_apk 传入版本号 '1.2.3'
    #     Then APK 被复制到归档目录，文件名格式为 PapaCheck-{version}.apk
    def test_archive_apk_copies_file_with_version(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            apk_build_dir = os.path.join(tmpdir, 'build_output')
            os.makedirs(apk_build_dir)
            fake_apk = os.path.join(apk_build_dir, 'app-release.apk')
            with open(fake_apk, 'w') as f:
                f.write('fake apk content')

            archive_dir = os.path.join(tmpdir, 'archive')

            original_build = release.APK_BUILD_OUTPUT
            original_archive = release.APK_ARCHIVE_DIR
            release.APK_BUILD_OUTPUT = fake_apk
            release.APK_ARCHIVE_DIR = archive_dir
            try:
                result = release.archive_apk('1.2.3')
                expected = os.path.join(archive_dir, 'PapaCheck-1.2.3.apk')
                assert result == expected
                assert os.path.isfile(expected)
            finally:
                release.APK_BUILD_OUTPUT = original_build
                release.APK_ARCHIVE_DIR = original_archive

    # Feature: 归档 APK 文件
    #   Scenario: 归档时自动清理除当前版本外的旧版 APK
    #     Given 归档目录中存在旧版 APK 文件 PapaCheck-1.0.0.apk
    #     When 调用 archive_apk 归档新版 APK (2.0.0)
    #     Then 新版 APK 被创建，旧版 APK 被自动删除
    def test_archive_apk_cleans_old_apks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            apk_build_dir = os.path.join(tmpdir, 'build_output')
            os.makedirs(apk_build_dir)
            fake_apk = os.path.join(apk_build_dir, 'app-release.apk')
            with open(fake_apk, 'w') as f:
                f.write('fake apk content')

            archive_dir = os.path.join(tmpdir, 'archive')
            os.makedirs(archive_dir)
            old_apk = os.path.join(archive_dir, 'PapaCheck-1.0.0.apk')
            with open(old_apk, 'w') as f:
                f.write('old apk')

            original_build = release.APK_BUILD_OUTPUT
            original_archive = release.APK_ARCHIVE_DIR
            release.APK_BUILD_OUTPUT = fake_apk
            release.APK_ARCHIVE_DIR = archive_dir
            try:
                release.archive_apk('2.0.0')
                expected_new = os.path.join(archive_dir, 'PapaCheck-2.0.0.apk')
                assert os.path.isfile(expected_new)
                assert not os.path.isfile(old_apk)
            finally:
                release.APK_BUILD_OUTPUT = original_build
                release.APK_ARCHIVE_DIR = original_archive

    # Feature: 归档 APK 文件
    #   Scenario: 归档时不删除非 APK 格式的文件
    #     Given 归档目录中存在非 APK 后缀的文件
    #     When 调用 archive_apk
    #     Then 非 APK 文件不会被删除
    def test_archive_apk_keeps_non_apk_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            apk_build_dir = os.path.join(tmpdir, 'build_output')
            os.makedirs(apk_build_dir)
            fake_apk = os.path.join(apk_build_dir, 'app-release.apk')
            with open(fake_apk, 'w') as f:
                f.write('fake apk content')

            archive_dir = os.path.join(tmpdir, 'archive')
            os.makedirs(archive_dir)
            other_file = os.path.join(archive_dir, 'readme.txt')
            with open(other_file, 'w') as f:
                f.write('not an apk')

            original_build = release.APK_BUILD_OUTPUT
            original_archive = release.APK_ARCHIVE_DIR
            release.APK_BUILD_OUTPUT = fake_apk
            release.APK_ARCHIVE_DIR = archive_dir
            try:
                release.archive_apk('3.0.0')
                assert os.path.isfile(other_file)
            finally:
                release.APK_BUILD_OUTPUT = original_build
                release.APK_ARCHIVE_DIR = original_archive


class TestCreateZips:

    # Feature: 创建 ZIP 压缩包
    #   Scenario: 同时提供 EXE 和 APK 时创建 full 和 win 两个 ZIP 文件
    #     Given 输出目录和 dist 目录中存在对应的 EXE 和 APK 文件
    #     When 调用 create_zips
    #     Then full.zip 同时包含 EXE 和 APK，win.zip 仅包含 EXE
    def test_create_zips_creates_full_and_win(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = os.path.join(tmpdir, 'output')
            dist_dir = os.path.join(tmpdir, 'dist')
            os.makedirs(output_dir)
            os.makedirs(dist_dir)

            exe_path = os.path.join(dist_dir, 'PapaCheck-1.0.0.exe')
            with open(exe_path, 'w') as f:
                f.write('fake exe')

            apk_src = os.path.join(tmpdir, 'PapaCheck-2.0.0.apk')
            with open(apk_src, 'w') as f:
                f.write('fake apk')

            full_zip, win_zip = release.create_zips(
                output_dir, '1.0.0', '2.0.0', apk_src, dist_dir)

            assert os.path.isfile(full_zip), f'缺少 full ZIP: {full_zip}'
            assert os.path.isfile(win_zip), f'缺少 win ZIP: {win_zip}'
            assert full_zip.endswith('PapaCheck-v1.0.0_full.zip')
            assert win_zip.endswith('PapaCheck-v1.0.0_win.zip')

            with zipfile.ZipFile(full_zip, 'r') as zf:
                names = zf.namelist()
                assert 'PapaCheck-1.0.0.exe' in names
                assert 'PapaCheck-2.0.0.apk' in names

            with zipfile.ZipFile(win_zip, 'r') as zf:
                names = zf.namelist()
                assert 'PapaCheck-1.0.0.exe' in names
                assert 'PapaCheck-2.0.0.apk' not in names

    # Feature: 创建 ZIP 压缩包
    #   Scenario: APK 文件被复制到输出目录后仍保留原始文件
    #     Given 输出目录和 dist 目录中存在对应的文件
    #     When 调用 create_zips
    #     Then APK 文件被复制到输出目录，原始 APK 源文件不变
    def test_create_zips_copies_apk_to_output_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = os.path.join(tmpdir, 'output')
            dist_dir = os.path.join(tmpdir, 'dist')
            os.makedirs(output_dir)
            os.makedirs(dist_dir)

            exe_path = os.path.join(dist_dir, 'PapaCheck-1.0.0.exe')
            with open(exe_path, 'w') as f:
                f.write('fake exe')

            apk_src = os.path.join(tmpdir, 'PapaCheck-2.0.0.apk')
            with open(apk_src, 'w') as f:
                f.write('fake apk')

            release.create_zips(output_dir, '1.0.0', '2.0.0', apk_src, dist_dir)

            apk_dst = os.path.join(output_dir, 'PapaCheck-2.0.0.apk')
            assert os.path.isfile(apk_dst)
            assert os.path.isfile(apk_src)


class TestParseArgs:

    # Feature: 命令行参数解析
    #   Scenario: 完整发布模式，指定 EXE 和 APK 均递增 patch
    #     Given 传入 --bump-exe patch 和 --bump-apk patch 参数
    #     When 调用 parse_args
    #     Then 返回 bump_exe='patch' 且 bump_apk='patch'
    def test_parse_args_full_release_with_bump(self):
        with patch('sys.argv', ['release.py', '--bump-exe', 'patch', '--bump-apk', 'patch']):
            args = release.parse_args()
            assert args.bump_exe == 'patch'
            assert args.bump_apk == 'patch'
            assert args.exe_only is False
            assert args.apk_only is False

    # Feature: 命令行参数解析
    #   Scenario: 仅构建 EXE 模式
    #     Given 传入 --exe-only 和 --bump-exe patch 参数
    #     When 调用 parse_args
    #     Then exe_only=True, apk_only=False
    def test_parse_args_exe_only_mode(self):
        with patch('sys.argv', ['release.py', '--exe-only', '--bump-exe', 'patch']):
            args = release.parse_args()
            assert args.exe_only is True
            assert args.apk_only is False

    # Feature: 命令行参数解析
    #   Scenario: 仅构建 APK 模式
    #     Given 传入 --apk-only 和 --bump-apk patch 参数
    #     When 调用 parse_args
    #     Then apk_only=True, exe_only=False
    def test_parse_args_apk_only_mode(self):
        with patch('sys.argv', ['release.py', '--apk-only', '--bump-apk', 'patch']):
            args = release.parse_args()
            assert args.apk_only is True
            assert args.exe_only is False

    # Feature: 命令行参数解析
    #   Scenario: 直接设置 EXE 版本号
    #     Given 传入 --set-exe-ver 2.0.0 参数
    #     When 调用 parse_args
    #     Then set_exe_ver='2.0.0'
    def test_parse_args_set_exe_version(self):
        with patch('sys.argv', ['release.py', '--set-exe-ver', '2.0.0']):
            args = release.parse_args()
            assert args.set_exe_ver == '2.0.0'

    # Feature: 命令行参数解析
    #   Scenario: 指定不递增 EXE 版本
    #     Given 传入 --exe-only 和 --no-bump-exe 参数
    #     When 调用 parse_args
    #     Then no_bump_exe=True，且 bump_exe 保持 None
    def test_parse_args_no_bump_exe(self):
        with patch('sys.argv', ['release.py', '--exe-only', '--no-bump-exe']):
            args = release.parse_args()
            assert args.no_bump_exe is True
            assert args.bump_exe is None


class TestVersionRe:

    # Feature: 版本号正则表达式
    #   Scenario: 匹配正确的 X.Y.Z 格式版本号
    #     Given 版本号 '1.2.3'
    #     When 使用 VERSION_RE 匹配
    #     Then 匹配成功
    def test_version_re_matches_valid_versions(self):
        assert release.VERSION_RE.match('1.2.3')
        assert release.VERSION_RE.match('0.0.1')
        assert release.VERSION_RE.match('10.20.30')

    # Feature: 版本号正则表达式
    #   Scenario: 拒绝非法格式的版本号
    #     Given 版本号 '1.2'、'abc'、'1.2.3.4'
    #     When 使用 VERSION_RE 匹配
    #     Then 匹配失败
    def test_version_re_rejects_invalid_versions(self):
        assert not release.VERSION_RE.match('1.2')
        assert not release.VERSION_RE.match('abc')
        assert not release.VERSION_RE.match('1.2.3.4')


class TestBetterSqlite3Rebuild:

    # Feature: 自动检测 better-sqlite3
    #   Scenario: better-sqlite3 可正常加载时无需重建
    #     Given better-sqlite3 可以正常 require 加载
    #     When 调用 check_better_sqlite3
    #     Then 返回 False，表示不需要重建
    def test_check_returns_false_when_module_works(self):
        with patch('release.subprocess.run') as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0)
            result = release.check_better_sqlite3()
            assert result is False

    # Feature: 自动检测 better-sqlite3
    #   Scenario: better-sqlite3 无法加载时触发重建
    #     Given better-sqlite3 require 失败
    #     When 调用 check_better_sqlite3
    #     Then 返回 True，表示需要重建
    def test_check_returns_true_when_module_fails(self):
        with patch('release.subprocess.run') as mock_run:
            mock_run.side_effect = subprocess.CalledProcessError(
                returncode=1, cmd=[])
            result = release.check_better_sqlite3()
            assert result is True

    # Feature: 自动检测 better-sqlite3
    #   Scenario: check 在 NODE_DIR 中执行 node -e require
    #     Given 调用 check_better_sqlite3
    #     When 检查传入 subprocess.run 的参数
    #     Then 命令应为 node -e "require('better-sqlite3')"，cwd 为 NODE_DIR
    def test_check_runs_correct_command_in_node_dir(self):
        with patch('release.subprocess.run') as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0)
            release.check_better_sqlite3()
            mock_run.assert_called_once()
            args, kwargs = mock_run.call_args
            assert 'node' in args[0]
            assert "require('better-sqlite3')" in args[0]
            assert kwargs['cwd'] == release.NODE_DIR

    # Feature: 重建 better-sqlite3
    #   Scenario: rebuild_better_sqlite3 执行 npm rebuild
    #     Given 需要重新构建 better-sqlite3
    #     When 调用 rebuild_better_sqlite3
    #     Then 在 NODE_DIR 目录下执行 npm rebuild better-sqlite3
    def test_rebuild_runs_npm_rebuild(self):
        with patch('release.subprocess.run') as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0)
            release.rebuild_better_sqlite3()
            mock_run.assert_called_once()
            args, kwargs = mock_run.call_args
            cmd = kwargs.get('args', args[0] if args else '')
            cmd_str = cmd if isinstance(cmd, str) else ' '.join(cmd)
            assert 'npm' in cmd_str
            assert 'rebuild' in cmd_str
            assert 'better-sqlite3' in cmd_str
            assert kwargs['cwd'] == release.NODE_DIR
            assert kwargs['shell'] is True

    # Feature: 重建 better-sqlite3
    #   Scenario: rebuild 失败时退出进程
    #     Given npm rebuild 执行失败, 退出码为 1
    #     When 调用 rebuild_better_sqlite3
    #     Then run_step 检测到非零退出码并调用 sys.exit(1)
    def test_rebuild_exits_on_failure(self):
        with patch('release.subprocess.run') as mock_run, \
             patch('release.sys.exit') as mock_exit:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=1)
            release.rebuild_better_sqlite3()
            mock_exit.assert_called_once_with(1)

    # Feature: main() 中自动检查并 rebuild
    #   Scenario: better-sqlite3 需要重建时自动调用 rebuild
    #     Given release 主流程执行完毕（EXE only 模式，跳过 APK 产物检查）
    #     When check_better_sqlite3 返回 True
    #     Then main() 会调用 rebuild_better_sqlite3
    def test_main_rebuilds_when_check_says_true(self):
        with patch('release.parse_args') as mock_parse, \
             patch('release.build_steps', return_value=[]), \
             patch('release.run_step'), \
             patch('release.read_exe_version', return_value='1.0.0'), \
             patch('release.read_apk_version', return_value='1.0.0'), \
             patch('release.check_better_sqlite3', return_value=True) as mock_check, \
             patch('release.rebuild_better_sqlite3') as mock_rebuild, \
             patch('release.print_summary'):
            mock_parse.return_value = _make_args(
                exe_only=True, no_bump_exe=True, no_zip=True)
            release.main()
            mock_check.assert_called_once()
            mock_rebuild.assert_called_once()

    # Feature: main() 中自动检查并 rebuild
    #   Scenario: better-sqlite3 正常时不执行 rebuild
    #     Given release 主流程执行完毕（EXE only 模式，跳过 APK 产物检查）
    #     When check_better_sqlite3 返回 False
    #     Then main() 跳过 rebuild_better_sqlite3
    def test_main_skips_rebuild_when_check_says_false(self):
        with patch('release.parse_args') as mock_parse, \
             patch('release.build_steps', return_value=[]), \
             patch('release.run_step'), \
             patch('release.read_exe_version', return_value='1.0.0'), \
             patch('release.read_apk_version', return_value='1.0.0'), \
             patch('release.check_better_sqlite3', return_value=False) as mock_check, \
             patch('release.rebuild_better_sqlite3') as mock_rebuild, \
             patch('release.print_summary'):
            mock_parse.return_value = _make_args(
                exe_only=True, no_bump_exe=True, no_zip=True)
            release.main()
            mock_check.assert_called_once()
            mock_rebuild.assert_not_called()
