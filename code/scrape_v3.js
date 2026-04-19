const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

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
  
  console.log('Navigating to site...');
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  // Wait for page to be fully loaded
  await page.waitForFunction(() => {
    return document.querySelectorAll('a[href="javascript:void(0)"]').length > 0;
  }, { timeout: 10000 });
  
  console.log('Page loaded, finding tabs...');
  
  // Get all tab names
  const tabNames = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href="javascript:void(0)"]'))
      .map(el => el.textContent.trim())
      .filter(t => t.includes('Websites'));
  });
  
  console.log('Found tabs:', tabNames);
  
  // Get table data function
  async function getTableData() {
    return await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      const data = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const site = cells[0].textContent.trim();
          const url = cells[1].textContent.trim();
          if (site && url) {
            data.push({ site, url });
          }
        }
      });
      return data;
    });
  }
  
  // Click tab by name
  async function clickTab(tabName) {
    await page.evaluate((name) => {
      const links = document.querySelectorAll('a[href="javascript:void(0)"]');
      for (const link of links) {
        if (link.textContent.trim() === name) {
          link.click();
          return true;
        }
      }
      return false;
    }, tabName);
  }
  
  // Wait for data to reload after tab click
  async function waitForReload(oldData) {
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(500);
      const newData = await getTableData();
      if (JSON.stringify(newData) !== JSON.stringify(oldData) && newData.length > 0) {
        return newData;
      }
    }
    return await getTableData();
  }
  
  // Collect all data
  const allData = [];
  
  // Click each tab and collect data
  for (const tabName of tabNames) {
    console.log(`\n=== Scraping: ${tabName} ===`);
    
    await clickTab(tabName);
    const initialData = await getTableData();
    const data = await waitForReload(initialData);
    
    console.log(`  Found ${data.length} rows`);
    
    // Get pagination info
    const paginationInfo = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
      return links.map(l => ({ text: l.textContent.trim(), href: l.getAttribute('href') }));
    });
    
    console.log(`  Pagination links: ${paginationInfo.length}`);
    
    // Check if there's a "Next" link
    let hasNext = paginationInfo.some(p => p.text === 'Next');
    let pageCount = 1;
    
    while (hasNext) {
      console.log(`  Page ${pageCount + 1}...`);
      
      // Click Next
      const nextLink = paginationInfo.find(p => p.text === 'Next');
      if (nextLink) {
        await page.evaluate((href) => {
          const links = document.querySelectorAll(`a[href="${href}"]`);
          if (links.length > 0) links[0].click();
        }, nextLink.href);
        
        await page.waitForTimeout(3000);
        
        const pageData = await getTableData();
        console.log(`    Found ${pageData.length} rows`);
        
        if (pageData.length > 0) {
          pageData.forEach(d => allData.push({ category: tabName, site: d.site, url: d.url }));
        }
        
        pageCount++;
        
        // Re-check pagination
        paginationInfo = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
          return links.map(l => ({ text: l.textContent.trim(), href: l.getAttribute('href') }));
        });
        hasNext = paginationInfo.some(p => p.text === 'Next');
      } else {
        hasNext = false;
      }
    }
    
    console.log(`  Total for ${tabName}: ${data.length + (pageCount - 1) * data.length} (approx)`);
  }
  
  console.log(`\n\n=== Total: ${allData.length} records ===`);
  
  // Create Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DMA Websites');
  sheet.addRow(['Category', 'Site', 'URL']);
  allData.forEach(row => sheet.addRow([row.category, row.site, row.url]));
  await workbook.xlsx.writeFile('/home/ubuntu/mulweb2.xlsx');
  console.log('Saved to /home/ubuntu/mulweb2.xlsx');
  
  await browser.close();
}

scrape().catch(console.error);
