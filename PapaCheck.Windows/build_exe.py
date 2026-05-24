import subprocess
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(ROOT, 'PapaCheck.Server')
WEB_DIR = os.path.join(ROOT, 'PapaCheck.Web')
WORK_DIR = os.path.join(ROOT, 'PapaCheck.Windows')

cmd = [
    sys.executable, '-m', 'PyInstaller',
    '--onefile',
    '--windowed',
    '--name', 'PapaCheck',
    '--icon', os.path.join(WORK_DIR, 'icon.ico'),
    '--paths', SERVER_DIR,
    '--add-data', f'{SERVER_DIR};PapaCheck.Server',
    '--add-data', f'{WEB_DIR};PapaCheck.Web',
    '--add-data', f'{os.path.join(WORK_DIR, "icon.png")};.',
    '--hidden-import', 'db',
    '--hidden-import', 'edge_tts',
    '--hidden-import', 'asyncio',
    '--clean',
    '--noconfirm',
    os.path.join(WORK_DIR, 'app_gui.py'),
]

print('PyInstaller command:')
print(' '.join(cmd))
print()

result = subprocess.run(cmd, cwd=WORK_DIR)
sys.exit(result.returncode)
