#!/usr/bin/env python3
"""分析页面结构"""
import json
from playwright.sync_api import sync_playwright

url = "https://www.wiz.io/blog/introducing-wiz-vercel-integration"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium-browser')
    page = browser.new_page()
    page.goto(url, wait_until='networkidle', timeout=60000)
    page.wait_for_timeout(5000)
    try:
        page.locator('button:has-text("Accept"), button:has-text("Continue")').first.click(timeout=3000)
    except: pass
    page.wait_for_timeout(2000)

    result = page.evaluate('''() => {
        const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
        const heroMatch = ogImage.match(/\\/([^\\/]+)\\?/);
        const heroName = heroMatch ? heroMatch[1] : '';
        
        const pics = Array.from(document.querySelectorAll("picture"));
        const info = pics.map((pic, i) => {
            const hasHero = pic.innerHTML.includes(heroName);
            const imgs = Array.from(pic.querySelectorAll('img'));
            const firstSrc = imgs[0]?.src?.substring(0, 100) || '';
            return { index: i, hasHero, firstSrc: firstSrc, parentClass: pic.parentElement?.className?.substring(0, 80) };
        });
        
        return { total: pics.length, heroName, ogImage: ogImage.substring(0, 100), pictures: info };
    }''')
    print(json.dumps(result, indent=2))
    browser.close()
