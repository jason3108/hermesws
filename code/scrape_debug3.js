const { chromium } = require('playwright');

async function debug() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  const response = await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'networkidle'
  });
  
  console.log('Status:', response.status());
  
  // Wait longer for JS
  await page.waitForTimeout(8000);
  
  // Count elements
  const counts = await page.evaluate(() => {
    return {
      links: document.querySelectorAll('a').length,
      tables: document.querySelectorAll('table').length,
      divs: document.querySelectorAll('div').length,
      bodyText: document.body.textContent.substring(0, 1000)
    };
  });
  
  console.log('Counts:', counts);
  
  // Try to get links again
  const links = await page.$$eval('a', els => els.map(e => ({text: e.textContent.trim().substring(0, 50), href: e.href})));
  console.log('Links found:', links.length);
  links.slice(0, 30).forEach(l => console.log(`  "${l.text}" -> ${l.href.substring(0, 80)}`));
  
  await browser.close();
}

debug().catch(console.error);
