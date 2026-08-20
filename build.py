# -*- coding: utf-8 -*-
"""
يبني ملف واحد dist/index.html فيه كل الـ CSS والـ JS جوّه،
عشان تقدر تفتح التطبيق من غير سيرفر أو ترفعه كملف واحد.

    python build.py
"""
import io, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def splice(html, pattern, block):
    """بيستبدل أول تطابق بالنص كما هو — من غير معالجة رموز الهروب في الكود."""
    m = re.search(pattern, html)
    if not m:
        raise SystemExit('مالقيتش الوسم: ' + pattern)
    return html[:m.start()] + block + html[m.end():]


html = read('index.html')

# CSS
html = splice(html,
              r'<link rel="stylesheet" href="assets/style\.css[^"]*">',
              '<style id="inline-css">\n' + read('assets/style.css').rstrip() + '\n</style>')

# JS — بنفس ترتيب index.html
for name in ['config', 'scheduler', 'api', 'app']:
    html = splice(html,
                  r'<script src="assets/%s\.js[^"]*"></script>' % name,
                  '<script id="inline-%s">\n' % name + read('assets/%s.js' % name).rstrip() + '\n</script>')

if re.search(r'(?:src|href)="assets/', html):
    raise SystemExit('فيه ملف لسه مش متدمج')

out = os.path.join(ROOT, 'dist')
if not os.path.isdir(out):
    os.makedirs(out)
with io.open(os.path.join(out, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(html)

print('dist/index.html  (%d KB)' % (len(html.encode('utf-8')) // 1024))
