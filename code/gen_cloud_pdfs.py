#!/usr/bin/env python3
"""
Wiz 云安全相关文章离线存档
抓取 4 篇 Cloud 相关文章并生成含完整图片的 PDF
"""
import os
from playwright.sync_api import sync_playwright

BLOG_DIR = "/home/ubuntu/hermes/blog"

ARTICLES = [
    {
        "slug": "github-actions-security-threat-model-and-defenses",
        "url": "https://www.wiz.io/blog/github-actions-security-threat-model-and-defenses",
        "title": "Primer on GitHub Actions Security - Threat Model, Attacks and Defenses (Part 1/2)",
        "date": "2026-04-14",
        "authors": "Wiz Research"
    },
    {
        "slug": "twenty-years-of-cloud-security-research",
        "url": "https://www.wiz.io/blog/twenty-years-of-cloud-security-research",
        "title": "Twenty Years of Cloud Security Research",
        "date": "2026-03-13",
        "authors": "Wiz Research"
    },
    {
        "slug": "fedramp-incident-response",
        "url": "https://www.wiz.io/blog/fedramp-incident-response",
        "title": "The Agile FedRAMP Playbook, Part 4: Reactive Risk Management through Enriched Incident Response",
        "date": "2026-03-06",
        "authors": "Wiz Research"
    },
    {
        "slug": "wiz-tenant-manager-multi-tenant-security",
        "url": "https://www.wiz.io/blog/wiz-tenant-manager-multi-tenant-security",
        "title": "Introducing Wiz Tenant Manager: Multi-Tenant Management for Federated Organizations",
        "date": "2026-03-06",
        "authors": "Wiz Research"
    },
]

for article in ARTICLES:
    slug = article["slug"]
    url = article["url"]
    pdf_path = os.path.join(BLOG_DIR, f"{slug}.pdf")

    if os.path.exists(pdf_path):
        size = os.path.getsize(pdf_path)
        print(f"[SKIP] {slug}.pdf already exists ({size // 1024}KB)")
        continue

    print(f"\n[START] {slug}")
    print(f"  URL: {url}")

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

        # 强制显示所有 hidden 元素并注入防分页 CSS
        page.evaluate('''() => {
            document.querySelectorAll(".hidden").forEach(el => {
                el.classList.remove("hidden");
                el.style.display = "";
                el.style.visibility = "";
                el.style.opacity = "";
            });

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
            const rmiz_found = document.querySelectorAll('[data-rmiz-content="found"]').length;
            const rmiz_not_found = document.querySelectorAll('[data-rmiz-content="not-found"]').length;
            return { total: imgs.length, large: large.length, rmiz_found, rmiz_not_found };
        }''')
        print(f"  Images: {img_info['total']} total, {img_info['large']} large")
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
