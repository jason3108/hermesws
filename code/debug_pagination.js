const { chromium } = require('playwright');

async function debug() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--sec-ch-ua="Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      '--sec-ch-ua-mobile=?0', '--sec-ch-ua-platform="Windows"',
      '--sec-fetch-site=none', '--sec-fetch-mode=navigate',
      '--sec-fetch-user=?1', '--sec-fetch-dest=document',
      '--accept-lang=en-US,en;q=0.9',
      '--accept=text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-CH-UA': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-CH-UA-Mobile': '?0', 'Sec-CH-UA-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1'
    }
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.navigator.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  await page.waitForTimeout(8000);
  
  // Click Department of War tab
  await page.evaluate(() => {
    const allLinks = document.querySelectorAll('a');
    for (const l of allLinks) {
      if (l.textContent.trim() === 'Department of War Websites') {
        l.click();
        return;
      }
    }
  });
  
  await page.waitForTimeout(3000);
  
  // Get all Page_ links in the entire page
  const allPageLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
    return links.map(l => ({
      text: l.textContent.trim(),
      href: l.getAttribute('href'),
      parent: l.parentElement ? l.parentElement.tagName : 'unknown',
      grandparent: l.parentElement && l.parentElement.parentElement ? l.parentElement.parentElement.tagName : 'unknown'
    }));
  });
  
  console.log('All Page_ links:', JSON.stringify(allPageLinks, null, 2));
  
  // Find the pagination area for the first table (Default_0)
  const paginationArea = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    for (const t of tables) {
      if (t.id && t.id.includes('_Default_0_') && t.id.includes('grdData')) {
        // Find the parent container with pagination
        let container = t.parentElement;
        while (container) {
          const links = container.querySelectorAll('a[href*="Page_"]');
          if (links.length > 0) {
            return {
              containerId: container.id || 'no-id',
              containerClass: container.className || 'no-class',
              links: Array.from(links).map(l => ({
                text: l.textContent.trim(),
                href: l.getAttribute('href')
              }))
            };
          }
          container = container.parentElement;
        }
      }
    }
    return null;
  });
  
  console.log('\nPagination area for Default_0:', JSON.stringify(paginationArea, null, 2));
  
  // Also check sibling elements after the table
  const afterTable = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    for (const t of tables) {
      if (t.id && t.id.includes('_Default_0_') && t.id.includes('grdData')) {
        // Check next sibling
        let next = t.nextElementSibling;
        let siblings = [];
        while (next) {
          siblings.push({
            tag: next.tagName,
            id: next.id || 'no-id',
            class: next.className || 'no-class'
          });
          next = next.nextElementSibling;
        }
        return siblings;
      }
    }
    return [];
  });
  
  console.log('\nSiblings after Default_0 table:', JSON.stringify(afterTable, null, 2));
  
  await browser.close();
}

debug().catch(console.error);
