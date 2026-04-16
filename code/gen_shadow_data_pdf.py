#!/usr/bin/env python3
"""生成Wiz博客文章PDF - 去掉开头Hero图形"""

import os
from playwright.sync_api import sync_playwright

blog_dir = "/home/ubuntu/hermes/blog"
slug = "introducing-shadow-data-detection-in-wiz"
url = f"https://www.wiz.io/blog/{slug}"
pdf_path = os.path.join(blog_dir, f"{slug}.pdf")

print(f"Processing: {url}")

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path='/usr/bin/chromium-browser'
    )
    context = browser.new_context(viewport={'width': 1280, 'height': 1024})
    page = context.new_page()

    # 直接访问live URL
    page.goto(url, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(5000)

    # 关闭cookie弹窗（如果有）
    try:
        page.locator('button:has-text("Accept"), button:has-text("Accept all"), button:has-text("Continue")').first.click(timeout=3000)
        page.wait_for_timeout(1000)
    except:
        pass

    # 注入CSS：隐藏开头Hero图形，并防止图片分页
    page.evaluate('''() => {
        // 隐藏开头的hero/cover图片区域
        // 常见hero容器类名模式
        const hideSelectors = [
            'article header figure',           // 文章头部figure（通常含cover图）
            'article header picture',           // 文章头部picture
            'article header div[class*="aspect"]', // 常用aspect-ratio容器
            '.article-header picture',          // 文章头部
            '[class*="article-header"] picture',
            '[class*="hero"] picture',
            '[class*="Hero"] picture',
            'header picture',                  // 页头图片
            // 隐藏包含og:image的picture（通常是cover）
            'picture[src*="datocms"]',
            // 隐藏文章开头的大图（通常在第一个h1之前的figure）
            'article > figure:first-of-type',
            'article > div > figure:first-of-type',
        ];

        let hiddenCount = 0;
        hideSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                el.style.display = 'none';
                el.setAttribute('data-hidden', 'true');
                hiddenCount++;
            });
        });
        console.log('Hidden elements:', hiddenCount);

        // 注入防分页CSS
        const style = document.createElement('style');
        style.textContent = `
            .hidden { display: none !important; visibility: hidden !important; opacity: 0 !important; }
            figure, picture, img, div[class*="relative"] {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
                break-after: avoid !important;
                page-break-after: avoid !important;
            }
            @media print {
                .hidden { display: none !important; visibility: hidden !important; }
                figure, picture, img, div[class*="relative"] {
                    break-inside: avoid !important;
                    -webkit-column-break-inside: avoid !important;
                    page-break-inside: avoid !important;
                }
            }
        `;
        document.head.appendChild(style);
    }''')

    # 多轮缓慢滚动，强制所有图片加载
    total_height = page.evaluate('document.body.scrollHeight')
    for round_num in range(4):
        for y in range(0, int(total_height), 400):
            page.evaluate(f'window.scrollTo(0, {y})')
            page.wait_for_timeout(200)
        page.wait_for_timeout(1000)

    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(5000)

    # 验证图片加载
    img_info = page.evaluate('''() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        const large = imgs.filter(img => img.naturalWidth > 1000);
        const hidden = document.querySelectorAll('[data-hidden="true"]').length;
        return {
            total: imgs.length,
            large: large.length,
            loaded: imgs.filter(img => img.complete).length,
            hidden: hidden,
            rmiz_found: document.querySelectorAll('[data-rmiz-content="found"]').length,
            rmiz_not_found: document.querySelectorAll('[data-rmiz-content="not-found"]').length
        };
    }''')
    print(f"  Images: {img_info['total']} total, {img_info['large']} large, {img_info['loaded']} loaded")
    print(f"  Hidden: {img_info['hidden']}, rmiz found: {img_info['rmiz_found']}, not-found: {img_info['rmiz_not_found']}")

    # 等待所有图片加载完成
    try:
        page.wait_for_function('''() => {
            const imgs = Array.from(document.querySelectorAll("img"));
            return imgs.filter(img => !img.complete).length === 0;
        }''', timeout=30000)
    except:
        pass

    page.wait_for_timeout(2000)

    # 生成PDF
    page.pdf(path=pdf_path, format='A4', print_background=True,
             margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
    size = os.path.getsize(pdf_path)
    print(f"  Saved: {pdf_path} ({size // 1024}KB)")

    browser.close()

print("\nDone!")
