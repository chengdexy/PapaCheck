import subprocess, sys, os, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))

HELP = '''
用法:
  python release.py              递增 Z 版本 (1.0.0 → 1.0.1) 并完整发布
  python release.py -v X.Y.Z     指定版本号并完整发布
  python release.py --exe-only   只打包 Windows EXE (不改版本号)
  python release.py --apk-only   只构建 Android APK (递增 Z 版本)
  python release.py -h           显示本帮助

示例:
  python release.py              # 修复小 bug，版本 1.0.0 → 1.0.1
  python release.py -v 2.0.0     # 大版本发布
  python release.py --exe-only   # 只改了 Windows 代码
  python release.py -v 2.0.0 --apk-only   # 指定版本号只构建 APK
'''.strip()

args = sys.argv[1:]
if '-h' in args or '--help' in args:
    print(HELP)
    sys.exit(0)

exe_only = '--exe-only' in args
apk_only = '--apk-only' in args
args = [a for a in args if a not in ('--exe-only', '--apk-only')]

full = not exe_only and not apk_only

set_ver = ''
if len(args) >= 2 and args[0] == '-v':
    set_ver = args[1]

DIST_DIR = os.path.join(ROOT, 'PapaCheck.Windows', 'dist', 'PapaCheck')
if os.path.isdir(DIST_DIR) and os.path.basename(DIST_DIR) == 'PapaCheck':
    print('[清理] 删除旧的 dist/PapaCheck/ ...')
    shutil.rmtree(DIST_DIR)
    print()

steps = []
if apk_only or full:
    bump_cmd = [sys.executable, os.path.join(ROOT, 'PapaCheck.Windows', 'bump_version.py')]
    if set_ver:
        bump_cmd += ['--set', set_ver]
    steps.append(('递增版本号', bump_cmd))
    steps.append(('构建 Android APK', ['flutter', 'build', 'apk', '--release']))
if exe_only or full:
    steps.append(('打包 Windows EXE', [sys.executable, os.path.join(ROOT, 'PapaCheck.Windows', 'build_exe.py')]))

for i, (desc, cmd) in enumerate(steps, 1):
    step_num = 2 if (apk_only or full) and i == 2 else i
    cwd = os.path.join(ROOT, 'PapaCheck.Android') if step_num == 2 else ROOT
    print(f'[{i}/{len(steps)}] {desc}...')
    print(f'  cd {os.path.relpath(cwd, ROOT) or "."} && ' + ' '.join(cmd))
    shell = (step_num == 2)
    result = subprocess.run(cmd if not shell else ' '.join(cmd), cwd=cwd, shell=shell)
    if result.returncode != 0:
        print(f'失败: {desc}')
        sys.exit(result.returncode)
    print()

print('=' * 48)
print('  发布完成!')
if exe_only or full:
    print(f'  EXE: PapaCheck.Windows\\dist\\PapaCheck.exe')
if apk_only or full:
    print(f'  APK: PapaCheck.Android\\apk\\PapaCheck-*.apk')
print('=' * 48)
