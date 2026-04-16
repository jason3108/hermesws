#!/usr/bin/env python3
"""
Wiz 云安全相关文章离线存档 - 去除 Hero 封面图（强制高度塌陷）
"""
import os
from playwright.sync_api import sync_playwright

BLOG_DIR = "/home/ubuntu/hermes/blog"

ARTICLES = [
    {
        "slug": "github-actions-security-threat-model-and-defenses",
        "url": "https://www.wiz.io/blog/github-actions-security-threat-model-and-defenses",
    },
    {
        "slug": "twenty-years-of-cloud-security-research",
        "url": "https://www.wiz.io/blog/twenty-years-of-cloud-security-research",
    },
    {
        "slug": "fedramp-incident-response",
        "url": "https://www.wiz.io/blog/fedramp-incident-response",
    },
    {
        "slug": "wiz-tenant-manager-multi-tenant-security",
        "url": "https://www.wiz.io/blog/wiz-tenant-manager-multi-tenant-security",
    },
]

for article in ARTICLES:
    slug = article["slug"]
    url = article["url"]
    pdf_path = os.path.join(BLOG_DIR, f"{slug}.pdf")

    print(f"\n[START] {slug}")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path='/usr/bin/chromium-browser'
        )
        context = browser.new_context(viewport={'width': 1280, 'height': 1024})
        page = context.new_page()

        page.goto(url, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(5000)

        try:
            page.locator('button:has-text("Accept"), button:has-text("Accept all"), button:has-text("Continue")').first.click(timeout=3000)
            page.wait_for_timeout(1000)
        except:
            pass

        # 关键：隐藏整个 hero 容器（不只 picture），并强制其高度为 0
        page.evaluate('''() => {
            // 1. 从 og:image 获取 hero 文件名
            const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
            const ogPath = ogImage.split('?')[0];
            const ogFilename = ogPath.substring(ogPath.lastIndexOf('/') + 1);
            console.log('OG filename:', ogFilename);

            // 2. 找到 hero picture 所在的顶级 hero 容器并完全移除
            document.querySelectorAll('picture').forEach(pic => {
                if (!pic.innerHTML.includes(ogFilename)) return;

                const parent = pic.parentElement;
                const parentClass = parent?.className || '';
                // 排除头像
                if (parentClass.includes('!h-10') || parentClass.includes('!w-10')) return;

                // 向上找到最近的 article/main 祖先下面的直接子元素
                // 这个直接子元素就是 hero 容器
                let heroContainer = pic;
                let container = pic.parentElement;

                while (container) {
                    const tag = container.tagName.toLowerCase();
                    const cls = container.className || '';
                    // 停在 article 或 main
                    if (tag === 'article' || tag === 'main') break;
                    heroContainer = container;
                    container = container.parentElement;
                }

                const tagName = heroContainer.tagName.toLowerCase();
                console.log('Found hero container:', tagName, heroContainer.className.substring(0, 100));

                // 完全移除这个 hero 容器
                heroContainer.remove();
                console.log('Hero container removed from DOM');
            });

            // 3. 强制显示其余 hidden 元素（保留文章内容）
            document.querySelectorAll('.hidden').forEach(el => {
                el.classList.remove('hidden');
                el.style.display = '';
                el.style.visibility = '';
                el.style.opacity = '';
            });

            // 4. 注入防分页 CSS
            const style = document.createElement('style');
            style.textContent = `
                .hidden { display: block !important; visibility: visible !important; opacity: 1 !important; }
                figure, picture, img, div[class*="relative"] {
                    break-inside: avoid !important;
                    page-break-inside: avoid !important;
                    break-after: avoid !important;
                    page-break-after: avoid !important;
                }
                @media print {
                    .hidden { display: block !important; visibility: visible !important; }
                    figure, picture, img, div[class*="relative"] {
                        break-inside: avoid !important;
                        -webkit-column-break-inside: avoid !important;
                        page-break-inside: avoid !important;
                    }
                }
            `;
            document.head.appendChild(style);
        }''')

        # 多轮缓慢滚动
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
            return { total: imgs.length, large: large.length };
        }''')
        print(f"  Images: {img_info['total']} total, {img_info['large']} large")

        try:
            page.wait_for_function('''() => {
                const imgs = Array.from(document.querySelectorAll("img"));
                return imgs.filter(img => !img.complete).length === 0;
            }''', timeout=30000)
        except:
            pass
        page.wait_for_timeout(2000)

        page.pdf(path=pdf_path, format='A4', print_background=True,
                 margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
        size = os.path.getsize(pdf_path)
        print(f"  Saved: {pdf_path} ({size // 1024}KB)")

        browser.close()

print("\n[ALL DONE]")
