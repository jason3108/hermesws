const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

async function scrape() {
  console.log('Launching browser...');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.navigator.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  console.log('Navigating to https://www.web.dma.mil/Our-Customers/...');

  try {
    await page.goto('https://www.web.dma.mil/Our-Customers/', {
      timeout: 30000,
      waitUntil: 'domcontentloaded'
    });
    await page.waitForTimeout(8000);
    console.log('Page loaded successfully!');
  } catch (e) {
    console.log('Navigation error:', e.message);
    await browser.close();
    return;
  }

  // Get unique tab list
  const tabNames = await page.evaluate(() => {
    const seen = new Set();
    const results = [];
    const allLinks = document.querySelectorAll('a');
    for (const l of allLinks) {
      const text = l.textContent.trim();
      if (text.includes('Websites') && !seen.has(text)) {
        seen.add(text);
        results.push(text);
      }
    }
    return results;
  });

  console.log('Tabs found:', tabNames);

  // Category to Default index mapping (based on tab order)
  const tabDefaultMap = {
    'Department of War Websites': 0,
    'Joint Websites': 1,
    'Air Force Websites': 2,
    'Army Websites': 3,
    'Army Corps of Engineers Websites': 4,
    'Marine Corps Websites': 5,
    'Navy Websites': 6,
    'Coast Guard Websites': 7,
    'National Guard Websites': 8,
    'Space Force Websites': 9,
    'Defense Health Agency Websites': 10
  };

  // Category to ctl mapping (for pagination)
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

  // Get table data for specific Default index
  async function getTableData(defaultIdx) {
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
    }, defaultIdx);
  }

  // Get max page number for specific ctl
  async function getMaxPage(ctlName) {
    return await page.evaluate((ctl) => {
      const allLinks = Array.from(document.querySelectorAll('a[href*="Page_"]'));
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

  // Click page number for specific ctl - FIXED to use single object argument
  async function clickPage(ctlName, pageNum) {
    return await page.evaluate((args) => {
      const { ctl, num } = args;
      const allLinks = Array.from(document.querySelectorAll('a[href*="Page_"]'));
      for (const l of allLinks) {
        if (l.href.includes(`$${ctl}$`) && l.href.includes(`Page_${num}`)) {
          l.click();
          return true;
        }
      }
      return false;
    }, { ctl: ctlName, num: pageNum });
  }

  const allData = [];
  const seenKeys = new Set(); // For deduplication: category + url

  // Process each tab
  for (const tabName of tabNames) {
    const ctl = tabCtlMap[tabName];
    const defaultIdx = tabDefaultMap[tabName];

    console.log(`\n=== ${tabName} ===`);

    // Click tab
    await clickTab(tabName);
    await page.waitForTimeout(2000);

    // Get max pages
    const maxPage = await getMaxPage(ctl);
    console.log(`  Max pages: ${maxPage}`);

    let tabTotal = 0;

    // Process each page
    for (let p = 1; p <= maxPage; p++) {
      if (p > 1) {
        const clicked = await clickPage(ctl, p);
        if (clicked) {
          await page.waitForTimeout(2000);
        } else {
          console.log(`  Warning: Could not click page ${p}`);
        }
      }

      const data = await getTableData(defaultIdx);
      console.log(`  Page ${p}: ${data.length} rows`);

      // Add with deduplication
      let newCount = 0;
      data.forEach(d => {
        const key = `${tabName}|${d.url}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allData.push({ category: tabName, site: d.site, url: d.url });
          newCount++;
        }
      });
      if (newCount < data.length) {
        console.log(`    (${data.length - newCount} duplicates skipped)`);
      }

      tabTotal += data.length;
    }
    console.log(`  Total: ${tabTotal} rows, ${seenKeys.has(tabName) ? 'recorded' : 'added'}`);
  }

  console.log(`\n=== TOTAL: ${allData.length} unique records ===`);

  // Summary by category
  const byCat = {};
  allData.forEach(r => {
    byCat[r.category] = (byCat[r.category] || 0) + 1;
  });
  console.log('\nBy category:');
  for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // Save Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DMA Websites');
  sheet.addRow(['Category', 'Site', 'URL']);
  allData.forEach(row => sheet.addRow([row.category, row.site, row.url]));
  await workbook.xlsx.writeFile('/home/ubuntu/mulweb2.xlsx');
  console.log('\nSaved: /home/ubuntu/mulweb2.xlsx');

  // Also save JSON backup
  const fs = require('fs');
  fs.writeFileSync('/home/ubuntu/dma_scrape_data.json', JSON.stringify(allData, null, 2));
  console.log('Backup: /home/ubuntu/dma_scrape_data.json');

  await browser.close();
  console.log('\nDone!');
}

scrape().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
