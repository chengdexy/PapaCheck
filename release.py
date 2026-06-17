import subprocess
import sys
import os
import shutil
import argparse
import zipfile
import json
import re
import tarfile
import io

ROOT = os.path.dirname(os.path.abspath(__file__))
ANDROID_DIR = os.path.join(ROOT, 'PapaCheck.Android')
WINDOWS_DIR = os.path.join(ROOT, 'PapaCheck.Windows')
NODE_DIR = os.path.join(ROOT, 'PapaCheck.Server.Node')
PUBSPEC = os.path.join(ANDROID_DIR, 'pubspec.yaml')
BUILD_CONFIG = os.path.join(WINDOWS_DIR, 'build_config.json')
APK_BUILD_OUTPUT = os.path.join(ANDROID_DIR, 'build', 'app', 'outputs',
                                'flutter-apk', 'app-release.apk')
APK_ARCHIVE_DIR = os.path.join(ANDROID_DIR, 'apk')
BUMP_VERSION_SCRIPT = os.path.join(WINDOWS_DIR, 'bump_version.py')
BUILD_EXE_SCRIPT = os.path.join(WINDOWS_DIR, 'build_exe.py')
DEFAULT_OUTPUT_DIR = os.path.join(WINDOWS_DIR, 'dist')

# 云发布配置（可通过环境变量覆盖）
CLOUD_SERVER_IP = os.environ.get('PAPACHECK_CLOUD_IP', '123.57.129.243')
CLOUD_SERVER_USER = 'root'

VERSION_RE = re.compile(r'^(\d+)\.(\d+)\.(\d+)$')

# ── 输出美化 ────────────────────────────────────────────

SECTION_WIDTH = 56


def section(title):
    """打印分区标题。"""
    print()
    print(f'── {title} ' + '─' * (SECTION_WIDTH - len(title) - 4))


def done(text):
    """打印完成信息。"""
    print(f'  ✓ {text}')

# ───────────────────────────────────────────────────────


SSH_TIMEOUT = 30          # 简单 SSH 命令超时
SCP_TIMEOUT = 120         # 文件上传超时
BUILD_TIMEOUT = 180       # 构建/测试超时
REMOTE_INSTALL_TIMEOUT = 300  # 远程安装依赖超时


def _run_with_timeout(cmd, timeout, **kwargs):
    """带超时的 subprocess.run，超时时抛出 TimeoutExpired。"""
    kwargs['timeout'] = timeout
    return subprocess.run(cmd, **kwargs)


