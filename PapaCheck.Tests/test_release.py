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

    def test_full_release_apk_steps_before_exe_steps(self):
        args = _make_args(bump_exe='patch', bump_apk='patch')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        apk_idx = descs.index('构建 Android APK')
        exe_idx = descs.index('打包 Windows EXE')
        assert apk_idx < exe_idx, \
            f'APK 构建步骤({apk_idx})应在 EXE 打包步骤({exe_idx})之前，实际顺序: {descs}'

    def test_full_release_no_bump_apk_steps_before_exe_steps(self):
        args = _make_args(bump_exe='patch', no_bump_apk=True)
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        apk_idx = descs.index('构建 Android APK')
        exe_idx = descs.index('打包 Windows EXE')
        assert apk_idx < exe_idx, \
            f'APK 构建步骤({apk_idx})应在 EXE 打包步骤({exe_idx})之前，实际顺序: {descs}'

    def test_exe_only_no_apk_steps(self):
        args = _make_args(exe_only=True, bump_exe='patch')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '构建 Android APK' not in descs
        assert '打包 Windows EXE' in descs

    def test_apk_only_no_exe_steps(self):
        args = _make_args(apk_only=True, bump_apk='patch')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '构建 Android APK' in descs
        assert '打包 Windows EXE' not in descs

    def test_bump_apk_includes_version_step(self):
        args = _make_args(apk_only=True, bump_apk='patch')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 APK 版本号' in descs

    def test_no_bump_apk_excludes_version_step(self):
        args = _make_args(apk_only=True, no_bump_apk=True)
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 APK 版本号' not in descs
        assert '构建 Android APK' in descs

    def test_bump_exe_includes_version_step(self):
        args = _make_args(exe_only=True, bump_exe='minor')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 EXE 版本号' in descs

    def test_no_bump_exe_excludes_version_step(self):
        args = _make_args(exe_only=True, no_bump_exe=True)
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 EXE 版本号' not in descs
        assert '打包 Windows EXE' in descs

    def test_set_apk_ver_includes_set_step(self):
        args = _make_args(apk_only=True, set_apk_ver='2.0.0')
        steps = release.build_steps(args)
        descs = _step_descriptions(steps)

        assert '递增 APK 版本号' in descs


class TestReadExeVersion:

    def test_reads_version_from_config(self):
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

    def test_defaults_when_config_missing(self):
        original = release.BUILD_CONFIG
        release.BUILD_CONFIG = '/nonexistent/path/build_config.json'
        try:
            with pytest.raises(FileNotFoundError):
                release.read_exe_version()
        finally:
            release.BUILD_CONFIG = original

    def test_defaults_when_version_field_missing(self):
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

    def test_reads_version_from_pubspec(self):
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

    def test_strips_build_number(self):
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

    def test_defaults_when_pubspec_missing(self):
        original = release.PUBSPEC
        release.PUBSPEC = '/nonexistent/path/pubspec.yaml'
        try:
            with pytest.raises(FileNotFoundError):
                release.read_apk_version()
        finally:
            release.PUBSPEC = original

    def test_defaults_when_version_field_missing(self):
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
