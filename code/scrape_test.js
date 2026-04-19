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
  
  console.log('Navigating to site...');
  
  const response = await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  console.log('Status:', response.status());
  
  // Wait for JS to render
  await page.waitForTimeout(5000);
  
  const title = await page.title();
  console.log('Title:', title);
  
  if (title.includes('Access Denied')) {
    console.log('BLOCKED - Trying again...');
    await browser.close();
    return;
  }
  
  // Get all links
  const links = await page.$$eval('a', els => els.map(e => ({
    text: e.textContent.trim(),
    href: e.href
  })));
  
  console.log('Links found:', links.length);
  
  // Filter to find tabs (left sidebar links with specific text)
  const tabLinks = links.filter(l => 
    l.text.includes('Websites') && l.href.includes('javascript')
  );
  
  console.log('Tab links:', tabLinks.map(l => l.text));
  
  // Get table data
  const tableData = await page.$$eval('table tbody tr', rows => {
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        return {
          site: cells[0].textContent.trim(),
          url: cells[1].textContent.trim()
        };
      }
      return null;
    }).filter(d => d);
  });
  
  console.log('Table data from first page:', tableData.length, 'rows');
  console.log(tableData.slice(0, 5));
  
  await browser.close();
}

scrape().catch(console.error);
