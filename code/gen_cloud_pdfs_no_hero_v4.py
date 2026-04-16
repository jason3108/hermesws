#!/usr/bin/env python3
"""
Wiz 云安全相关文章离线存档 - 去除 Hero 封面图（精确隐藏）
Hero picture 位于 hero 容器内，隐藏整行侧边栏 div（含图片+侧边信息）
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

        # 关键修复：精确隐藏 Hero 区域，不破坏 DOM 结构
        hide_result = page.evaluate('''() => {
            const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
            const ogPath = ogImage.split('?')[0];
            const ogFilename = ogPath.substring(ogPath.lastIndexOf('/') + 1);
            console.log('OG filename:', ogFilename);

            let hiddenCount = 0;

            document.querySelectorAll('picture').forEach(pic => {
                if (!pic.innerHTML.includes(ogFilename)) return;

                const parent = pic.parentElement;
                if (!parent) return;
                const cls = parent.className || '';
                // 排除头像（通常有 !h-10 !w-10 类）
                if (cls.includes('!h-10') || cls.includes('!w-10')) return;
                // 排除作者头像的父元素
                if (cls.includes('author-avatar')) return;

                // 策略：找到包含此 picture 的「行级容器」（grid 列）
                // hero picture 位于 hero 行的左侧列，需要隐藏整行
                // hero行结构通常是：div.grid > div(左: hero+picture) + div(右: 文章标题等)
                // 向上追溯：picture → picture.parent → .z-[1] div(max-h-[470px]) → 整个 grid 列 div

                // 找到 .z-[1] hidden max-h-[470px] 的那个 div（picture 的父元素）
                const heroCell = parent; // class="z-[1] hidden max-h-[470px] rounded-xl lg:block"
                const heroCellStyle = heroCell.getAttribute('style') || '';
                const heroCellClass = heroCell.className;

                // 向上找到 grid 的直接子元素（grid 列 = 整行的一侧）
                // picture.parent.parent 应该是 grid 列 div
                let gridCell = heroCell.parentElement; // min-w-0 div
                if (!gridCell) return;

                // 隐藏整列（hero 图片 + 右侧标题区）
                gridCell.style.visibility = 'hidden';
                gridCell.style.display = 'none';
                gridCell.style.height = '0';
                gridCell.style.overflow = 'hidden';

                hiddenCount++;
                console.log('Hidden hero cell, parent class:', gridCell.className.substring(0, 80));
            });

            // 强制显示其余 .hidden 元素（保留文章内容）
            document.querySelectorAll('.hidden').forEach(el => {
                el.classList.remove('hidden');
                el.style.display = '';
                el.style.visibility = '';
                el.style.opacity = '';
            });

            // 注入防分页 CSS
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

            return { hiddenCount };
        }''')
        print(f"  Hero hide: {hide_result}")

        # 多轮缓慢滚动，触发懒加载图片
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