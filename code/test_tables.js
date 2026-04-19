const { chromium } = require('playwright');

async function scrape() {
  console.log('Launching browser...');
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--sec-ch-ua="Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      '--sec-ch-ua-mobile=?0',
      '--sec-ch-ua-platform="Windows"',
      '--sec-fetch-site=none',
      '--sec-fetch-mode=navigate',
      '--sec-fetch-user=?1',
      '--sec-fetch-dest=document',
      '--accept-lang=en-US,en;q=0.9',
      '--accept=text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      '--accept-encoding=gzip, deflate, br'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-CH-UA': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    }
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.navigator.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  
  console.log('Navigating...');
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  await page.waitForTimeout(5000);
  
  // Get all table IDs
  const tableIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('table')).map((t, i) => ({
      index: i,
      id: t.id || 'no-id',
      rows: t.querySelectorAll('tbody tr').length
    }));
  });
  
  console.log('All tables:', tableIds);
  
  // Get sidebar tabs
  const sidebarTabs = await page.evaluate(() => {
    const results = [];
    const sidebar = document.querySelector('[class*="sidebar"], [id*="sidebar"], [class*="menu"], [id*="menu"]');
    if (sidebar) {
      const links = sidebar.querySelectorAll('a');
      links.forEach(l => {
        const text = l.textContent.trim();
        if (text.includes('Websites')) {
          results.push(text);
        }
      });
    }
    return results;
  });
  
  console.log('\nSidebar tabs:', sidebarTabs);
  
  // Click first tab and check which table has data
  console.log('\n=== Testing tab clicks ===');
  
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
  
  const afterFirstTab = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table')).map((t, i) => {
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
      return { index: i, id: t.id || 'no-id', dataRows: data.length };
    });
    return tables.filter(t => t.dataRows > 0);
  });
  
  console.log('After clicking first tab - tables with data:', afterFirstTab);
  
  // Click second tab
  if (sidebarTabs[1]) {
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
    }, sidebarTabs[1]);
    
    await page.waitForTimeout(3000);
    
    const afterSecondTab = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table')).map((t, i) => {
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
        return { index: i, id: t.id || 'no-id', dataRows: data.length };
      });
      return tables.filter(t => t.dataRows > 0);
    });
    
    console.log('After clicking second tab - tables with data:', afterSecondTab);
  }
  
  await browser.close();
}

scrape().catch(console.error);
