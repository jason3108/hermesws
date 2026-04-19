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
  
  console.log('Waiting for content...');
  await page.waitForTimeout(5000);
  
  // Get all tab names
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
          if (site && url) data.push({ site, url });
        }
      });
      return data;
    });
  }
  
  // Click tab by name
  async function clickTab(tabName) {
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
  }
  
  // Get pagination info
  async function getPaginationInfo() {
    return await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
      const pageNums = links
        .map(l => {
          const m = l.getAttribute('href').match(/Page_(\d+)/);
          return m ? parseInt(m[1]) : null;
        })
        .filter(n => n !== null);
      const maxPage = pageNums.length > 0 ? Math.max(...pageNums) : 1;
      const hasNext = links.some(l => l.textContent.trim() === 'Next');
      return { maxPage, hasNext, totalLinks: links.length };
    });
  }
  
  // Collect all data
  const allData = [];
  
  // First get default data
  console.log('\n=== Getting initial data ===');
  let data = await getTableData();
  console.log(`Initial data: ${data.length} rows`);
  
  // Get pagination
  let pagination = await getPaginationInfo();
  console.log(`Pagination: maxPage=${pagination.maxPage}, hasNext=${pagination.hasNext}`);
  
  // Collect from default view
  data.forEach(d => {
    allData.push({ category: 'Default', site: d.site, url: d.url });
  });
  
  // Now process each tab
  for (const tabName of tabNames) {
    console.log(`\n=== Processing: ${tabName} ===`);
    
    await clickTab(tabName);
    await page.waitForTimeout(3000);
    
    let tabData = [];
    pagination = await getPaginationInfo();
    console.log(`  Pages: ${pagination.maxPage}, Total links: ${pagination.totalLinks}`);
    
    // Get data from all pages
    for (let p = 1; p <= pagination.maxPage; p++) {
      // Click page if not on first
      if (p > 1) {
        const clicked = await page.evaluate((pageNum) => {
          const links = document.querySelectorAll('a[href*="Page_"]');
          for (const link of links) {
            if (link.getAttribute('href').includes(`Page_${pageNum}`)) {
              link.click();
              return true;
            }
          }
          return false;
        }, p);
        
        if (clicked) {
          await page.waitForTimeout(2000);
        }
      }
      
      const pageData = await getTableData();
      console.log(`  Page ${p}: ${pageData.length} rows`);
      tabData = tabData.concat(pageData);
    }
    
    tabData.forEach(d => {
      allData.push({ category: tabName, site: d.site, url: d.url });
    });
    
    console.log(`  Total for ${tabName}: ${tabData.length}`);
  }
  
  console.log(`\n\n=== Total records: ${allData.length} ===`);
  
  // Create Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DMA Websites');
  sheet.addRow(['Category', 'Site', 'URL']);
  allData.forEach(row => sheet.addRow([row.category, row.site, row.url]));
  await workbook.xlsx.writeFile('/home/ubuntu/mulweb2.xlsx');
  console.log('Saved to /home/ubuntu/mulweb2.xlsx');
  
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
