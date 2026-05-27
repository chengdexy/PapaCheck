import subprocess
import sys
import os
import shutil
import argparse
import zipfile
import json
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
ANDROID_DIR = os.path.join(ROOT, 'PapaCheck.Android')
WINDOWS_DIR = os.path.join(ROOT, 'PapaCheck.Windows')
PUBSPEC = os.path.join(ANDROID_DIR, 'pubspec.yaml')
BUILD_CONFIG = os.path.join(WINDOWS_DIR, 'build_config.json')
APK_BUILD_OUTPUT = os.path.join(ANDROID_DIR, 'build', 'app', 'outputs',
                                'flutter-apk', 'app-release.apk')
APK_ARCHIVE_DIR = os.path.join(ANDROID_DIR, 'apk')
BUMP_VERSION_SCRIPT = os.path.join(WINDOWS_DIR, 'bump_version.py')
BUILD_EXE_SCRIPT = os.path.join(WINDOWS_DIR, 'build_exe.py')
DEFAULT_OUTPUT_DIR = os.path.join(WINDOWS_DIR, 'dist')

VERSION_RE = re.compile(r'^(\d+)\.(\d+)\.(\d+)$')


def parse_args():
    parser = argparse.ArgumentParser(
        description='PapaCheck 发布编排脚本 — 一站式构建 APK / EXE / ZIP 制品',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
使用示例:
  python release.py                              # 交互式引导模式
  python release.py --exe-only                   # 仅构建 Windows EXE，默认递增 patch
  python release.py --apk-only --set-apk-ver 2.0.0  # 仅构建 APK，指定版本号
  python release.py --bump-exe major --no-bump-apk  # 完整发布，EXE 升 major，APK 不升
  python release.py -v 1.5.0 --no-bump-exe       # 指定 APK 版本，不升 EXE 版本
  python release.py --no-zip                     # 完整发布但不创建 ZIP 包
  python release.py --output-dir D:\\releases     # 指定输出目录
''')

    build_group = parser.add_mutually_exclusive_group()
    build_group.add_argument('--exe-only', action='store_true',
                             help='仅构建 Windows EXE')
    build_group.add_argument('--apk-only', action='store_true',
                             help='仅构建 Android APK')

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

    need_exe = exe_only or (not apk_only)
    need_apk = apk_only or (not exe_only)

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


def run_step(desc, cmd, cwd=None, shell=False):
    print(f'[{desc}] 执行中...')
    rel = os.path.relpath(cwd or ROOT, ROOT) or '.'
    if shell:
        print(f'  cd {rel} && {cmd}')
        result = subprocess.run(cmd, cwd=cwd, shell=True)
    else:
        print(f'  cd {rel} && {" ".join(cmd)}')
        result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        print(f'[失败] {desc} (退出码: {result.returncode})')
        sys.exit(result.returncode)
    print(f'[完成] {desc}\n')


def build_steps(args):
    steps = []

    if args.exe_only or (not args.apk_only):
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

    if args.apk_only or (not args.exe_only):
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

    return steps


def archive_apk(apk_ver):
    os.makedirs(APK_ARCHIVE_DIR, exist_ok=True)
    dst = os.path.join(APK_ARCHIVE_DIR, f'PapaCheck-{apk_ver}.apk')
    shutil.copy2(APK_BUILD_OUTPUT, dst)
    print(f'APK 已归档: {dst}')
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
    print(f'APK 已复制到输出目录: {apk_dst}')

    full_zip = os.path.join(output_dir, f'PapaCheck-v{exe_ver}_full.zip')
    with zipfile.ZipFile(full_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe_path, os.path.basename(exe_path))
        zf.write(apk_dst, apk_name)
    print(f'full ZIP 已创建: {full_zip}')

    win_zip = os.path.join(output_dir, f'PapaCheck-v{exe_ver}_win.zip')
    with zipfile.ZipFile(win_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe_path, os.path.basename(exe_path))
    print(f'win ZIP 已创建: {win_zip}')

    return full_zip, win_zip


def print_summary(output_dir, exe_ver, apk_ver, zips, need_exe, need_apk, no_zip):
    exe_name = f'PapaCheck-{exe_ver}.exe'
    apk_name = f'PapaCheck-{apk_ver}.apk'

    print('=' * 48)
    print('  Release Complete!')
    print(f'  EXE version: {exe_ver}')
    print(f'  APK version: {apk_ver}')
    print(f'  Output directory: {output_dir}')
    print()
    print('  Artifacts:')
    if need_exe:
        print(f'    {os.path.join(output_dir, exe_name)}')
    if need_apk:
        print(f'    {os.path.join(output_dir, apk_name)}')
    if zips:
        for z in zips:
            print(f'    {z}')
    print('=' * 48)


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
    print('  Step 1/6 — 选择构建目标:')
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
        print(f'  Step 2/6 — EXE 版本控制 (当前: {current_exe}):')
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
        print(f'  Step 3/6 — APK 版本控制 (当前: {current_apk}):')
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
    print('  Step 4/6 — ZIP 打包:')
    print('    [默认] 不生成 ZIP (直接回车)')
    print('    1) 生成 ZIP 压缩包')
    print('    2) 不生成 ZIP')
    choice = ask_int('  请输入序号 [默认:2]: ', 1, 2) or 2
    no_zip = (choice == 2)
    print(f'  ZIP: {"不生成" if no_zip else "生成"}')
    print()

    # ---- Step 5: 输出目录 (默认: 默认目录) ----
    print('─' * 50)
    print(f'  Step 5/6 — 输出目录:')
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

    # ---- Step 6: 是否清空输出文件夹 (默认: 是) ----
    print('─' * 50)
    print(f'  Step 6/6 — 是否清空输出文件夹:')
    print('    [默认] 是，清空输出文件夹 (直接回车)')
    print('    1) 否，保留旧文件')
    print('    2) 是，清空输出文件夹')
    choice = ask_int('  请输入序号 [默认:2]: ', 1, 2) or 2
    clear_output = (choice == 2)
    print(f'  清空输出文件夹: {"是" if clear_output else "否"}')
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
        bump_exe=bump_exe,
        bump_apk=bump_apk,
        set_exe_ver=set_exe_ver,
        set_apk_ver=set_apk_ver,
        no_bump_exe=no_bump_exe,
        no_bump_apk=no_bump_apk,
        no_zip=no_zip,
        output_dir=output_dir,
        v=None,
    )


def main():
    args = parse_args()

    need_exe = args.exe_only or not args.apk_only
    need_apk = args.apk_only or not args.exe_only

    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    if need_exe:
        pyinstaller_work_dir = os.path.join(WINDOWS_DIR, 'dist', 'PapaCheck')
        if os.path.isdir(pyinstaller_work_dir):
            print('[清理] 删除旧的 dist/PapaCheck/ ...\n')
            shutil.rmtree(pyinstaller_work_dir)

    steps = build_steps(args)
    for i, (desc, cmd, cwd, shell) in enumerate(steps, 1):
        print(f'[{i}/{len(steps)}] ', end='')
        run_step(desc, cmd, cwd=cwd, shell=shell)

    if need_apk:
        if not os.path.isfile(APK_BUILD_OUTPUT):
            print(f'[错误] APK 构建产物未找到: {APK_BUILD_OUTPUT}')
            sys.exit(1)

    exe_ver = read_exe_version() if need_exe else ''
    apk_ver = read_apk_version() if need_apk else ''

    apk_archive_path = None
    if need_apk:
        apk_archive_path = archive_apk(apk_ver)

    dist_exe_dir = DEFAULT_OUTPUT_DIR

    zips = None
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
            print(f'win ZIP 已创建: {win_zip}')
            zips = [win_zip]
        elif need_apk:
            print('[提示] 仅构建 APK，跳过 ZIP 打包')

    print_summary(output_dir, exe_ver, apk_ver, zips,
                  need_exe, need_apk, args.no_zip)


if __name__ == '__main__':
    main()
