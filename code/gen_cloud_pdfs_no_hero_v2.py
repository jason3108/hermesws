#!/usr/bin/env python3
"""
Wiz 云安全相关文章离线存档 - 去除 Hero 封面图（完全占位）
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

        # 去除 Hero - 关键：找到并隐藏整个 hero 容器，而不只是 picture
        page.evaluate('''() => {
            // 1. 从 og:image 获取 hero 文件名
            const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
            const ogPath = ogImage.split('?')[0];
            const ogFilename = ogPath.substring(ogPath.lastIndexOf('/') + 1);
            console.log('OG filename:', ogFilename);

            let hiddenContainers = 0;

            // 2. 找到包含匹配 og:image 的 picture 的最顶层容器
            //    策略：找到 picture 后，向上遍历，隐藏整个占位的祖先容器
            document.querySelectorAll('picture').forEach(pic => {
                const picHtml = pic.innerHTML;
                if (!picHtml.includes(ogFilename)) return;

                const parent = pic.parentElement;
                const parentClass = parent?.className || '';
                // 排除头像（父类含 !h-10 !w-10）
                if (parentClass.includes('!h-10') || parentClass.includes('!w-10')) return;

                // 向上找到最顶层 hero 容器（通常是 main 中的第一个 section 或 div）
                // 从 pic 向上找，停止在 main 或 article 层级
                let container = pic;
                let prev = container;
                while (container) {
                    prev = container;
                    container = container.parentElement;
                    if (!container) break;
                    const tag = container.tagName.toLowerCase();
                    const cls = container.className || '';
                    // 停在 article, main, section, 或包含 page-content 等关键 class 的 div
                    if (tag === 'article' || tag === 'main' || tag === 'section') break;
                    if (cls.includes('page-') || cls.includes('post-') || cls.includes('entry-')) break;
                    if (cls.includes('max-w-') && cls.includes('mx-auto')) break;
                }

                // 隐藏这个容器
                const target = container || prev;
                const targetDisplay = target.style.display;
                target.style.display = 'none';
                target.setAttribute('data-hero-removed', 'true');
                hiddenContainers++;
                console.log('Hidden hero container:', target.tagName, target.className.substring(0, 80), 'display was:', targetDisplay);
            });

            // 3. 兜底：hidden lg:block 的容器（通常是 Banner/Hero 所在）
            document.querySelectorAll('[class*="hidden"][class*="lg:block"]').forEach(el => {
                if (el.hasAttribute('data-hero-removed')) return;
                const cls = el.className || '';
                // 排除小元素头像等
                if (cls.includes('!h-10') || cls.includes('!w-10') || cls.includes('h-10') || cls.includes('w-10')) return;
                // 检查是否是顶级容器（直接位于 article/main 之下）
                const parent = el.parentElement;
                const grandparent = parent?.parentElement;
                const tag = el.tagName.toLowerCase();
                if ((tag === 'section' || tag === 'div') && (parent?.tagName.toLowerCase() === 'article' || parent?.tagName.toLowerCase() === 'main' || grandparent?.tagName.toLowerCase() === 'article')) {
                    el.style.display = 'none';
                    el.setAttribute('data-hero-removed', 'true');
                    hiddenContainers++;
                    console.log('Hidden by hidden+lg:block:', el.className.substring(0, 80));
                }
            });

            // 4. 强制显示其余正常 hidden 元素（保留文章内容）
            document.querySelectorAll('.hidden').forEach(el => {
                if (el.hasAttribute('data-hero-removed')) return;
                el.classList.remove('hidden');
                el.style.display = '';
                el.style.visibility = '';
                el.style.opacity = '';
            });

            // 5. 注入 CSS
            const style = document.createElement('style');
            style.textContent = `
                [data-hero-removed] { display: none !important; height: 0 !important; width: 0 !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important; border: none !important; }
                .hidden { display: block !important; visibility: visible !important; opacity: 1 !important; }
                figure, picture, img, div[class*="relative"] {
                    break-inside: avoid !important;
                    page-break-inside: avoid !important;
                    break-after: avoid !important;
                    page-break-after: avoid !important;
                }
                @media print {
                    [data-hero-removed] { display: none !important; height: 0 !important; width: 0 !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important; border: none !important; }
                    .hidden { display: block !important; visibility: visible !important; }
                    figure, picture, img, div[class*="relative"] {
                        break-inside: avoid !important;
                        -webkit-column-break-inside: avoid !important;
                        page-break-inside: avoid !important;
                    }
                }
            `;
            document.head.appendChild(style);
            console.log('Total hero containers hidden:', hiddenContainers);
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
            const heroRemoved = document.querySelectorAll('[data-hero-removed="true"]').length;
            return { total: imgs.length, large: large.length, heroRemoved };
        }''')
        print(f"  Images: {img_info['total']} total, {img_info['large']} large")
        print(f"  Hero containers removed: {img_info['heroRemoved']}")

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
