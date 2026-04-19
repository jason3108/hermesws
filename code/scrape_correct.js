const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

async function scrape() {
  console.log('Launching browser...');
  
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
  
  console.log('Navigating...');
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  await page.waitForTimeout(8000);
  
  // Mapping: tab name -> table suffix number
  const tabTableMap = {
    'Department of War Websites': '0',
    'Joint Websites': '1',
    'Air Force Websites': '2',
    'Army Websites': '3',
    'Army Corps of Engineers Websites': '4',
    'Marine Corps Websites': '5',
    'Navy Websites': '6',
    'Coast Guard Websites': '7',
    'National Guard Websites': '8',
    'Space Force Websites': '9',
    'Defense Health Agency Websites': '10'
  };
  
  // Click tab by name
  async function clickTab(tabName) {
    return await page.evaluate((name) => {
      // Find all clickable elements
      const allLinks = document.querySelectorAll('a');
      for (const l of allLinks) {
        if (l.textContent.trim() === name) {
          l.click();
          return true;
        }
      }
      return false;
    }, tabName);
  }
  
  // Get data from a specific table by suffix number
  async function getTableData(tableSuffix) {
    return await page.evaluate((suffix) => {
      // Find table with id containing _Default_{suffix}_
      const tables = document.querySelectorAll('table');
      for (const t of tables) {
        if (t.id && t.id.includes(`_Default_${suffix}_`) && t.id.includes('grdData')) {
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
          return data;
        }
      }
      return [];
    }, tableSuffix);
  }
  
  // Get max page number for a specific table
  async function getMaxPage(tableSuffix) {
    return await page.evaluate((suffix) => {
      // Find table with id containing _Default_{suffix}_
      const tables = document.querySelectorAll('table');
      for (const t of tables) {
        if (t.id && t.id.includes(`_Default_${suffix}_`) && t.id.includes('grdData')) {
          // Look for pagination links within or near this table
          const allLinks = t.querySelectorAll ? t.querySelectorAll('a[href*="Page_"]') : [];
          const nums = [];
          allLinks.forEach(l => {
            const m = l.getAttribute('href').match(/Page_(\d+)/);
            if (m) nums.push(parseInt(m[1]));
          });
          
          // If not found in table, look in parent containers
          if (nums.length === 0) {
            const parent = t.parentElement;
            if (parent) {
              const parentLinks = parent.querySelectorAll ? parent.querySelectorAll('a[href*="Page_"]') : [];
              parentLinks.forEach(l => {
                const m = l.getAttribute('href').match(/Page_(\d+)/);
                if (m) nums.push(parseInt(m[1]));
              });
            }
          }
          
          return nums.length > 0 ? Math.max(...nums) : 1;
        }
      }
      return 1;
    }, tableSuffix);
  }
  
  // Click page number in specific table
  async function clickPage(tableSuffix, pageNum) {
    return await page.evaluate((suffix, num) => {
      const tables = document.querySelectorAll('table');
      for (const t of tables) {
        if (t.id && t.id.includes(`_Default_${suffix}_`) && t.id.includes('grdData')) {
          // Find pagination links within this table's container
          const container = t.parentElement;
          if (container) {
            const links = container.querySelectorAll('a[href*="Page_"]');
            for (const l of links) {
              const href = l.getAttribute('href');
              if (href && href.includes(`Page_${num}`)) {
                l.click();
                return true;
              }
            }
          }
        }
      }
      return false;
    }, tableSuffix, pageNum);
  }
  
  const allData = [];
  const seenKeys = new Set();
  
  // Process each tab
  for (const [tabName, tableSuffix] of Object.entries(tabTableMap)) {
    console.log(`\n=== ${tabName} ===`);
    
    // Click tab to activate it
    await clickTab(tabName);
    await page.waitForTimeout(2000);
    
    const maxPage = await getMaxPage(tableSuffix);
    console.log(`  Max pages: ${maxPage}`);
    
    let tabTotal = 0;
    
    for (let p = 1; p <= maxPage; p++) {
      if (p > 1) {
        await clickPage(tableSuffix, p);
        await page.waitForTimeout(2000);
      }
      
      const data = await getTableData(tableSuffix);
      console.log(`  Page ${p}: ${data.length} rows`);
      
      data.forEach(d => {
        const key = `${tabName}|${d.url}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allData.push({ category: tabName, site: d.site, url: d.url });
        }
      });
      
      tabTotal += data.length;
    }
    
    console.log(`  Total: ${tabTotal} rows, ${tabTotal / maxPage} per page (approx)`);
  }
  
  console.log(`\n=== TOTAL: ${allData.length} unique records ===`);
  
  // Save Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DMA Websites');
  sheet.addRow(['Category', 'Site', 'URL']);
  allData.forEach(row => sheet.addRow([row.category, row.site, row.url]));
  await workbook.xlsx.writeFile('/home/ubuntu/mulweb2.xlsx');
  console.log('Saved: /home/ubuntu/mulweb2.xlsx');
  
  // Summary
  const byCat = {};
  allData.forEach(r => {
    byCat[r.category] = (byCat[r.category] || 0) + 1;
  });
  console.log('\nBy category:');
  for (const [cat, count] of Object.entries(byCat)) {
    console.log(`  ${cat}: ${count}`);
  }
  
  await browser.close();
  console.log('\nDone!');
}

scrape().catch(console.error);
