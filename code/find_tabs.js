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
  
  // Get tab names and their IDs
  const tabInfo = await page.evaluate(() => {
    const tabs = [];
    // Look for the tabs - they have specific class patterns
    document.querySelectorAll('a').forEach(a => {
      const text = a.textContent.trim();
      const href = a.href || '';
      // Tab links are in a specific structure
      if (href.includes('ViewTabs')) {
        tabs.push({ text, href });
      }
    });
    
    // Alternative: find tabs by their parent container class
    const tabContainerTabs = [];
    document.querySelectorAll('a[href*="ViewTabs"]').forEach(a => {
      const text = a.textContent.trim();
      if (text.includes('Websites')) {
        tabContainerTabs.push(text);
      }
    });
    
    return { tabs: tabs.slice(0, 15), tabContainerTabs };
  });
  
  console.log('Tabs with ViewTabs href:', tabInfo.tabs.length);
  console.log('Tab container tabs:', tabInfo.tabContainerTabs);
  
  // Find tab names from left sidebar
  const sidebarTabs = await page.evaluate(() => {
    // The left sidebar has links to switch tabs
    const results = [];
    
    // Look for specific pattern in the page structure
    // Tab switching is done via JavaScript
    const links = Array.from(document.querySelectorAll('a[href*="ViewTabs"], a[onclick*="ViewTabs"]'));
    
    // Find all clickable elements with Website-related text
    const allWebElements = Array.from(document.querySelectorAll('*')).filter(el => {
      return el.childNodes.length === 1 && 
             el.textContent.trim().includes('Websites') &&
             (el.tagName === 'A' || el.getAttribute('href')?.includes('javascript'));
    });
    
    // Get unique tab names from the sidebar
    const sidebar = document.querySelector('[class*="sidebar"], [id*="sidebar"], [class*="menu"], [id*="menu"]');
    if (sidebar) {
      const links = sidebar.querySelectorAll('a');
      links.forEach(l => {
        const text = l.textContent.trim();
        if (text.includes('Websites') || text.includes('Joint') || text.includes('Army') || 
            text.includes('Air') || text.includes('Navy') || text.includes('Marine') || 
            text.includes('Coast') || text.includes('National') || text.includes('Space') || 
            text.includes('Defense')) {
          results.push(text);
        }
      });
    }
    
    // Also check main content area
    const mainContent = document.querySelector('#content, #main, .content, .main');
    if (mainContent) {
      const links = mainContent.querySelectorAll('a');
      links.forEach(l => {
        const text = l.textContent.trim();
        if (text.includes('Websites') && !results.includes(text)) {
          results.push(text);
        }
      });
    }
    
    return [...new Set(results)];
  });
  
  console.log('Sidebar tabs found:', sidebarTabs);
  
  await browser.close();
}

scrape().catch(console.error);
