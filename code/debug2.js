const { chromium } = require('playwright');

async function debug() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', 
           '--disable-blink-features=AutomationControlled',
           '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  await page.goto('https://www.web.dma.mil/Our-Customers/', {
    timeout: 30000,
    waitUntil: 'domcontentloaded'
  });
  
  await page.waitForTimeout(5000);
  
  // Find sidebar tabs and their click handlers
  const sidebarInfo = await page.evaluate(() => {
    const results = [];
    const sidebar = document.querySelector('[class*="sidebar"], [id*="sidebar"], [class*="menu"], [id*="menu"]');
    if (sidebar) {
      const links = sidebar.querySelectorAll('a');
      links.forEach((l, i) => {
        const text = l.textContent.trim();
        if (text.includes('Websites')) {
          results.push({
            index: i,
            text,
            href: l.href,
            onclick: l.getAttribute('onclick') || '',
            id: l.id || '',
            className: l.className || ''
          });
        }
      });
    }
    return results;
  });
  
  console.log('Sidebar tabs:', JSON.stringify(sidebarInfo, null, 2));
  
  // Find the tab content panels - which one is visible?
  const tabPanelInfo = await page.evaluate(() => {
    // Look for divs that contain the tables
    const results = [];
    document.querySelectorAll('div[id*="ViewTabs"]').forEach(div => {
      const style = window.getComputedStyle(div);
      results.push({
        id: div.id,
        display: style.display,
        visibility: style.visibility,
        className: div.className
      });
    });
    return results;
  });
  
  console.log('\nTab panels:', JSON.stringify(tabPanelInfo, null, 2));
  
  // Check which table has visible data
  const visibleTableInfo = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('table').forEach((t, i) => {
      if (t.id && t.id.includes('grdData')) {
        const style = window.getComputedStyle(t);
        const parentStyle = t.parentElement ? window.getComputedStyle(t.parentElement) : null;
        results.push({
          index: i,
          id: t.id,
          parentDisplay: parentStyle ? parentStyle.display : 'unknown',
          styleDisplay: style.display
        });
      }
    });
    return results;
  });
  
  console.log('\nVisible tables:', JSON.stringify(visibleTableInfo, null, 2));
  
  // Try clicking each sidebar tab and check which table is visible
  console.log('\n=== Testing tab -> table mapping ===');
  
  const tabs = sidebarInfo.map(t => t.text);
  
  for (let i = 0; i < Math.min(3, tabs.length); i++) {
    // Click tab
    await page.evaluate((tabName) => {
      const sidebar = document.querySelector('[class*="sidebar"], [id*="sidebar"], [class*="menu"], [id*="menu"]');
      if (sidebar) {
        const links = sidebar.querySelectorAll('a');
        for (const l of links) {
          if (l.textContent.trim() === tabName) {
            l.click();
            return;
          }
        }
      }
    }, tabs[i]);
    
    await page.waitForTimeout(2000);
    
    // Check which table has visible data now
    const currentVisible = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('table').forEach((t, i) => {
        if (t.id && t.id.includes('grdData')) {
          const parent = t.parentElement;
          const parentStyle = parent ? window.getComputedStyle(parent) : null;
          const grandparent = parent ? parent.parentElement : null;
          const gpStyle = grandparent ? window.getComputedStyle(grandparent) : null;
          
          results.push({
            id: t.id,
            parentDisplay: parentStyle ? parentStyle.display : 'unknown',
            grandparentDisplay: gpStyle ? gpStyle.display : 'unknown'
          });
        }
      });
      return results;
    });
    
    const visibleTables = currentVisible.filter(t => t.parentDisplay !== 'none' && t.grandparentDisplay !== 'none');
    console.log(`After clicking ${tabs[i]}: visible tables = ${visibleTables.map(t => t.id.split('_')[5] + '_' + t.id.split('_')[7])}`);
  }
  
  await browser.close();
}

debug().catch(console.error);
