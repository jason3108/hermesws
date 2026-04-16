#!/usr/bin/env python3
"""检查 Wiz 博客文章 Hero 区域的 DOM 结构"""
from playwright.sync_api import sync_playwright

TEST_ARTICLE = "github-actions-security-threat-model-and-defenses"
TEST_URL = f"https://www.wiz.io/blog/{TEST_ARTICLE}"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium-browser')
    context = browser.new_context(viewport={'width': 1280, 'height': 1024})
    page = context.new_page()

    page.goto(TEST_URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(5000)

    try:
        page.locator('button:has-text("Accept"), button:has-text("Accept all")').first.click(timeout=3000)
        page.wait_for_timeout(1000)
    except:
        pass

    # 获取 og:image
    og_image = page.evaluate('''() => {
        const meta = document.querySelector('meta[property="og:image"]');
        return meta ? meta.content : "";
    }''')
    print(f"OG Image: {og_image}")
    og_filename = og_image.split('/')[-1].split('?')[0]
    print(f"OG Filename: {og_filename}")

    # 找到 hero picture 并检查其 DOM 结构
    info = page.evaluate('''(ogFilename) => {
        const pictures = Array.from(document.querySelectorAll('picture'));

        // 找到包含 og:image 的 picture
        const heroPic = pictures.find(pic => pic.innerHTML.includes(ogFilename));
        if (!heroPic) return { error: 'hero picture not found', count: pictures.length };

        // 向上追溯 DOM 结构
        const path = [];
        let el = heroPic;
        for (let i = 0; i < 10; i++) {
            const parent = el.parentElement;
            if (!parent) break;
            const tag = parent.tagName.toLowerCase();
            const cls = parent.className || '';
            const id = parent.id || '';
            const rect = parent.getBoundingClientRect();
            path.push({
                tag, cls: cls.substring(0, 120), id,
                w: Math.round(rect.width), h: Math.round(rect.height),
                children: parent.children.length
            });
            el = parent;
            if (tag === 'article' || tag === 'main') break;
        }

        // picture 的直接父元素信息
        const picParent = heroPic.parentElement;
        const picParentRect = picParent.getBoundingClientRect();

        return {
            path,
            picParent: {
                tag: picParent.tagName.toLowerCase(),
                cls: picParent.className,
                w: Math.round(picParentRect.width),
                h: Math.round(picParentRect.height),
                style: picParent.getAttribute('style') || '',
                children: picParent.children.length,
                childTags: Array.from(picParent.children).map(c => c.tagName.toLowerCase())
            }
        };
    }''', og_filename)
    print(f"\nHero picture DOM path:\n{info}")
    browser.close()
