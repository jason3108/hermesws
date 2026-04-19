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
  
  // Tab names
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
  
  // Get table data - only get rows with valid URLs (http/https)
  async function getValidTableData() {
    try {
      return await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        const data = [];
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const site = cells[0].textContent.trim();
            const url = cells[1].textContent.trim();
            // Only include if URL starts with http (valid website)
            if (site && url && (url.startsWith('http') || url.startsWith('www'))) {
              data.push({ site, url });
            }
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
  
  // Get current page info
  async function getCurrentPageInfo() {
    try {
      return await page.evaluate(() => {
        // Find the active page indicator
        const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
        // Look for page number in brackets like [1], [2], etc
        const activeLink = links.find(l => {
          const text = l.textContent;
          return text.includes('[') && text.includes(']');
        });
        
        if (activeLink) {
          const match = activeLink.textContent.match(/\[(\d+)\]/);
          if (match) {
            return parseInt(match[1]);
          }
        }
        
        // Alternative: count total pages from all Page_ links
        const pageNums = links
          .map(l => {
            const m = l.getAttribute('href').match(/Page_(\d+)/);
            return m ? parseInt(m[1]) : 0;
          })
          .filter(n => n > 0);
        
        return pageNums.length > 0 ? Math.max(...pageNums) : 1;
      });
    } catch (e) {
      return 1;
    }
  }
  
  // Click page by number
  async function clickPage(pageNum) {
    try {
      return await page.evaluate((num) => {
        const links = document.querySelectorAll('a[href*="Page_"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && href.includes(`Page_${num}`)) {
            // Make sure we're not clicking the current page
            const text = link.textContent;
            if (!text.includes(`[${num}]`)) {
              link.click();
              return true;
            }
          }
        }
        return false;
      }, pageNum);
    } catch (e) {
      return false;
    }
  }
  
  // Wait for page to load new data
  async function waitForNewData(oldData) {
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(500);
      try {
        const newData = await getValidTableData();
        if (newData.length > 0 && JSON.stringify(newData) !== JSON.stringify(oldData)) {
          return newData;
        }
      } catch (e) {
        // ignore
      }
    }
    return await getValidTableData();
  }
  
  const allData = []; // Will store {tab, site, url}
  const seenUrls = new Set(); // For deduplication
  
  // Process each tab
  for (const tabName of tabNames) {
    console.log(`\n=== ${tabName} ===`);
    
    await clickTab(tabName);
    await page.waitForTimeout(3000);
    
    // Get first page data
    let currentData = await getValidTableData();
    let pageTotal = currentData.length;
    let pageCount = 1;
    
    console.log(`  Page 1: ${currentData.length} rows`);
    
    // Add first page data
    currentData.forEach(d => {
      const key = `${tabName}|${d.site}|${d.url}`;
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        allData.push({ category: tabName, site: d.site, url: d.url });
      }
    });
    
    // Get max pages
    const maxPage = await getCurrentPageInfo();
    console.log(`  Max pages: ${maxPage}`);
    
    // Navigate through remaining pages
    for (let p = 2; p <= maxPage; p++) {
      const clicked = await clickPage(p);
      if (clicked) {
        await page.waitForTimeout(3000);
        const newData = await getValidTableData();
        console.log(`  Page ${p}: ${newData.length} rows`);
        
        if (newData.length > 0) {
          newData.forEach(d => {
            const key = `${tabName}|${d.site}|${d.url}`;
            if (!seenUrls.has(key)) {
              seenUrls.add(key);
              allData.push({ category: tabName, site: d.site, url: d.url });
            }
          });
          pageCount++;
        }
      } else {
        console.log(`  Page ${p}: Could not click`);
      }
    }
    
    console.log(`  Subtotal for ${tabName}: ${pageTotal} (page 1) x ${pageCount} pages`);
  }
  
  console.log(`\n=== TOTAL: ${allData.length} unique records ===`);
  
  // Save to JSON for inspection
  const fs = require('fs');
  fs.writeFileSync('/home/ubuntu/dma_final_data.json', JSON.stringify(allData, null, 2));
  console.log('Saved JSON to /home/ubuntu/dma_final_data.json');
  
  // Count by category
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