def cloud_publish(server_ip, server_user):
    """同步代码到云端服务器。"""
    print()
    section('云同步')
    print(f'  目标: {server_user}@{server_ip}')
    print()

    # 1. 运行测试
    print(f'  ▶ [1/5] 运行全量测试 ... ', end='', flush=True)
    try:
        result = _run_with_timeout(
            'npm test', BUILD_TIMEOUT, cwd=ROOT, shell=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode != 0:
            print('✗')
            print('  测试失败，中止发布')
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  测试超时，中止发布')
        return False
    print('✓')

    # 2. 编译 TypeScript
    print(f'  ▶ [2/5] 编译 TypeScript ... ', end='', flush=True)
    try:
        build_result = _run_with_timeout(
            'npm run build', BUILD_TIMEOUT, cwd=NODE_DIR, shell=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if build_result.returncode != 0:
            print('✗')
            print('  TypeScript 编译失败')
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  TypeScript 编译超时')
        return False
    print('✓')

    # 3. 打包代码（包含编译产物 dist/）
    print(f'  ▶ [3/5] 打包代码 ... ', end='', flush=True)
    tar_path = os.path.join(ROOT, '.publish.tar.gz')
    tar_cmd = [
        'tar', '--exclude=node_modules', '--exclude=test',
        '--exclude=PapaCheck.Android', '--exclude=PapaCheck.Windows',
        '--exclude=PapaCheck.Email', '--exclude=PapaCheck.Tests',
        '--exclude=PapaCheck.Server', '--exclude=PapaCheck.Site', '--exclude=.trae',
        '--exclude=*.md', '--exclude=publish.ps1', '--exclude=.publish.tar.gz',
        '--exclude=docker-compose.yml', '--exclude=.dockerignore',
        '--exclude=nginx.conf', '--exclude=papacheck.service',
        '-czf', tar_path,
        'PapaCheck.Server.Node', 'PapaCheck.Web',
    ]
    try:
        result = _run_with_timeout(tar_cmd, SCP_TIMEOUT, cwd=ROOT)
        if result.returncode != 0:
            print('✗')
            print('  打包失败')
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  打包超时')
        return False
    print('✓')

    # 4. 检查并准备 APK
    apk_local = None
    # 优先从归档目录取
    apk_archive_dir = os.path.join(ROOT, 'PapaCheck.Android', 'apk')
    if os.path.isdir(apk_archive_dir):
        apk_files = sorted(
            [f for f in os.listdir(apk_archive_dir)
             if f.startswith('PapaCheck-') and f.endswith('.apk')],
            reverse=True)
        if apk_files:
            apk_local = os.path.join(apk_archive_dir, apk_files[0])
    # 其次从构建产物取
    if apk_local is None and os.path.exists(APK_BUILD_OUTPUT):
        apk_local = APK_BUILD_OUTPUT

    if apk_local:
        print(f'  ▶ [4/5] 上传 APK ({os.path.basename(apk_local)}) ... ', end='', flush=True)
        try:
            result = _run_with_timeout(
                ['scp', '-o', 'StrictHostKeyChecking=accept-new',
                 apk_local, f'{server_user}@{server_ip}:/opt/papacheck/PapaCheck.Web/apk/'],
                SCP_TIMEOUT)
            if result.returncode != 0:
                print('✗')
                print('  APK 上传失败')
            else:
                print('✓')
                # 清理旧 APK，只保留最新的 3 个
                cleanup_cmd = (
                    'cd /opt/papacheck/PapaCheck.Web/apk && '
                    'ls PapaCheck-*.apk 2>/dev/null | sort -r | tail -n +4 | '
                    'while read f; do rm -f "$f"; done && '
                    'echo "  清理旧 APK 完成"')
                try:
                    _run_with_timeout(
                        ['ssh', '-o', 'StrictHostKeyChecking=accept-new',
                         f'{server_user}@{server_ip}', cleanup_cmd],
                        SSH_TIMEOUT)
                except subprocess.TimeoutExpired:
                    print('  [警告] 清理旧 APK 超时，跳过')
        except subprocess.TimeoutExpired:
            print('✗')
            print('  APK 上传超时')
    else:
        print(f'  ▶ [4/5] 无 APK 可上传，跳过')

    # 5. 上传代码包
    print(f'  ▶ [5/5] 上传代码到服务器 ... ', end='', flush=True)
    try:
        result = _run_with_timeout(
            ['scp', '-o', 'StrictHostKeyChecking=accept-new',
             tar_path, f'{server_user}@{server_ip}:/opt/'],
            SCP_TIMEOUT)
        if result.returncode != 0:
            print('✗')
            print('  上传失败')
            # 保留 tar 包以便重试
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  上传代码包超时')
        # 保留 tar 包以便重试
        return False
    os.remove(tar_path)
    print('✓')

    # 6. 服务器端安装依赖并重启
    print(f'  ▶ [6/6] 服务器端安装依赖并重启 ... ', end='', flush=True)
    remote_cmd = (
        'mkdir -p /opt/papacheck && '
        'cd /opt && tar xzf .publish.tar.gz -C /opt/papacheck && '
        'rm -f .publish.tar.gz && '
        'cd /opt/papacheck/PapaCheck.Server.Node && '
        'npm ci --omit=dev --ignore-scripts && '
        'sudo systemctl restart papacheck')
    try:
        result = _run_with_timeout(
            ['ssh', '-o', 'StrictHostKeyChecking=accept-new',
             f'{server_user}@{server_ip}', remote_cmd],
            REMOTE_INSTALL_TIMEOUT)
        if result.returncode != 0:
            print('✗')
            print('  云端构建失败')
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  云端构建超时（npm ci 或 systemctl 耗时过长）')
        return False

    # 检查备份目录
    try:
        _run_with_timeout(
            ['ssh', '-o', 'StrictHostKeyChecking=accept-new',
             f'{server_user}@{server_ip}',
             'test -d /var/backups/papacheck || echo "WARNING: 备份目录 /var/backups/papacheck 不存在"'],
            10)
    except Exception:
        pass  # 非关键检查，失败不中止
    print('✓')

    print()
    done('云同步完成')
    return True


def site_publish(server_ip, server_user):
    """构建并部署 PapaCheck.Site 到云端。"""
    section('PapaCheck.Site 部署')
    site_admin_dir = os.path.join(ROOT, 'PapaCheck.Site', 'admin')
    site_landing_dir = os.path.join(ROOT, 'PapaCheck.Site')

    # 1. 构建 React 管理面板
    print(f'  ▶ [1/4] 构建管理面板 ... ', end='', flush=True)
    result = subprocess.run(
        'npm run build', cwd=site_admin_dir, shell=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode != 0:
        print('✗')
        print('  React 构建失败')
        return False
    print('✓')

    # 2. 上传管理面板到 webDir/admin/
    print(f'  ▶ [2/4] 上传管理面板 ... ', end='', flush=True)
    dist_dir = os.path.join(site_admin_dir, 'dist')
    try:
        result = _run_with_timeout([
            'ssh', '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'UserKnownHostsFile=NUL',
            f'{server_user}@{server_ip}',
            'mkdir -p /opt/papacheck/PapaCheck.Web/admin'
        ], SSH_TIMEOUT)
        if result.returncode != 0:
            print('✗')
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  SSH 创建目录超时')
        return False

    # 用 tar 打包后通过 SSH 管道解压，避免 Windows 下 SCP glob 不展开的问题
    try:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as tar:
            for fname in os.listdir(dist_dir):
                fpath = os.path.join(dist_dir, fname)
                tar.add(fpath, arcname=fname)
        buf.seek(0)
        result = _run_with_timeout(
            ['ssh', '-o', 'StrictHostKeyChecking=accept-new',
             '-o', 'UserKnownHostsFile=NUL',
             f'{server_user}@{server_ip}',
             'tar xzf - -C /opt/papacheck/PapaCheck.Web/admin/'],
            SCP_TIMEOUT, input=buf.getvalue())
        if result.returncode != 0:
            print('✗')
            print('  管理面板上传失败')
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  上传管理面板超时')
        return False
    print('✓')

    # 3. 上传官网落地页到 Site 目录
    # 打包 index.html、css/、js/、imgs/，用 tar SSH 管道解压
    print(f'  ▶ [3/4] 上传落地页 ... ', end='', flush=True)
    try:
        result = _run_with_timeout([
            'ssh', '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'UserKnownHostsFile=NUL',
            f'{server_user}@{server_ip}',
            'mkdir -p /opt/papacheck/PapaCheck.Site/css /opt/papacheck/PapaCheck.Site/js /opt/papacheck/PapaCheck.Site/imgs'
        ], SSH_TIMEOUT)
        if result.returncode != 0:
            print('✗')
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  SSH 创建目录超时')
        return False

    try:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as tar:
            # 只添加落地页文件，排除 admin/ 子目录
            for name in ['index.html', 'css', 'js', 'imgs']:
                fpath = os.path.join(site_landing_dir, name)
                if os.path.exists(fpath):
                    tar.add(fpath, arcname=name)
        buf.seek(0)
        result = _run_with_timeout(
            ['ssh', '-o', 'StrictHostKeyChecking=accept-new',
             '-o', 'UserKnownHostsFile=NUL',
             f'{server_user}@{server_ip}',
             'tar xzf - -C /opt/papacheck/PapaCheck.Site/'],
            SCP_TIMEOUT, input=buf.getvalue())
        if result.returncode != 0:
            print('✗')
            print('  落地页上传失败')
            return False
    except subprocess.TimeoutExpired:
        print('✗')
        print('  上传落地页超时')
        return False
    print('✓')

    # 4. 清理本地构建产物
    print(f'  ▶ [4/4] 清理构建产物 ... ', end='', flush=True)
    shutil.rmtree(dist_dir)
    print('✓')
    done('PapaCheck.Site 部署完成')
    return True


def parse_args():
    parser = argparse.ArgumentParser(
        description='PapaCheck 发布编排脚本 — 构建 APK / EXE / ZIP 制品，并可选同步到云端',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
使用示例:
  python release.py                              # 交互式引导模式
  python release.py --exe-only                              # 仅构建 Windows EXE
  python release.py --apk-only --set-apk-ver 2.0.0          # 仅构建 APK，指定版本号
  python release.py --cloud                                # 构建后同步到云端
  python release.py --cloud-only                           # 仅同步到云端（不构建制品）
  python release.py --bump-exe major --no-bump-apk          # 完整发布，EXE 升 major
  python release.py -v 1.5.0 --no-bump-exe       # 指定 APK 版本，不升 EXE
  python release.py --no-zip                     # 完整发布但不创建 ZIP
  python release.py --output-dir D:\\releases     # 指定输出目录

环境变量:
  PAPACHECK_CLOUD_IP=your.server.ip   # 指定云端服务器 IP（默认 123.57.129.243）
''')

    build_group = parser.add_mutually_exclusive_group()
    build_group.add_argument('--exe-only', action='store_true',
                             help='仅构建 Windows EXE（PyInstaller）')
    build_group.add_argument('--apk-only', action='store_true',
                             help='仅构建 Android APK')
    build_group.add_argument('--node-only', action='store_true',
                             help='仅构建 Node.js SEA 单 EXE')

    parser.add_argument('--cloud', action='store_true',
                        help='构建后同步到云端服务器')
    parser.add_argument('--cloud-only', action='store_true',
                        help='仅同步到云端（不构建制品）')

    parser.add_argument('--bump-exe', nargs='?', const='patch', default=None,
                        metavar='patch|minor|major',
                        help='递增 EXE 版本号 (默认: patch)')

    parser.add_argument('--bump-apk', nargs='?', const='patch', default=None,
                        metavar='patch|minor|major',
                        help='递增 APK 版本号 (默认: patch)')

    parser.add_argument('--set-exe-ver', default=None, metavar='X.Y.Z',
                        help='直接设置 EXE 版本号')

    parser.add_argument('--set-apk-ver', default=None, metavar='X.Y.Z',
                        help='直接设置 APK 版本号')

    parser.add_argument('-v', default=None, metavar='X.Y.Z',
                        help='--set-apk-ver 的别名 (向后兼容)')

    parser.add_argument('--no-bump-exe', action='store_true',
                        help='不递增 EXE 版本号')

    parser.add_argument('--no-bump-apk', action='store_true',
                        help='不递增 APK 版本号')

    parser.add_argument('--no-zip', action='store_true',
                        help='跳过 ZIP 打包步骤')

    parser.add_argument('--output-dir', default=DEFAULT_OUTPUT_DIR,
                        metavar='DIR',
                        help=f'输出目录 (默认: {DEFAULT_OUTPUT_DIR})')

    parser.add_argument('--site', action='store_true',
                        help='构建并部署 PapaCheck.Site')

    if len(sys.argv) == 1:
        return run_wizard()

    args = parser.parse_args()

    if args.set_apk_ver and args.v:
        parser.error('--set-apk-ver 和 -v 不能同时指定')

    if args.v:
        args.set_apk_ver = args.v

    exe_only = args.exe_only
    apk_only = args.apk_only

    if args.bump_exe is not None and args.bump_exe not in ('patch', 'minor', 'major'):
        parser.error(f'--bump-exe 值必须为 patch / minor / major，而不是 "{args.bump_exe}"')

    if args.bump_apk is not None and args.bump_apk not in ('patch', 'minor', 'major'):
        parser.error(f'--bump-apk 值必须为 patch / minor / major，而不是 "{args.bump_apk}"')

    if args.set_exe_ver is not None and not VERSION_RE.match(args.set_exe_ver):
        parser.error(f'--set-exe-ver 格式必须为 X.Y.Z，而不是 "{args.set_exe_ver}"')

    if args.set_apk_ver is not None and not VERSION_RE.match(args.set_apk_ver):
        parser.error(f'--set-apk-ver 格式必须为 X.Y.Z，而不是 "{args.set_apk_ver}"')

    if args.set_exe_ver is not None and args.bump_exe is not None:
        parser.error('--set-exe-ver 和 --bump-exe 不能同时指定')

    if args.set_apk_ver is not None and args.bump_apk is not None:
        parser.error('--set-apk-ver 和 --bump-apk 不能同时指定')

    if args.no_bump_exe and args.bump_exe is not None:
        parser.error('--no-bump-exe 和 --bump-exe 不能同时指定')

    if args.no_bump_exe and args.set_exe_ver is not None:
        parser.error('--no-bump-exe 和 --set-exe-ver 不能同时指定')

    if args.no_bump_apk and args.bump_apk is not None:
        parser.error('--no-bump-apk 和 --bump-apk 不能同时指定')

    if args.no_bump_apk and args.set_apk_ver is not None:
        parser.error('--no-bump-apk 和 --set-apk-ver 不能同时指定')

    need_exe = exe_only or (not apk_only and not args.cloud_only)
    need_apk = apk_only or (not exe_only and not args.cloud_only)

    if need_exe and not (args.bump_exe or args.set_exe_ver or args.no_bump_exe):
        args.bump_exe = 'patch'

    if need_apk and not (args.bump_apk or args.set_apk_ver or args.no_bump_apk):
        args.bump_apk = 'patch'

    return args


def read_exe_version():
    with open(BUILD_CONFIG, 'r', encoding='utf-8') as f:
        config = json.load(f)
    return config.get('exe_version', '0.0.0')


def read_apk_version():
    with open(PUBSPEC, 'r', encoding='utf-8') as f:
        content = f.read()
    m = re.search(r'^version:\s*(\S+)', content, re.MULTILINE)
    if m:
        return m.group(1).split('+')[0]
    return '0.0.0'


def run_step(n, total, desc, cmd, cwd=None, shell=False, verbose=False):
    print(f'  ▶ [{n}/{total}] {desc} ... ', end='', flush=True)
    kwargs = {'cwd': cwd}
    if shell:
        kwargs['shell'] = True
    if verbose:
        kwargs['stdout'] = None
        kwargs['stderr'] = None
        print()
    else:
        kwargs['stdout'] = subprocess.DEVNULL
        kwargs['stderr'] = subprocess.DEVNULL
    result = subprocess.run(cmd, **kwargs)
    if result.returncode != 0:
        print('✗')
        print(f'  ✗ {desc} (退出码: {result.returncode})')
        sys.exit(result.returncode)
    print('✓')


def build_steps(args):
    steps = []

    if args.apk_only or (not args.exe_only and not args.cloud_only):
        if args.bump_apk:
            cmd = [sys.executable, BUMP_VERSION_SCRIPT,
                   '--target', 'apk', args.bump_apk]
        elif args.set_apk_ver:
            cmd = [sys.executable, BUMP_VERSION_SCRIPT,
                   '--target', 'apk', '--set', args.set_apk_ver]
        else:
            cmd = None

        if cmd:
            steps.append(('递增 APK 版本号', cmd, ROOT, False))

        apk_cmd_str = 'flutter build apk --release'
        steps.append(('构建 Android APK', apk_cmd_str, ANDROID_DIR, True))

    if args.exe_only or (not args.apk_only and not args.cloud_only):
        if args.bump_exe:
            cmd = [sys.executable, BUMP_VERSION_SCRIPT,
                   '--target', 'exe', args.bump_exe]
        elif args.set_exe_ver:
            cmd = [sys.executable, BUMP_VERSION_SCRIPT,
                   '--target', 'exe', '--set', args.set_exe_ver]
        else:
            cmd = None

        if cmd:
            steps.append(('递增 EXE 版本号', cmd, ROOT, False))
        steps.append(('打包 Windows EXE',
                      [sys.executable, BUILD_EXE_SCRIPT], ROOT, False))

    return steps


def archive_apk(apk_ver):
    os.makedirs(APK_ARCHIVE_DIR, exist_ok=True)
    dst = os.path.join(APK_ARCHIVE_DIR, f'PapaCheck-{apk_ver}.apk')
    shutil.copy2(APK_BUILD_OUTPUT, dst)
    done(f'APK 归档 → {dst}')
    for fname in os.listdir(APK_ARCHIVE_DIR):
        full = os.path.join(APK_ARCHIVE_DIR, fname)
        if os.path.isfile(full) and fname.startswith('PapaCheck-') \
                and fname.endswith('.apk') and fname != f'PapaCheck-{apk_ver}.apk':
            os.remove(full)
    return dst


def create_zips(output_dir, exe_ver, apk_ver, apk_src, dist_dir):
    os.makedirs(output_dir, exist_ok=True)

    exe_path = os.path.join(dist_dir, f'PapaCheck-{exe_ver}.exe')

    apk_name = f'PapaCheck-{apk_ver}.apk'
    apk_dst = os.path.join(output_dir, apk_name)
    shutil.copy2(apk_src, apk_dst)
    done(f'APK 复制 → {os.path.basename(apk_dst)}')

    full_zip = os.path.join(output_dir, f'PapaCheck-v{exe_ver}_full.zip')
    with zipfile.ZipFile(full_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe_path, os.path.basename(exe_path))
        zf.write(apk_dst, apk_name)
    done(f'ZIP 打包 → {os.path.basename(full_zip)}')

    win_zip = os.path.join(output_dir, f'PapaCheck-v{exe_ver}_win.zip')
    with zipfile.ZipFile(win_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe_path, os.path.basename(exe_path))
    done(f'ZIP 打包 → {os.path.basename(win_zip)}')

    return full_zip, win_zip


def print_summary(output_dir, exe_ver, apk_ver, zips, need_exe, need_apk, no_zip, did_cloud, did_site=False):
    print()
    print('  ' + '═' * SECTION_WIDTH)
    print('  ═══  发布完成  ═══')
    print('  ' + '═' * SECTION_WIDTH)
    print()
    if need_exe or need_apk:
        print('  版本')
        if need_exe:
            print(f'    EXE  {exe_ver}')
        if need_apk:
            print(f'    APK  {apk_ver}')
        print()
    print('  产物')
    if need_exe:
        print(f'    • PapaCheck-{exe_ver}.exe')
    if need_apk:
        print(f'    • PapaCheck-{apk_ver}.apk')
    if zips:
        for z in zips:
            print(f'    • {os.path.basename(z)}')
    if did_cloud:
        print(f'    • 已同步到云端 ({CLOUD_SERVER_IP})')
    if did_site:
        print(f'    • PapaCheck.Site 已部署')
    print()
    if need_exe or need_apk:
        print(f'  输出目录  {output_dir}')
        print()


def ask_int(prompt, min_val, max_val):
    while True:
        try:
            val = input(prompt).strip()
            if val == '':
                return None
            v = int(val)
            if min_val <= v <= max_val:
                return v
            print(f'  请输入 {min_val}-{max_val} 之间的数字')
        except ValueError:
            print(f'  请输入有效数字')


def ask_version(prompt):
    while True:
        ver = input(prompt).strip()
        if VERSION_RE.match(ver):
            return ver
        print('  版本号格式错误，请输入 X.Y.Z，如 1.2.3')


def run_wizard():
    print()
    print('=' * 50)
    print('  PapaCheck 发布向导')
    print('=' * 50)
    print()

    current_exe = read_exe_version()
    current_apk = read_apk_version()
    print(f'  当前版本:  EXE = {current_exe}  |  APK = {current_apk}')
    print()

    # ---- Step 1: 构建目标 (默认: 仅 EXE) ----
    print('─' * 50)
    print('  Step 1/7 — 选择构建目标:')
    print('    [默认] 仅构建 Windows EXE (直接回车)')
    print('    1) 完整发布 (EXE + APK)')
    print('    2) 仅构建 Windows EXE')
    print('    3) 仅构建 Android APK')
    choice = ask_int('  请输入序号 [默认:2]: ', 1, 3) or 2

    if choice == 2:
        exe_only = True
        apk_only = False
    elif choice == 3:
        exe_only = False
        apk_only = True
    else:
        exe_only = False
        apk_only = False
    print()

    need_exe = exe_only or not apk_only
    need_apk = apk_only or not exe_only

    bump_exe = None
    set_exe_ver = None
    no_bump_exe = False

    bump_apk = None
    set_apk_ver = None
    no_bump_apk = False

    # ---- Step 2: EXE 版本控制 (默认: 不变) ----
    if need_exe:
        print('─' * 50)
        print(f'  Step 2/7 — EXE 版本控制 (当前: {current_exe}):')
        print('    [默认] 不改变版本号 (直接回车)')
        print('    1) 自动递增 patch   (如 1.0.0 → 1.0.1)')
        print('    2) 自动递增 minor   (如 1.0.0 → 1.1.0)')
        print('    3) 自动递增 major   (如 1.0.0 → 2.0.0)')
        print('    4) 手动指定版本号')
        print('    5) 不改变版本号')
        choice = ask_int('  请输入序号 [默认:5]: ', 1, 5) or 5
        print()

        if choice == 1:
            bump_exe = 'patch'
            print(f'  EXE: {current_exe} → patch 递增')
        elif choice == 2:
            bump_exe = 'minor'
            print(f'  EXE: {current_exe} → minor 递增')
        elif choice == 3:
            bump_exe = 'major'
            print(f'  EXE: {current_exe} → major 递增')
        elif choice == 4:
            set_exe_ver = ask_version('  请输入 EXE 版本号 (X.Y.Z): ')
            print(f'  EXE: 直接设置为 {set_exe_ver}')
        else:
            no_bump_exe = True
            print(f'  EXE: 保持 {current_exe} 不变')
        print()

    # ---- Step 3: APK 版本控制 (默认: 不变) ----
    if need_apk:
        print('─' * 50)
        print(f'  Step 3/7 — APK 版本控制 (当前: {current_apk}):')
        print('    [默认] 不改变版本号 (直接回车)')
        print('    1) 自动递增 patch   (如 1.0.0 → 1.0.1)')
        print('    2) 自动递增 minor   (如 1.0.0 → 1.1.0)')
        print('    3) 自动递增 major   (如 1.0.0 → 2.0.0)')
        print('    4) 手动指定版本号')
        print('    5) 不改变版本号')
        choice = ask_int('  请输入序号 [默认:5]: ', 1, 5) or 5
        print()

        if choice == 1:
            bump_apk = 'patch'
            print(f'  APK: {current_apk} → patch 递增')
        elif choice == 2:
            bump_apk = 'minor'
            print(f'  APK: {current_apk} → minor 递增')
        elif choice == 3:
            bump_apk = 'major'
            print(f'  APK: {current_apk} → major 递增')
        elif choice == 4:
            set_apk_ver = ask_version('  请输入 APK 版本号 (X.Y.Z): ')
            print(f'  APK: 直接设置为 {set_apk_ver}')
        else:
            no_bump_apk = True
            print(f'  APK: 保持 {current_apk} 不变')
        print()

    # ---- Step 4: ZIP 打包 (默认: 否) ----
    print('─' * 50)
    print('  Step 4/7 — ZIP 打包:')
    print('    [默认] 不生成 ZIP (直接回车)')
    print('    1) 生成 ZIP 压缩包')
    print('    2) 不生成 ZIP')
    choice = ask_int('  请输入序号 [默认:2]: ', 1, 2) or 2
    no_zip = (choice == 2)
    print(f'  ZIP: {"不生成" if no_zip else "生成"}')
    print()

    # ---- Step 5: 输出目录 (默认: 默认目录) ----
    print('─' * 50)
    print(f'  Step 5/7 — 输出目录:')
    print(f'    [默认] 默认目录 (直接回车)')
    print(f'    1) 默认 ({DEFAULT_OUTPUT_DIR})')
    print(f'    2) 自定义')
    choice = ask_int('  请输入序号 [默认:1]: ', 1, 2) or 1
    if choice == 2:
        output_dir = input(f'  请输入输出目录路径: ').strip()
        if not output_dir:
            output_dir = DEFAULT_OUTPUT_DIR
    else:
        output_dir = DEFAULT_OUTPUT_DIR
    print(f'  输出目录: {output_dir}')
    print()

    # ---- Step 6: 是否清空输出文件夹 (默认: 保留) ----
    print('─' * 50)
    print(f'  Step 6/7 — 是否清空输出文件夹:')
    print('    [默认] 否，保留旧文件 (直接回车)')
    print('    1) 否，保留旧文件')
    print('    2) 是，清空输出文件夹')
    choice = ask_int('  请输入序号 [默认:1]: ', 1, 2) or 1
    clear_output = (choice == 2)
    print(f'  清空输出文件夹: {"是" if clear_output else "否"}')
    print()

    # ---- Step 6.5: 是否部署 PapaCheck.Site ----
    print('─' * 50)
    print(f'  Step 6.5/8 — 是否部署 PapaCheck.Site ({CLOUD_SERVER_IP}):')
    print('    [默认] 不部署 (直接回车)')
    print('    1) 部署到云端')
    print('    2) 不部署')
    choice = ask_int('  请输入序号 [默认:2]: ', 1, 2) or 2
    do_site = (choice == 1)
    print(f'  Site 部署: {"是" if do_site else "否"}')
    print()

    # ---- Step 7: 是否同步到云端 (新增) ----
    print('─' * 50)
    print(f'  Step 7/8 — 同步到云端服务器 ({CLOUD_SERVER_IP}):')
    print('    [默认] 不同步 (直接回车)')
    print('    1) 同步到云端')
    print('    2) 不同步')
    choice = ask_int('  请输入序号 [默认:2]: ', 1, 2) or 2
    do_cloud = (choice == 1)
    print(f'  云同步: {"是" if do_cloud else "否"}')
    print()

    # ---- 确认 ----
    print('=' * 50)
    print('  发布配置确认:')
    print(f'    构建目标: {"仅 EXE" if exe_only else "仅 APK" if apk_only else "完整发布 (EXE + APK)"}')

    if need_exe:
        if set_exe_ver:
            print(f'    EXE 版本: 设为 {set_exe_ver}')
        elif no_bump_exe:
            print(f'    EXE 版本: 不变 ({current_exe})')
        else:
            print(f'    EXE 版本: {bump_exe} 递增 (当前 {current_exe})')

    if need_apk:
        if set_apk_ver:
            print(f'    APK 版本: 设为 {set_apk_ver}')
        elif no_bump_apk:
            print(f'    APK 版本: 不变 ({current_apk})')
        else:
            print(f'    APK 版本: {bump_apk} 递增 (当前 {current_apk})')

    print(f'    ZIP 打包: {"否" if no_zip else "是"}')
    print(f'    输出目录: {output_dir}')
    print(f'    清空输出文件夹: {"是" if clear_output else "否"}')
    print(f'    Site 部署: {"是" if do_site else "否"}')
    print(f'    云同步: {"是" if do_cloud else "否"} ({CLOUD_SERVER_IP})')
    print('=' * 50)
    print()

    confirm = input('  确认执行? [Y/n] ').strip().lower()
    if confirm and confirm != 'y':
        print('  已取消')
        sys.exit(0)

    print()
    print('  开始执行发布流程...')
    print()

    if clear_output:
        if os.path.isdir(output_dir):
            for item in os.listdir(output_dir):
                item_path = os.path.join(output_dir, item)
                try:
                    if os.path.isfile(item_path) or os.path.islink(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                except Exception as e:
                    print(f'  [警告] 无法删除 {item_path}: {e}')
            print(f'  输出文件夹已清空: {output_dir}')
            print()

    return argparse.Namespace(
        exe_only=exe_only,
        apk_only=apk_only,
        node_only=False,
        bump_exe=bump_exe,
        bump_apk=bump_apk,
        set_exe_ver=set_exe_ver,
        set_apk_ver=set_apk_ver,
        no_bump_exe=no_bump_exe,
        no_bump_apk=no_bump_apk,
        no_zip=no_zip,
        output_dir=output_dir,
        cloud=do_cloud,
        cloud_only=False,
        site=do_site,
        v=None,
        _wizard=True,
    )


def check_better_sqlite3():
    """检查 better-sqlite3 是否需要重建，返回 True 表示需要重建"""
    try:
        subprocess.run(
            ['node', '-e', "require('better-sqlite3')"],
            cwd=NODE_DIR, capture_output=True, check=True)
        return False
    except (subprocess.CalledProcessError, FileNotFoundError):
        return True


def rebuild_better_sqlite3():
    """在 NODE_DIR 中执行 npm rebuild better-sqlite3"""
    run_step(1, 1, '重建 better-sqlite3 原生模块',
             'npm rebuild better-sqlite3', cwd=NODE_DIR, shell=True)


def main():
    args = parse_args()

    # 仅云同步模式
    if args.cloud_only:
        cloud_publish(CLOUD_SERVER_IP, CLOUD_SERVER_USER)
        return

    if getattr(args, '_wizard', False):
        # 引导模式：site 只是附加步骤，不影响主构建
        need_exe = args.exe_only or not (args.apk_only or args.node_only)
        need_apk = args.apk_only or not (args.exe_only or args.node_only)
    else:
        # CLI 模式：--site/--cloud-only 是排他标志
        need_exe = args.exe_only or not (args.apk_only or args.node_only or args.cloud_only or args.site)
        need_apk = args.apk_only or not (args.exe_only or args.node_only or args.cloud_only or args.site)
    need_node = args.node_only

    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    # ── 清理 ──
    if need_exe or need_apk:
        section('清理')
        if need_exe:
            pyinstaller_work_dir = os.path.join(WINDOWS_DIR, 'dist', 'PapaCheck')
            if os.path.isdir(pyinstaller_work_dir):
                shutil.rmtree(pyinstaller_work_dir)
                done('移除旧版 PyInstaller 构建目录')
        if need_apk and os.path.exists(APK_BUILD_OUTPUT):
            os.remove(APK_BUILD_OUTPUT)
            done('移除旧版 APK 构建产物')

    # ── 构建 ──
    if need_exe or need_apk:
        section('构建')
        steps = build_steps(args)
        for i, (desc, cmd, cwd, shell) in enumerate(steps, 1):
            run_step(i, len(steps), desc, cmd, cwd=cwd, shell=shell)

        if need_apk and not os.path.isfile(APK_BUILD_OUTPUT):
            print()
            print(f'  ✗ APK 构建产物未找到: {APK_BUILD_OUTPUT}')
            sys.exit(1)

    # ── 版本号 ──
    exe_ver = read_exe_version() if need_exe else ''
    apk_ver = read_apk_version() if need_apk else ''

    # ── 归档 ──
    zips = None
    if need_exe or need_apk:
        section('归档')
        apk_archive_path = None
        if need_apk:
            apk_archive_path = archive_apk(apk_ver)

        dist_exe_dir = DEFAULT_OUTPUT_DIR

        if not args.no_zip:
            if need_apk and need_exe:
                zips = create_zips(output_dir, exe_ver, apk_ver,
                                   apk_archive_path, dist_exe_dir)
            elif need_exe:
                exe_path = os.path.join(dist_exe_dir,
                                        f'PapaCheck-{exe_ver}.exe')
                win_zip = os.path.join(output_dir,
                                       f'PapaCheck-v{exe_ver}_win.zip')
                os.makedirs(output_dir, exist_ok=True)
                with zipfile.ZipFile(win_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
                    zf.write(exe_path, os.path.basename(exe_path))
                done(f'ZIP 打包 → {os.path.basename(win_zip)}')
                zips = [win_zip]
        else:
            done('跳过 ZIP 打包')

    # ── 后置处理 ──
    if need_exe or need_apk or need_node:
        section('后置处理')
        if check_better_sqlite3():
            done('better-sqlite3 需要重建')
            rebuild_better_sqlite3()
        else:
            done('better-sqlite3 已就绪，无需重建')

    # ── Site 部署 ──
    did_site = False
    if getattr(args, 'site', False):
        did_site = site_publish(CLOUD_SERVER_IP, CLOUD_SERVER_USER)

    # ── 云同步 ──
    did_cloud = False
    if args.cloud:
        did_cloud = cloud_publish(CLOUD_SERVER_IP, CLOUD_SERVER_USER)

    print_summary(output_dir, exe_ver, apk_ver, zips,
                  need_exe, need_apk, args.no_zip, did_cloud, did_site)


if __name__ == '__main__':
    main()
