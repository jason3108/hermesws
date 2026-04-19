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
  
  console.log('Navigating...');
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  await page.waitForTimeout(5000);
  
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
  
  // Get table data
  async function getTableData() {
    try {
      return await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        const data = [];
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const site = cells[0].textContent.trim();
            const url = cells[1].textContent.trim();
            if (site && url) data.push({ site, url });
          }
        });
        return data;
      });
    } catch (e) {
      return [];
    }
  }
  
  // Click tab
  async function clickTab(tabName) {
    try {
      return await page.evaluate((name) => {
        const links = document.querySelectorAll('a[href="javascript:void(0)"]');
        for (const link of links) {
          if (link.textContent.trim() === name) {
            link.click();
            return true;
          }
        }
        return false;
      }, tabName);
    } catch (e) {
      return false;
    }
  }
  
  // Click page link by number
  async function clickPage(pageNum) {
    try {
      return await page.evaluate((num) => {
        const links = document.querySelectorAll('a[href*="Page_"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && href.includes(`Page_${num}`)) {
            link.click();
            return true;
          }
        }
        return false;
      }, pageNum);
    } catch (e) {
      return false;
    }
  }
  
  // Get max page number
  async function getMaxPage() {
    try {
      return await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
        const nums = links
          .map(l => {
            const m = l.getAttribute('href').match(/Page_(\d+)/);
            return m ? parseInt(m[1]) : 0;
          })
          .filter(n => n > 0);
        return nums.length > 0 ? Math.max(...nums) : 1;
      });
    } catch (e) {
      return 1;
    }
  }
  
  // Wait for table to reload
  async function waitForTableReload(oldData) {
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(500);
      try {
        const newData = await getTableData();
        if (newData.length > 0 && JSON.stringify(newData) !== JSON.stringify(oldData)) {
          return newData;
        }
      } catch (e) {
        // ignore
      }
    }
    return await getTableData();
  }
  
  const allData = [];
  
  // Process each tab
  for (const tabName of tabNames) {
    console.log(`\n=== ${tabName} ===`);
    
    await clickTab(tabName);
    await page.waitForTimeout(3000);
    
    const maxPage = await getMaxPage();
    console.log(`  Pages: ${maxPage}`);
    
    let tabTotal = 0;
    
    for (let p = 1; p <= maxPage; p++) {
      if (p > 1) {
        await clickPage(p);
        await page.waitForTimeout(3000);
      }
      
      const data = await getTableData();
      console.log(`  Page ${p}: ${data.length} rows`);
      
      data.forEach(d => {
        allData.push({ category: tabName, site: d.site, url: d.url });
      });
      
      tabTotal += data.length;
    }
    
    console.log(`  Subtotal: ${tabTotal}`);
  }
  
  console.log(`\n=== TOTAL: ${allData.length} records ===`);
  
  // Save Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DMA Websites');
  sheet.addRow(['Category', 'Site', 'URL']);
  allData.forEach(row => sheet.addRow([row.category, row.site, row.url]));
  await workbook.xlsx.writeFile('/home/ubuntu/mulweb2.xlsx');
  console.log('Saved: /home/ubuntu/mulweb2.xlsx');
  
  // Summary
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

scrape().catch(e => console.error('Error:', e));
