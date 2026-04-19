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
  
  // Map: tab name -> ctl index (ctl01, ctl03, etc.)
  // Based on pagination URL pattern
  const tabCtlMap = {
    'Department of War Websites': 'ctl01',
    'Joint Websites': 'ctl02',
    'Air Force Websites': 'ctl03',
    'Army Websites': 'ctl04',
    'Army Corps of Engineers Websites': 'ctl05',
    'Marine Corps Websites': 'ctl06',
    'Navy Websites': 'ctl07',
    'Coast Guard Websites': 'ctl08',
    'National Guard Websites': 'ctl09',
    'Space Force Websites': 'ctl10',
    'Defense Health Agency Websites': 'ctl11'
  };
  
  // Get tab order by clicking each tab and checking which ctl is active
  const tabOrder = await page.evaluate(() => {
    const results = [];
    const allLinks = document.querySelectorAll('a');
    const tabLinks = Array.from(allLinks).filter(l => {
      const text = l.textContent.trim();
      return text.includes('Websites');
    });
    tabLinks.forEach(l => results.push(l.textContent.trim()));
    return results;
  });
  
  console.log('Tab order:', tabOrder);
  
  // Click tab by name
  async function clickTab(tabName) {
    return await page.evaluate((name) => {
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
  
  // Get table data for a specific Default_N
  async function getTableData(defaultIndex) {
    return await page.evaluate((idx) => {
      const tables = document.querySelectorAll('table');
      for (const t of tables) {
        if (t.id && t.id.includes(`_Default_${idx}_`) && t.id.includes('grdData')) {
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
    }, defaultIndex);
  }
  
  // Get max page for a specific ctl
  async function getMaxPage(ctlName) {
    return await page.evaluate((ctl) => {
      const allLinks = Array.from(document.querySelectorAll('a[href*="Page_"]'));
      // Filter links that belong to this ctl
      const ctlLinks = allLinks.filter(l => l.href.includes(`$${ctl}$`));
      const nums = ctlLinks
        .map(l => {
          const m = l.href.match(/Page_(\d+)/);
          return m ? parseInt(m[1]) : 0;
        })
        .filter(n => n > 0);
      return nums.length > 0 ? Math.max(...nums) : 1;
    }, ctlName);
  }
  
  // Click page for specific ctl
  async function clickPage(ctlName, pageNum) {
    return await page.evaluate((ctl, num) => {
      const allLinks = Array.from(document.querySelectorAll('a[href*="Page_"]'));
      // Find link belonging to this ctl with this page number
      for (const l of allLinks) {
        if (l.href.includes(`$${ctl}$`) && l.href.includes(`Page_${num}`)) {
          l.click();
          return true;
        }
      }
      return false;
    }, ctlName, pageNum);
  }
  
  // Map tab order to Default index
  // Based on the sample data we collected earlier:
  // 0: Department of War
  // 1: Joint
  // 2: Air Force
  // 3: Army
  // 4: Army Corps of Engineers
  // 5: Marine Corps
  // 6: Navy
  // 7: Coast Guard
  // 8: National Guard
  // 9: Space Force
  // 10: Defense Health Agency
  
  const tabDefaultMap = {
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
  
  const allData = [];
  const seenKeys = new Set();
  
  // Process each tab
  for (const tabName of tabOrder) {
    const ctl = tabCtlMap[tabName];
    const defaultIdx = tabDefaultMap[tabName];
    
    console.log(`\n=== ${tabName} (ctl=${ctl}, default=${defaultIdx}) ===`);
    
    // Click tab
    await clickTab(tabName);
    await page.waitForTimeout(2000);
    
    const maxPage = await getMaxPage(ctl);
    console.log(`  Max pages: ${maxPage}`);
    
    let tabTotal = 0;
    
    for (let p = 1; p <= maxPage; p++) {
      if (p > 1) {
        const clicked = await clickPage(ctl, p);
        if (clicked) {
          await page.waitForTimeout(2000);
        }
      }
      
      const data = await getTableData(defaultIdx);
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
    
    console.log(`  Total: ${tabTotal} rows`);
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
