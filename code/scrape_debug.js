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
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'networkidle'
  });
  
  await page.waitForTimeout(3000);
  
  // Get page content for debugging
  const html = await page.content();
  
  // Find all elements with onclick handlers that contain tab switching
  const tabElements = await page.evaluate(() => {
    const result = [];
    // Look for elements with specific patterns
    document.querySelectorAll('a, button, [role="tab"], [class*="tab"]').forEach(el => {
      const text = el.textContent.trim();
      const href = el.href || '';
      const onclick = el.getAttribute('onclick') || '';
      if (text && (text.includes('Websites') || text.includes('Joint') || text.includes('Army') || text.includes('Navy') || text.includes('Air') || text.includes('Marine') || text.includes('Coast') || text.includes('National') || text.includes('Space') || text.includes('Defense'))) {
        result.push({ tag: el.tagName, text, href, onclick: onclick.substring(0, 100) });
      }
    });
    return result;
  });
  
  console.log('Tab-like elements found:', JSON.stringify(tabElements, null, 2));
  
  // Also look for the tab container
  const tabContainer = await page.evaluate(() => {
    const containers = document.querySelectorAll('[class*="tab"], [id*="tab"], [role="tablist"]');
    return Array.from(containers).map(el => ({
      tag: el.tagName,
      class: el.className,
      id: el.id,
      role: el.getAttribute('role'),
      childrenCount: el.children.length
    }));
  });
  
  console.log('\nTab containers:', JSON.stringify(tabContainer, null, 2));
  
  // Look at the left sidebar
  const sidebar = await page.evaluate(() => {
    const sidebars = document.querySelectorAll('[class*="sidebar"], [class*="menu"], [class*="nav"]');
    return Array.from(sidebars).map(el => ({
      tag: el.tagName,
      class: el.className,
      id: el.id,
      innerHTML: el.innerHTML.substring(0, 500)
    }));
  });
  
  console.log('\nSidebar elements:', JSON.stringify(sidebar.slice(0, 3), null, 2));
  
  await browser.close();
}

debug().catch(console.error);
