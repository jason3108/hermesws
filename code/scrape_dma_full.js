const { chromium } = require('playwright');

async function scrapeAll() {
  console.log('Launching browser...');
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  console.log('Navigating to site...');
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'networkidle'
  });
  
  await page.waitForTimeout(2000);
  
  // Get all military branch tabs (left side navigation)
  const tabs = await page.$$eval('a[href="javascript:void(0)"]', els => 
    els.map(e => e.textContent.trim()).filter(t => t.includes('Websites'))
  );
  
  console.log('Found tabs:', tabs);
  
  // Get table data function
  async function getTableData() {
    const data = await page.$$eval('table tbody tr', rows => {
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          return {
            site: cells[0].textContent.trim(),
            url: cells[1].textContent.trim()
          };
        }
        return null;
      }).filter(d => d && d.site && d.url);
    });
    return data;
  }
  
  // Click on a tab and get data
  async function clickTabAndGetData(tabText) {
    console.log(`\n=== Clicking tab: ${tabText} ===`);
    
    // Find and click the tab with this text
    const tabLink = await page.locator(`a[href="javascript:void(0)"]`, { hasText: tabText });
    await tabLink.click();
    await page.waitForTimeout(2000);
    
    let allData = [];
    let pageNum = 1;
    
    while (true) {
      console.log(`  Page ${pageNum}...`);
      
      // Wait for table to load
      await page.waitForSelector('table tbody tr', { timeout: 5000 }).catch(() => null);
      
      const data = await getTableData();
      console.log(`  Found ${data.length} rows`);
      allData = allData.concat(data);
      
      // Check for next page button
      const nextBtn = await page.locator('a[href*="Page_"]', { hasText: 'Next' });
      const nextExists = await nextBtn.count() > 0;
      
      if (!nextExists) {
        // Check if there's a page number link for next page
        const currentPageLinks = await page.$$eval('a[href*="Page_"]', els => 
          els.map(e => e.textContent.trim())
        );
        console.log(`  Available page links: ${currentPageLinks.join(', ')}`);
        
        // Try to find next page number
        const pageLinks = await page.$$('a[href*="Page_"]');
        let hasNext = false;
        for (const link of pageLinks) {
          const text = await link.textContent();
          const href = await link.getAttribute('href');
          if (href && href.includes('Page_')) {
            const pageMatch = href.match(/Page_(\d+)/);
            if (pageMatch) {
              const nextPageNum = parseInt(pageMatch[1]);
              if (nextPageNum === pageNum + 1) {
                hasNext = true;
                pageNum++;
                await link.click();
                await page.waitForTimeout(2000);
                break;
              }
            }
          }
        }
        if (!hasNext) break;
      } else {
        await nextBtn.click();
        await page.waitForTimeout(2000);
        pageNum++;
      }
    }
    
    console.log(`  Total: ${allData.length} rows`);
    return allData;
  }
  
  // Scrape all tabs
  const allResults = {};
  
  for (const tab of tabs) {
    try {
      const data = await clickTabAndGetData(tab);
      allResults[tab] = data;
    } catch (error) {
      console.error(`  Error scraping ${tab}:`, error.message);
    }
  }
  
  // Print summary
  console.log('\n\n=== SUMMARY ===');
  let total = 0;
  for (const [tab, data] of Object.entries(allResults)) {
    console.log(`${tab}: ${data.length} sites`);
    total += data.length;
  }
  console.log(`\nTotal: ${total} sites`);
  
  // Save to JSON for processing
  const fs = require('fs');
  fs.writeFileSync('/home/ubuntu/dma_scraped_data.json', JSON.stringify(allResults, null, 2));
  console.log('\nData saved to /home/ubuntu/dma_scraped_data.json');
  
  await browser.close();
}

scrapeAll().catch(console.error);
