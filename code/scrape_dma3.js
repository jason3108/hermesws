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
      '--disable-blink-features',
      '--exclude-switches',
      '--disable-features',
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
  
  // Remove webdriver property and other automation indicators
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.navigator.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  
  // Try to detect if blocked
  page.on('response', response => {
    if (response.url().includes('web.dma.mil')) {
      console.log('Response:', response.url(), response.status());
    }
  });
  
  console.log('Navigating to site...');
  
  try {
    const response = await page.goto('https://www.web.dma.mil/Our-Customers/', {
      timeout: 30000,
      waitUntil: 'domcontentloaded'
    });
    
    console.log('Status:', response.status());
    console.log('URL:', page.url());
    
    // Wait a bit for any JS to execute
    await page.waitForTimeout(5000);
    
    // Get page content
    const title = await page.title();
    console.log('Title:', title);
    
    // Check if we got access denied
    const content = await page.content();
    if (content.includes('Access Denied')) {
      console.log('BLOCKED - Got Access Denied page');
      
      // Try to get the reference number
      const refMatch = content.match(/Reference #([^"]+)/);
      if (refMatch) {
        console.log('Reference:', refMatch[1]);
      }
    } else {
      console.log('Got access! Content length:', content.length);
      
      // Get all the links
      const links = await page.$$eval('a', els => els.map(e => ({text: e.textContent.trim(), href: e.href})).slice(0, 50));
      console.log('First 50 links:', JSON.stringify(links, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  await browser.close();
}

scrape();
