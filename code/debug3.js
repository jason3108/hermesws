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
  
  // Find sidebar tabs
  const sidebarTabs = await page.evaluate(() => {
    const results = [];
    const sidebar = document.querySelector('[class*="sidebar"], [id*="sidebar"], [class*="menu"], [id*="menu"]');
    if (sidebar) {
      const links = sidebar.querySelectorAll('a');
      links.forEach(l => {
        const text = l.textContent.trim();
        if (text.includes('Websites') || text.includes('War') || text.includes('Joint')) {
          results.push(text);
        }
      });
    }
    return results;
  });
  
  console.log('Sidebar tabs found:', sidebarTabs);
  
  // Check which table is visible for current tab
  const getVisibleTable = async () => {
    return await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('table').forEach((t) => {
        if (t.id && t.id.includes('grdData')) {
          // Check if parent is visible
          let parent = t.parentElement;
          let depth = 0;
          while (parent && depth < 5) {
            const style = window.getComputedStyle(parent);
            if (style.display === 'none') {
              return; // hidden
            }
            if (style.display === 'block' || style.visibility === 'hidden') {
              break;
            }
            parent = parent.parentElement;
            depth++;
          }
          
          // Get data
          const rows = t.querySelectorAll('tbody tr');
          const data = [];
          rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
              const site = cells[0].textContent.trim();
              const url = cells[1].textContent.trim();
              if (site && url && url.startsWith('http')) {
                data.push({ site, url });
              }
            }
          });
          
          if (data.length > 0) {
            results.push({ id: t.id, dataLen: data.length, sample: data[0].url });
          }
        }
      });
      return results;
    });
  };
  
  console.log('\nVisible tables (with data):', JSON.stringify(await getVisibleTable()));
  
  // Click first tab
  if (sidebarTabs.length > 0) {
    console.log(`\nClicking: ${sidebarTabs[0]}`);
    await page.evaluate((name) => {
      const sidebar = document.querySelector('[class*="sidebar"], [id*="sidebar"], [class*="menu"], [id*="menu"]');
      if (sidebar) {
        const links = sidebar.querySelectorAll('a');
        for (const l of links) {
          if (l.textContent.trim() === name) {
            l.click();
            return;
          }
        }
      }
    }, sidebarTabs[0]);
    
    await page.waitForTimeout(3000);
    console.log('After click:', JSON.stringify(await getVisibleTable()));
  }
  
  await browser.close();
}

debug().catch(console.error);
