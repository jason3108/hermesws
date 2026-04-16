import os, sys
from playwright.sync_api import sync_playwright

def gen_pdf(slug, url, output_path):
    print(f"Starting: {slug}", flush=True)
    browser = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 800, 'height': 600})
            page = context.new_page()
            
            page.goto(url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(5000)
            
            try:
                page.locator('button:has-text("Continue")').click()
                page.wait_for_timeout(1000)
            except:
                pass
            
            # 隐藏hero区域
            page.evaluate('''() => {
                const heroDiv = Array.from(document.querySelectorAll("div")).find(el => {
                    const cls = el.className || "";
                    return cls.includes("z-[1]") && cls.includes("lg:block");
                });
                if (heroDiv) { heroDiv.style.display = "none"; }
            }''')
            
            page.evaluate('''() => {
                const style = document.createElement('style');
                style.textContent = `figure { break-inside: avoid !important; } picture { break-inside: avoid !important; } img { break-inside: avoid !important; }`;
                document.head.appendChild(style);
            }''')
            
            total_height = page.evaluate('document.body.scrollHeight')
            for round_num in range(4):
                for y in range(0, int(total_height), 400):
                    page.evaluate(f'window.scrollTo(0, {y})')
                    page.wait_for_timeout(200)
                page.wait_for_timeout(1000)
            
            page.evaluate('window.scrollTo(0, 0)')
            page.wait_for_timeout(5000)
            
            page.pdf(path=output_path, format='A4', print_background=True,
                     margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
            size = os.path.getsize(output_path)
            print(f"OK: {slug} -> {size//1024}KB", flush=True)
            browser.close()
            return True
    except Exception as e:
        print(f"ERROR {slug}: {e}", flush=True)
        if browser:
            try: browser.close()
            except: pass
        return False

if __name__ == "__main__":
    slug = sys.argv[1]
    url = sys.argv[2]
    output_path = sys.argv[3]
    gen_pdf(slug, url, output_path)
