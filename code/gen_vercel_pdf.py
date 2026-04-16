#!/usr/bin/env python3
"""生成Wiz博客文章PDF - 通用方案：隐藏og:image对应的Hero图形"""

import os
from playwright.sync_api import sync_playwright

blog_dir = "/home/ubuntu/hermes/blog"
slug = "introducing-wiz-vercel-integration"
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

    page.goto(url, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(5000)

    # 关闭cookie弹窗
    try:
        page.locator('button:has-text("Accept"), button:has-text("Accept all"), button:has-text("Continue")').first.click(timeout=3000)
        page.wait_for_timeout(1000)
    except:
        pass

    # 通用方案：通过og:image URL + parent class排除法找hero并隐藏
    page.evaluate('''() => {
        // 1. 获取og:image完整URL（不含查询参数的文件名）
        const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
        // 提取不含?的路径部分的文件名
        const ogPath = ogImage.split('?')[0];
        const ogFilename = ogPath.substring(ogPath.lastIndexOf('/') + 1);
        console.log('OG Filename:', ogFilename);

        // 2. 隐藏匹配og:image的picture，且父元素不是头像类（!h-10 !w-10）
        let hiddenCount = 0;
        document.querySelectorAll('picture').forEach(pic => {
            const picHtml = pic.innerHTML;
            const parent = pic.parentElement;
            const parentClass = parent?.className || '';
            // 排除头像：父类含!h-10 !w-10 (author avatar)
            const isAvatar = parentClass.includes('!h-10') || parentClass.includes('!w-10');
            if (picHtml.includes(ogFilename) && !isAvatar) {
                pic.style.display = 'none';
                pic.setAttribute('data-hero-hidden', 'true');
                hiddenCount++;
                console.log('Hidden hero picture, parent:', parentClass);
            }
        });

        // 3. 兜底：隐藏所有hidden lg:block的图片容器
        document.querySelectorAll('picture').forEach(pic => {
            if (pic.hasAttribute('data-hero-hidden')) return;
            const parent = pic.parentElement;
            const parentClass = parent?.className || '';
            const grandparentClass = parent?.parentElement?.className || '';
            // 响应式隐藏的大图：hidden lg:block 且非头像
            if (parentClass.includes('hidden') && parentClass.includes('lg:block') && !parentClass.includes('!h-10')) {
                pic.style.display = 'none';
                pic.setAttribute('data-hero-hidden', 'true');
                hiddenCount++;
            }
        });

        console.log('Total hidden:', hiddenCount);

        // 4. 注入防分页CSS
        const style = document.createElement('style');
        style.textContent = `
            [data-hero-hidden] { display: none !important; }
            figure, picture, img, div[class*="relative"] {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
                break-after: avoid !important;
                page-break-after: avoid !important;
            }
            @media print {
                [data-hero-hidden] { display: none !important; }
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

    # 验证
    img_info = page.evaluate('''() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        const large = imgs.filter(img => img.naturalWidth > 1000);
        return {
            total: imgs.length,
            large: large.length,
            loaded: imgs.filter(img => img.complete).length,
            hero_hidden: document.querySelectorAll('[data-hero-hidden="true"]').length,
            rmiz_found: document.querySelectorAll('[data-rmiz-content="found"]').length,
            rmiz_not_found: document.querySelectorAll('[data-rmiz-content="not-found"]').length
        };
    }''')
    print(f"  Images: {img_info['total']} total, {img_info['large']} large, {img_info['loaded']} loaded")
    print(f"  Hero hidden: {img_info['hero_hidden']}")
    print(f"  rmiz found: {img_info['rmiz_found']}, not-found: {img_info['rmiz_not_found']}")

    # 等待图片加载完成
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
