import sys, os, re, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBSPEC = os.path.join(ROOT, 'PapaCheck.Android', 'pubspec.yaml')
BUILD_CONFIG = os.path.join(ROOT, 'PapaCheck.Windows', 'build_config.json')


def show_help():
    print("""用法: python bump_version.py [--target apk|exe] [action|--set X.Y.Z]

选项:
  --target apk|exe  操作目标。默认: apk
  --help, -h        显示此帮助信息

操作 (action):
  patch             递增补丁版本号 (默认)
  minor             递增次版本号
  major             递增主版本号

设置版本:
  --set X.Y.Z       直接设置版本号 (对于 APK，构建号仍会 +1)

示例:
  python bump_version.py                         # APK: patch 递增
  python bump_version.py minor                   # APK: minor 递增
  python bump_version.py --set 1.2.3             # APK: 设置为 1.2.3
  python bump_version.py --target exe            # EXE: patch 递增
  python bump_version.py --target exe minor      # EXE: minor 递增
  python bump_version.py --target exe --set 1.2.3  # EXE: 设置为 1.2.3""")
    sys.exit(0)


def parse_args():
    args = sys.argv[1:]

    if '--help' in args or '-h' in args:
        show_help()

    target = 'apk'
    remaining = []
    i = 0
    while i < len(args):
        if args[i] == '--target':
            if i + 1 >= len(args):
                print('错误: --target 需要指定 apk 或 exe')
                sys.exit(1)
            target = args[i + 1]
            if target not in ('apk', 'exe'):
                print(f'错误: 无效的目标 "{target}"，应为 apk 或 exe')
                sys.exit(1)
            i += 2
        else:
            remaining.append(args[i])
            i += 1

    action = 'patch'
    set_version = None

    if len(remaining) >= 2 and remaining[0] == '--set':
        set_version = remaining[1]
    elif len(remaining) >= 1:
        action = remaining[0]
        if action not in ('patch', 'minor', 'major'):
            print(f'错误: 无效的操作 "{action}"，应为 patch/minor/major')
            sys.exit(1)

    return target, action, set_version


def bump_apk(action, set_version):
    with open(PUBSPEC, 'r', encoding='utf-8') as f:
        content = f.read()

    m = re.search(r'^version:\s*(\d+)\.(\d+)\.(\d+)\+(\d+)', content, re.MULTILINE)
    if not m:
        print('错误: 无法解析 pubspec.yaml 中的版本号')
        sys.exit(1)

    major, minor, patch, build = int(m[1]), int(m[2]), int(m[3]), int(m[4])
    old_version = f'{major}.{minor}.{patch}+{build}'

    if set_version:
        sm = re.match(r'^(\d+)\.(\d+)\.(\d+)$', set_version)
        if not sm:
            print('错误: 版本号格式应为 X.Y.Z，如 1.0.2')
            sys.exit(1)
        major, minor, patch = int(sm[1]), int(sm[2]), int(sm[3])
        build += 1
    else:
        if action == 'major':
            major += 1; minor = 0; patch = 0
        elif action == 'minor':
            minor += 1; patch = 0
        else:
            patch += 1
        build += 1

    new_version = f'{major}.{minor}.{patch}+{build}'
    content = content.replace(f'version: {old_version}', f'version: {new_version}')

    with open(PUBSPEC, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f'{old_version} → {new_version}')


def bump_exe(action, set_version):
    if os.path.exists(BUILD_CONFIG):
        with open(BUILD_CONFIG, 'r', encoding='utf-8') as f:
            config = json.load(f)
    else:
        config = {}

    version_str = config.get('exe_version', '1.0.0')
    major, minor, patch = map(int, version_str.split('.'))

    if set_version:
        sm = re.match(r'^(\d+)\.(\d+)\.(\d+)$', set_version)
        if not sm:
            print('错误: 版本号格式应为 X.Y.Z，如 1.0.2')
            sys.exit(1)
        major, minor, patch = int(sm[1]), int(sm[2]), int(sm[3])
    else:
        if action == 'major':
            major += 1; minor = 0; patch = 0
        elif action == 'minor':
            minor += 1; patch = 0
        else:
            patch += 1

    new_version = f'{major}.{minor}.{patch}'
    config['exe_version'] = new_version

    with open(BUILD_CONFIG, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f'{version_str} → {new_version}')


def main():
    target, action, set_version = parse_args()

    if target == 'exe':
        bump_exe(action, set_version)
    else:
        bump_apk(action, set_version)


if __name__ == '__main__':
    main()
