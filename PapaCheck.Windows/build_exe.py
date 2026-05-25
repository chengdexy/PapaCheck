import subprocess
import os
import sys
import shutil
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(ROOT, 'PapaCheck.Server')
EMAIL_DIR = os.path.join(ROOT, 'PapaCheck.Email')
WEB_DIR = os.path.join(ROOT, 'PapaCheck.Web')
WORK_DIR = os.path.join(ROOT, 'PapaCheck.Windows')

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
    print('APK 文件不存在')
    print('  1. bump_version.py  更新版本号')
    print('  2. cd PapaCheck.Android && flutter build apk --release')
    print('  3. 重新运行 build_exe.py')
    ans = input('  是否跳过 APK 继续打包？[y/N] ').strip().lower()
    if ans != 'y':
        sys.exit(0)

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
    os.path.join(WORK_DIR, 'app_gui.py'),
]

print('PyInstaller command:')
print(' '.join(cmd))
print()

result = subprocess.run(cmd, cwd=WORK_DIR)
sys.exit(result.returncode)
