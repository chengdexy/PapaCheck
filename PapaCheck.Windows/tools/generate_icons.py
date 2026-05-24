from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'check_icon_v3_3_1.jpg')
WIN_ICO = os.path.join(ROOT, 'PapaCheck.Windows', 'icon.ico')
WEB_FAVICON = os.path.join(ROOT, 'PapaCheck.Web', 'favicon.png')
ANDROID_RES = os.path.join(ROOT, 'PapaCheck.Android', 'android', 'app', 'src', 'main', 'res')

ANDROID_LAUNCHER = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

ANDROID_FOREGROUND = {
    'drawable-mdpi': 108,
    'drawable-hdpi': 162,
    'drawable-xhdpi': 216,
    'drawable-xxhdpi': 324,
    'drawable-xxxhdpi': 432,
}

ICO_SIZES = [256, 128, 64, 48, 32, 16]

img = Image.open(SRC).convert('RGBA')

def resize_square(size):
    return img.resize((size, size), Image.Resampling.LANCZOS)

print('Generating Windows ICO...')
ico_images = [resize_square(s) for s in ICO_SIZES]
ico_images[0].save(WIN_ICO, format='ICO', sizes=[(s, s) for s in ICO_SIZES])
print(f'  -> {WIN_ICO}')

print('Generating Android launcher icons...')
for folder, size in ANDROID_LAUNCHER.items():
    path = os.path.join(ANDROID_RES, folder, 'ic_launcher.png')
    resize_square(size).save(path, 'PNG')
    print(f'  -> {path}')

print('Generating Android adaptive foreground icons...')
for folder, size in ANDROID_FOREGROUND.items():
    path = os.path.join(ANDROID_RES, folder, 'ic_launcher_foreground.png')
    resize_square(size).save(path, 'PNG')
    print(f'  -> {path}')

print('Generating Web favicon...')
resize_square(64).save(WEB_FAVICON, 'PNG')
print(f'  -> {WEB_FAVICON}')

print('Done!')
