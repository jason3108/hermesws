const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

async function scrapeAll() {
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
  
  await page.waitForTimeout(5000);
  
  // Tab names to scrape
  const tabNames = [
    'Department of War Websites',
    'Joint Websites',
    'Air Force Websites',
    'Army Websites',
    'Army Corps of Engineers Websites',
    'Marine Corps Websites',
    'Navy Websites',
    'Coast Guard Websites',
    'National Guard Websites',
    'Space Force Websites',
    'Defense Health Agency Websites'
  ];
  
  // Function to get table data
  async function getTableData() {
    try {
      return await page.$$eval('table tbody tr', rows => {
        return rows.map(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const site = cells[0].textContent.trim();
            const url = cells[1].textContent.trim();
            if (site && url) {
              return { site, url };
            }
          }
          return null;
        }).filter(d => d !== null);
      });
    } catch (e) {
      return [];
    }
  }
  
  // Function to click a tab by name
  async function clickTab(tabName) {
    try {
      const elements = await page.$$(`a[href="javascript:void(0)"]`);
      for (const el of elements) {
        const text = await el.textContent();
        if (text.trim() === tabName) {
          await el.click();
          await page.waitForTimeout(3000);
          return true;
        }
      }
    } catch (e) {
      console.error('Click tab error:', e.message);
    }
    return false;
  }
  
  // Collect all data
  const allData = [];
  
  // Process each tab
  for (const tabName of tabNames) {
    console.log(`\n=== Scraping: ${tabName} ===`);
    
    // Click tab
    const clicked = await clickTab(tabName);
    if (!clicked) {
      console.log(`  Could not find tab: ${tabName}`);
      continue;
    }
    
    await page.waitForTimeout(3000);
    
    let pageNum = 1;
    let totalForTab = 0;
    let consecutiveNoData = 0;
    
    while (consecutiveNoData < 3) {
      console.log(`  Page ${pageNum}...`);
      
      const data = await getTableData();
      
      if (data.length === 0) {
        consecutiveNoData++;
        console.log(`  No data found (${consecutiveNoData}/3)`);
      } else {
        consecutiveNoData = 0;
        console.log(`  Found ${data.length} rows`);
        totalForTab += data.length;
        
        data.forEach(d => {
          allData.push({ category: tabName, site: d.site, url: d.url });
        });
      }
      
      // Try to click "Next" button
      try {
        const nextExists = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
          const nextLink = links.find(l => l.textContent.trim() === 'Next');
          return nextLink ? nextLink.getAttribute('href') : null;
        });
        
        if (!nextExists) {
          console.log(`  No more pages`);
          break;
        }
        
        // Click Next using href
        const clickedNext = await page.evaluate((href) => {
          const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
          const nextLink = links.find(l => l.getAttribute('href') === href);
          if (nextLink) {
            nextLink.click();
            return true;
          }
          return false;
        }, nextExists);
        
        if (clickedNext) {
          pageNum++;
          await page.waitForTimeout(3000);
        } else {
          break;
        }
      } catch (e) {
        console.log(`  Error getting next page: ${e.message}`);
        break;
      }
    }
    
    console.log(`  Total for ${tabName}: ${totalForTab} rows`);
  }
  
  console.log(`\n\n=== Total collected: ${allData.length} records ===`);
  
  // Create Excel file
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DMA Websites');
  
  // Add header
  sheet.addRow(['Category', 'Site', 'URL']);
  
  // Add data
  allData.forEach(row => {
    sheet.addRow([row.category, row.site, row.url]);
  });
  
  // Save
  await workbook.xlsx.writeFile('/home/ubuntu/mulweb2.xlsx');
  console.log('Saved to /home/ubuntu/mulweb2.xlsx');
  
  // Print summary
  const byCategory = {};
  allData.forEach(r => {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  });
  
  console.log('\nBy category:');
  for (const [cat, count] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${count}`);
  }
  
  await browser.close();
  console.log('\nDone!');
}

scrapeAll().catch(console.error);
