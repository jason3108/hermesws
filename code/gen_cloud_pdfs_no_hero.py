#!/usr/bin/env python3
"""
Wiz 云安全相关文章离线存档 - 去除 Hero 封面图版本
"""
import os
from playwright.sync_api import sync_playwright

BLOG_DIR = "/home/ubuntu/hermes/blog"

ARTICLES = [
    {
        "slug": "github-actions-security-threat-model-and-defenses",
        "url": "https://www.wiz.io/blog/github-actions-security-threat-model-and-defenses",
        "title": "GitHub Actions Security",
    },
    {
        "slug": "twenty-years-of-cloud-security-research",
        "url": "https://www.wiz.io/blog/twenty-years-of-cloud-security-research",
        "title": "Twenty Years of Cloud Security Research",
    },
    {
        "slug": "fedramp-incident-response",
        "url": "https://www.wiz.io/blog/fedramp-incident-response",
        "title": "FedRAMP Incident Response",
    },
    {
        "slug": "wiz-tenant-manager-multi-tenant-security",
        "url": "https://www.wiz.io/blog/wiz-tenant-manager-multi-tenant-security",
        "title": "Wiz Tenant Manager",
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

        # 关闭 cookie 弹窗
        try:
            page.locator('button:has-text("Accept"), button:has-text("Accept all"), button:has-text("Continue")').first.click(timeout=3000)
            page.wait_for_timeout(1000)
        except:
            pass

        # 去除 Hero 封面图
        page.evaluate('''() => {
            // 1. 从 og:image 获取 hero 文件名
            const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
            const ogPath = ogImage.split('?')[0];
            const ogFilename = ogPath.substring(ogPath.lastIndexOf('/') + 1);
            console.log('OG filename:', ogFilename);

            let hiddenCount = 0;

            // 2. 隐藏匹配 og:image 的 picture，排除作者头像（父类含 !h-10 !w-10）
            document.querySelectorAll('picture').forEach(pic => {
                const picHtml = pic.innerHTML;
                const parent = pic.parentElement;
                const parentClass = parent?.className || '';
                const isAvatar = parentClass.includes('!h-10') || parentClass.includes('!w-10');
                if (picHtml.includes(ogFilename) && !isAvatar) {
                    pic.style.display = 'none';
                    pic.setAttribute('data-hero-hidden', 'true');
                    hiddenCount++;
                    console.log('Hidden hero by og:', ogFilename);
                }
            });

            // 3. 兜底：hidden lg:block 容器中的大图（非头像）
            document.querySelectorAll('picture').forEach(pic => {
                if (pic.hasAttribute('data-hero-hidden')) return;
                const parent = pic.parentElement;
                const parentClass = parent?.className || '';
                if (parentClass.includes('hidden') && parentClass.includes('lg:block') && !parentClass.includes('!h-10')) {
                    pic.style.display = 'none';
                    pic.setAttribute('data-hero-hidden', 'true');
                    hiddenCount++;
                    console.log('Hidden hero by hidden lg:block');
                }
            });

            // 4. 强制显示其余 hidden 元素（保留文章内容）
            document.querySelectorAll('.hidden').forEach(el => {
                el.classList.remove('hidden');
                el.style.display = '';
                el.style.visibility = '';
                el.style.opacity = '';
            });

            // 5. 注入防分页 CSS
            const style = document.createElement('style');
            style.textContent = `
                [data-hero-hidden] { display: none !important; }
                .hidden { display: block !important; visibility: visible !important; opacity: 1 !important; }
                figure, picture, img, div[class*="relative"] {
                    break-inside: avoid !important;
                    page-break-inside: avoid !important;
                    break-after: avoid !important;
                    page-break-after: avoid !important;
                }
                @media print {
                    [data-hero-hidden] { display: none !important; }
                    .hidden { display: block !important; visibility: visible !important; }
                    figure, picture, img, div[class*="relative"] {
                        break-inside: avoid !important;
                        -webkit-column-break-inside: avoid !important;
                        page-break-inside: avoid !important;
                    }
                }
            `;
            document.head.appendChild(style);
            console.log('Total hero hidden:', hiddenCount);
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

        # 验证图片加载状态
        img_info = page.evaluate('''() => {
            const imgs = Array.from(document.querySelectorAll("img"));
            const large = imgs.filter(img => img.naturalWidth > 1000);
            const hiddenHero = document.querySelectorAll('[data-hero-hidden="true"]').length;
            const rmiz_found = document.querySelectorAll('[data-rmiz-content="found"]').length;
            const rmiz_not_found = document.querySelectorAll('[data-rmiz-content="not-found"]').length;
            return { total: imgs.length, large: large.length, hiddenHero, rmiz_found, rmiz_not_found };
        }''')
        print(f"  Images: {img_info['total']} total, {img_info['large']} large")
        print(f"  Hero hidden: {img_info['hiddenHero']}")
        print(f"  rmiz: {img_info['rmiz_found']} found, {img_info['rmiz_not_found']} not-found")

        # 等待所有图片加载完成
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
