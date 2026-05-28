import subprocess
import os
import sys
import shutil
import re
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(ROOT, 'PapaCheck.Server')
EMAIL_DIR = os.path.join(ROOT, 'PapaCheck.Email')
WEB_DIR = os.path.join(ROOT, 'PapaCheck.Web')
WORK_DIR = os.path.join(ROOT, 'PapaCheck.Windows')

build_config_path = os.path.join(WORK_DIR, 'build_config.json')
exe_version = '1.0.0'
if os.path.exists(build_config_path):
    with open(build_config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
        exe_version = config.get('exe_version', '1.0.0')
print(f'EXE 版本: {exe_version}')

# --- APK 处理 ---
pubspec_path = os.path.join(ROOT, 'PapaCheck.Android', 'pubspec.yaml')
apk_version = '0.0.0'
if os.path.exists(pubspec_path):
    with open(pubspec_path, 'r', encoding='utf-8') as f:
        m = re.search(r'^version:\s*(\S+)', f.read(), re.MULTILINE)
        if m:
            apk_version = m.group(1).split('+')[0]
print(f'Android 端版本: {apk_version}')

APK_SRC = os.path.join(ROOT, 'PapaCheck.Android', 'build', 'app', 'outputs',
                       'flutter-apk', 'app-release.apk')
APK_DIR = os.path.join(ROOT, 'PapaCheck.Android', 'apk')
APK_DST = os.path.join(APK_DIR, f'PapaCheck-{apk_version}.apk')
WEB_APK_DIR = os.path.join(WEB_DIR, 'apk')
WEB_APK_DST = os.path.join(WEB_APK_DIR, f'PapaCheck-{apk_version}.apk')

apk_add_data = []
if os.path.exists(APK_SRC):
    apk_mtime = os.path.getmtime(APK_SRC)
    pubspec_mtime = os.path.getmtime(pubspec_path) if os.path.exists(pubspec_path) else 0
    if pubspec_mtime > apk_mtime:
        print(f'[警告] pubspec.yaml 比 APK 构建产物更新，APK 可能版本不一致！')
        print(f'  pubspec.yaml 修改时间: {pubspec_mtime}')
        print(f'  app-release.apk 修改时间: {apk_mtime}')
        print(f'  建议先执行 flutter build apk --release 重新构建 APK')

    os.makedirs(APK_DIR, exist_ok=True)
    shutil.copy2(APK_SRC, APK_DST)
    os.makedirs(WEB_APK_DIR, exist_ok=True)
    shutil.copy2(APK_SRC, WEB_APK_DST)
    for d in (APK_DIR, WEB_APK_DIR):
        for fname in os.listdir(d):
            full = os.path.join(d, fname)
            if os.path.isfile(full) and fname.startswith('PapaCheck-') and fname.endswith('.apk'):
                if fname != f'PapaCheck-{apk_version}.apk':
                    os.remove(full)
    apk_add_data = ['--add-data', f'{WEB_APK_DIR};Web{os.sep}apk']
    print(f'APK 已准备: PapaCheck-{apk_version}.apk')
else:
    print('[警告] APK 文件不存在，EXE 将不包含 APK 分发')
    print('  请先构建 APK 后再运行 build_exe.py:')
    print('  1. bump_version.py --target apk patch')
    print('  2. cd PapaCheck.Android && flutter build apk --release')

exe_version_tuple = tuple(int(x) for x in exe_version.split('.'))
if len(exe_version_tuple) < 4:
    exe_version_tuple = exe_version_tuple + (0,) * (4 - len(exe_version_tuple))

version_file_content = f"""# UTF-8
#
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=({exe_version_tuple[0]},{exe_version_tuple[1]},{exe_version_tuple[2]},{exe_version_tuple[3]}),
    prodvers=({exe_version_tuple[0]},{exe_version_tuple[1]},{exe_version_tuple[2]},{exe_version_tuple[3]}),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo(
      [
        StringTable(
          u'040904B0',
          [StringStruct(u'FileVersion', u'{exe_version_tuple[0]}.{exe_version_tuple[1]}.{exe_version_tuple[2]}.{exe_version_tuple[3]}'),
           StringStruct(u'ProductVersion', u'{exe_version_tuple[0]}.{exe_version_tuple[1]}.{exe_version_tuple[2]}.{exe_version_tuple[3]}'),
           StringStruct(u'FileDescription', u'PapaCheck'),
           StringStruct(u'ProductName', u'PapaCheck'),
           StringStruct(u'LegalCopyright', u'Copyright (c) PapaCheck'),
           StringStruct(u'OriginalFilename', u'PapaCheck-{exe_version}.exe')])
      ]),
    VarFileInfo([VarStruct(u'Translation', [1033, 1200])])
  ]
)
"""

version_file_path = os.path.join(WORK_DIR, 'version_info.txt')
with open(version_file_path, 'w', encoding='utf-8') as f:
    f.write(version_file_content)

cmd = [
    sys.executable, '-m', 'PyInstaller',
    '--onefile',
    '--windowed',
    '--name', 'PapaCheck',
    '--icon', os.path.join(WORK_DIR, 'icon.ico'),
    '--paths', SERVER_DIR,
    '--paths', EMAIL_DIR,
    '--add-data', f'{SERVER_DIR};Server',
    '--add-data', f'{WEB_DIR};Web',
    '--add-data', f'{os.path.join(WORK_DIR, "icon.ico")};.',
    *apk_add_data,
    '--hidden-import', 'db',
    '--hidden-import', 'email_client',
    '--hidden-import', 'edge_tts',
    '--hidden-import', 'asyncio',
    '--noconfirm',
    '--version-file', version_file_path,
    os.path.join(WORK_DIR, 'app_gui.py'),
]

print('PyInstaller command:')
print(' '.join(cmd))
print()

result = subprocess.run(cmd, cwd=WORK_DIR)

if result.returncode == 0:
    exe_src = os.path.join(WORK_DIR, 'dist', 'PapaCheck.exe')
    exe_dst = os.path.join(WORK_DIR, 'dist', f'PapaCheck-{exe_version}.exe')
    if os.path.exists(exe_src):
        if os.path.exists(exe_dst):
            os.remove(exe_dst)
        os.rename(exe_src, exe_dst)

    dist_dir = os.path.join(WORK_DIR, 'dist')
    for fname in os.listdir(dist_dir):
        full = os.path.join(dist_dir, fname)
        if os.path.isfile(full) and fname.startswith('PapaCheck-') and fname.endswith('.exe'):
            if fname != f'PapaCheck-{exe_version}.exe':
                os.remove(full)

    print(f'EXE 已构建: PapaCheck-{exe_version}.exe')

sys.exit(result.returncode)
