import sys, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBSPEC = os.path.join(ROOT, 'PapaCheck.Android', 'pubspec.yaml')

with open(PUBSPEC, 'r', encoding='utf-8') as f:
    content = f.read()

m = re.search(r'^version:\s*(\d+)\.(\d+)\.(\d+)\+(\d+)', content, re.MULTILINE)
if not m:
    print('错误: 无法解析 pubspec.yaml 中的版本号')
    sys.exit(1)

major, minor, patch, build = int(m[1]), int(m[2]), int(m[3]), int(m[4])
old_version = f'{major}.{minor}.{patch}+{build}'

if len(sys.argv) >= 3 and sys.argv[1] == '--set':
    target = sys.argv[2]
    sm = re.match(r'^(\d+)\.(\d+)\.(\d+)$', target)
    if not sm:
        print('错误: 版本号格式应为 X.Y.Z，如 1.0.2')
        sys.exit(1)
    major, minor, patch = int(sm[1]), int(sm[2]), int(sm[3])
    build += 1
else:
    action = sys.argv[1] if len(sys.argv) > 1 else 'patch'
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
