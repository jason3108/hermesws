#!/usr/bin/env python3
"""Debug wizard - step by step PDF generation"""
import os
from playwright.sync_api import sync_playwright

BLOG_DIR = "/home/ubuntu/hermes/blog"
SLUG = "github-actions-security-threat-model-and-defenses"
URL = "https://www.wiz.io/blog/github-actions-security-threat-model-and-defenses"

pdf_path = os.path.join(BLOG_DIR, f"{SLUG}.pdf")

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path='/usr/bin/chromium-browser'
    )
    context = browser.new_context(viewport={'width': 1280, 'height': 1024})
    page = context.new_page()

    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(5000)

    try:
        page.locator('button:has-text("Accept"), button:has-text("Accept all"), button:has-text("Continue")').first.click(timeout=3000)
        page.wait_for_timeout(1000)
    except Exception as e:
        print(f"Cookie click: {e}")

    # 测试1: 先直接生成PDF看看
    page.pdf(path="/tmp/test_before.pdf", format='A4', print_background=True,
             margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
    size1 = os.path.getsize("/tmp/test_before.pdf")
    print(f"PDF before JS manipulation: {size1} bytes ({size1//1024}KB)")

    # 重新加载页面
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(3000)
    try:
        page.locator('button:has-text("Accept")').first.click(timeout=2000)
        page.wait_for_timeout(1000)
    except:
        pass

    # 测试2: 只用CSS隐藏hero但不移除DOM
    page.evaluate('''() => {
        const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
        const ogPath = ogImage.split('?')[0];
        const ogFilename = ogPath.substring(ogPath.lastIndexOf('/') + 1);

        document.querySelectorAll('picture').forEach(pic => {
            if (!pic.innerHTML.includes(ogFilename)) return;
            const parent = pic.parentElement;
            if (!parent) return;
            const cls = parent.className || '';
            if (cls.includes('!h-10') || cls.includes('!w-10')) return;

            // 用CSS隐藏而非移除
            parent.style.display = 'none';
            parent.style.visibility = 'hidden';
            parent.style.height = '0';
            parent.style.overflow = 'hidden';
        });

        document.querySelectorAll('.hidden').forEach(el => {
            el.classList.remove('hidden');
            el.style.display = '';
            el.style.visibility = '';
            el.style.opacity = '';
        });

        const style = document.createElement('style');
        style.textContent = `
            .hidden { display: block !important; visibility: visible !important; opacity: 1 !important; }
            figure, picture, img, div[class*="relative"] {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
            }
        `;
        document.head.appendChild(style);
    }''')

    total_height = page.evaluate('document.body.scrollHeight')
    for round_num in range(2):
        for y in range(0, int(total_height), 400):
            page.evaluate(f'window.scrollTo(0, {y})')
            page.wait_for_timeout(200)
        page.wait_for_timeout(500)

    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(2000)

    page.pdf(path="/tmp/test_after.pdf", format='A4', print_background=True,
             margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
    size2 = os.path.getsize("/tmp/test_after.pdf")
    print(f"PDF after CSS hide: {size2} bytes ({size2//1024}KB)")

    browser.close()