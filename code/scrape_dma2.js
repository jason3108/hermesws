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
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  
  const page = await context.newPage();
  
  // Remove webdriver property
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  console.log('Navigating to site...');
  
  try {
    const response = await page.goto('https://www.web.dma.mil/Our-Customers/', {
      timeout: 30000,
      waitUntil: 'networkidle'
    });
    
    console.log('Status:', response.status());
    console.log('URL:', page.url());
    
    // Wait a bit for any JS to execute
    await page.waitForTimeout(3000);
    
    // Get page content
    const title = await page.title();
    console.log('Title:', title);
    
    const bodyText = await page.textContent('body');
    console.log('Body length:', bodyText.length);
    console.log('First 500 chars:', bodyText.substring(0, 500));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  await browser.close();
}

scrape();
