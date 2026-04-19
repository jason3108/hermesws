const { chromium } = require('playwright');

async function debug() {
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
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  await page.waitForTimeout(5000);
  
  // Analyze page structure
  console.log('=== PAGE STRUCTURE ANALYSIS ===\n');
  
  // Get all tables and their info
  const tableInfo = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const result = [];
    tables.forEach((t, i) => {
      const rows = t.querySelectorAll('tbody tr');
      const firstRowCells = rows.length > 0 ? rows[0].querySelectorAll('td').length : 0;
      const hasPagination = t.innerHTML.includes('Page_');
      result.push({
        index: i,
        rows: rows.length,
        cellsInFirstRow: firstRowCells,
        hasPagination,
        id: t.id || 'no-id',
        class: t.className || 'no-class'
      });
    });
    return result;
  });
  
  console.log('Tables found:', tableInfo.length);
  tableInfo.forEach(t => {
    console.log(`  Table ${t.index}: rows=${t.rows}, cells=${t.cellsInFirstRow}, pagination=${t.hasPagination}, id=${t.id}`);
  });
  
  // Get tab structure
  const tabInfo = await page.evaluate(() => {
    // Look for the tab container
    const allLinks = document.querySelectorAll('a[href="javascript:void(0)"]');
    const tabLinks = Array.from(allLinks).filter(l => 
      l.textContent.trim().includes('Websites')
    );
    
    // Get parent structure
    const results = [];
    tabLinks.forEach(l => {
      results.push({
        text: l.textContent.trim(),
        parent: l.parentElement ? l.parentElement.tagName + '.' + (l.parentElement.className || '') : 'unknown',
        grandparent: l.parentElement && l.parentElement.parentElement ? l.parentElement.parentElement.tagName : 'unknown'
      });
    });
    return results;
  });
  
  console.log('\nTab structure:');
  tabInfo.slice(0, 5).forEach(t => console.log(`  ${t.text}: parent=${t.parent}, grandparent=${t.grandparent}`));
  
  // Check if clicking different tabs gives different data
  console.log('\n=== TESTING TAB CLICKS ===');
  
  const tabs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href="javascript:void(0)"]'))
      .filter(l => l.textContent.trim().includes('Websites'))
      .map(l => l.textContent.trim());
  });
  
  console.log('All tabs:', tabs);
  
  // Get initial data for first tab
  const initialData = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
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
    return data;
  });
  
  console.log(`\nInitial page (${tabs[0]}): ${initialData.length} rows`);
  console.log('First 3:', initialData.slice(0, 3).map(d => d.url));
  
  // Click first tab explicitly
  await page.evaluate((name) => {
    const links = document.querySelectorAll('a[href="javascript:void(0)"]');
    for (const l of links) {
      if (l.textContent.trim() === name) {
        l.click();
        return;
      }
    }
  }, tabs[0]);
  
  await page.waitForTimeout(3000);
  
  const afterFirstClick = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
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
    return data;
  });
  
  console.log(`After clicking ${tabs[0]} again: ${afterFirstClick.length} rows`);
  console.log('Same as initial?', JSON.stringify(initialData) === JSON.stringify(afterFirstClick));
  
  // Click second tab
  if (tabs[1]) {
    await page.evaluate((name) => {
      const links = document.querySelectorAll('a[href="javascript:void(0)"]');
      for (const l of links) {
        if (l.textContent.trim() === name) {
          l.click();
          return;
        }
      }
    }, tabs[1]);
    
    await page.waitForTimeout(3000);
    
    const afterSecondClick = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
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
      return data;
    });
    
    console.log(`After clicking ${tabs[1]}: ${afterSecondClick.length} rows`);
    console.log('Same as first tab?', JSON.stringify(initialData) === JSON.stringify(afterSecondClick));
    console.log('First 3:', afterSecondClick.slice(0, 3).map(d => d.url));
  }
  
  await browser.close();
}

debug().catch(console.error);
