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
  
  // Function to get table data
  async function getTableData() {
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
  }
  
  // Function to check if next page exists and click it
  async function goToNextPage() {
    // Find all page navigation links
    const pageLinks = await page.$$eval('a[href*="Page_"]', els => 
      els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute('href') }))
    );
    
    // Look for "Next" link
    const nextLink = pageLinks.find(l => l.text === 'Next' && l.href.includes('Page_'));
    if (nextLink) {
      const pageMatch = nextLink.href.match(/Page_(\d+)/);
      if (pageMatch) {
        return parseInt(pageMatch[1]);
      }
    }
    return null;
  }
  
  // Function to click a tab by name
  async function clickTab(tabName) {
    // Find all clickable elements containing the tab name
    const elements = await page.$$(`a[href="javascript:void(0)"]`);
    for (const el of elements) {
      const text = await el.textContent();
      if (text.trim() === tabName) {
        await el.click();
        await page.waitForTimeout(3000);
        return true;
      }
    }
    return false;
  }
  
  // Collect all data
  const allData = [];
  
  // First, collect data from default tab (first one loaded)
  console.log('\n=== Scraping default view ===');
  const defaultData = await getTableData();
  console.log(`Found ${defaultData.length} rows`);
  defaultData.forEach(d => {
    allData.push({ category: 'Default', site: d.site, url: d.url });
  });
  
  // Now click each tab and get data
  for (const tabName of tabNames) {
    console.log(`\n=== Clicking tab: ${tabName} ===`);
    
    try {
      await clickTab(tabName);
      await page.waitForTimeout(3000);
      
      let pageNum = 1;
      let hasNextPage = true;
      
      while (hasNextPage) {
        console.log(`  Page ${pageNum}...`);
        
        const data = await getTableData();
        console.log(`  Found ${data.length} rows`);
        
        data.forEach(d => {
          allData.push({ category: tabName, site: d.site, url: d.url });
        });
        
        const nextPage = await goToNextPage();
        if (nextPage) {
          pageNum++;
          // Find and click the next page link
          const pageLink = await page.$(`a[href*="Page_${nextPage}"]`);
          if (pageLink) {
            await pageLink.click();
            await page.waitForTimeout(3000);
          } else {
            hasNextPage = false;
          }
        } else {
          hasNextPage = false;
        }
      }
    } catch (error) {
      console.error(`  Error on ${tabName}:`, error.message);
    }
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
}

scrapeAll().catch(console.error);
