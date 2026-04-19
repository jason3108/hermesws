const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

async function scrape() {
  console.log('1. Launching browser...');
  
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
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  console.log('2. Navigating...');
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'networkidle'
  });
  
  console.log('3. Waiting for content...');
  await page.waitForTimeout(5000);
  
  console.log('4. Getting tabs...');
  
  // Get tabs
  const tabNames = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href="javascript:void(0)"]'))
      .map(el => el.textContent.trim())
      .filter(t => t.includes('Websites'));
  });
  
  console.log('   Tabs found:', tabNames.length);
  console.log('   Names:', tabNames);
  
  // Get data from each tab
  const results = [];
  
  for (const tab of tabNames) {
    console.log(`\n5. Processing tab: ${tab}`);
    
    // Click tab
    await page.evaluate((name) => {
      const links = document.querySelectorAll('a[href="javascript:void(0)"]');
      for (const l of links) {
        if (l.textContent.trim() === name) {
          l.click();
          return;
        }
      }
    }, tab);
    
    await page.waitForTimeout(3000);
    
    // Get page count
    const pageCount = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="Page_"]'));
      const nums = links.map(l => {
        const m = l.getAttribute('href').match(/Page_(\d+)/);
        return m ? parseInt(m[1]) : 0;
      }).filter(n => n > 0);
      return Math.max(...nums, 1);
    });
    
    console.log(`   Pages: ${pageCount}`);
    
    // Get first page data
    const data = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      const items = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const site = cells[0].textContent.trim();
          const url = cells[1].textContent.trim();
          if (site && url) items.push({ site, url });
        }
      });
      return items;
    });
    
    console.log(`   First page rows: ${data.length}`);
    
    // Collect all pages
    let allPageData = [...data];
    
    if (pageCount > 1) {
      for (let p = 2; p <= pageCount; p++) {
        // Click page number
        const clicked = await page.evaluate((pageNum) => {
          const links = document.querySelectorAll('a[href*="Page_"]');
          for (const l of links) {
            if (l.getAttribute('href').includes(`Page_${pageNum}`)) {
              l.click();
              return true;
            }
          }
          return false;
        }, p);
        
        if (clicked) {
          await page.waitForTimeout(2000);
          const pageData = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr');
            const items = [];
            rows.forEach(row => {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 2) {
                const site = cells[0].textContent.trim();
                const url = cells[1].textContent.trim();
                if (site && url) items.push({ site, url });
              }
            });
            return items;
          });
          allPageData = allPageData.concat(pageData);
          console.log(`   Page ${p} rows: ${pageData.length}`);
        }
      }
    }
    
    results.push({ tab, data: allPageData });
    console.log(`   Total for ${tab}: ${allPageData.length}`);
  }
  
  // Flatten and save
  const flatData = [];
  results.forEach(r => {
    r.data.forEach(d => {
      flatData.push({ category: r.tab, site: d.site, url: d.url });
    });
  });
  
  console.log(`\n6. Total records: ${flatData.length}`);
  
  // Create Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DMA Websites');
  sheet.addRow(['Category', 'Site', 'URL']);
  flatData.forEach(row => sheet.addRow([row.category, row.site, row.url]));
  await workbook.xlsx.writeFile('/home/ubuntu/mulweb2.xlsx');
  console.log('7. Saved to /home/ubuntu/mulweb2.xlsx');
  
  await browser.close();
  console.log('Done!');
}

scrape().catch(e => { console.error('Error:', e); process.exit(1); });
