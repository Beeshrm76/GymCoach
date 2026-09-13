const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
  await page.goto('http://localhost:5000');
  
  // Wait for load
  await page.waitForTimeout(1000);
  
  const sideCollapsedBefore = await page.evaluate(() => document.querySelector('.app-shell').classList.contains('side-collapsed'));
  console.log('Before click, side-collapsed:', sideCollapsedBefore);
  
  console.log('Clicking ☰ button...');
  await page.click('.drawer-btn');
  
  await page.waitForTimeout(500);
  
  const sideCollapsedAfter = await page.evaluate(() => document.querySelector('.app-shell').classList.contains('side-collapsed'));
  console.log('After click, side-collapsed:', sideCollapsedAfter);
  
  await browser.close();
})();
