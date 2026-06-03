import os
import sys
import json
import tempfile
import argparse

import pytest

_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, _PROJECT_ROOT)

import release


def _make_args(**kwargs):
    defaults = {
        'exe_only': False,
        'apk_only': False,
        'bump_exe': None,
        'bump_apk': None,
        'set_exe_ver': None,
        'set_apk_ver': None,
        'no_bump_exe': False,
        'no_bump_apk': False,
        'no_zip': False,
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
