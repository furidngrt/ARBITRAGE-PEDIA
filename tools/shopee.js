/**
 * Shopee Scraper — Playwright-based.
 * Shopee uses API-backed rendering — we parse the SSR HTML.
 */

import { chromium } from "playwright";

let _browser = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  return _browser;
}

export async function scan(query, opts = {}) {
  const { limit = 50, minPrice = 50000, maxPrice = 2000000 } = opts;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://shopee.co.id/search?keyword=${encoded}&minPrice=${minPrice}&maxPrice=${maxPrice}&condition=1`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000); // Shopee is slower to render

    const listings = await page.evaluate((maxItems) => {
      const items = [];
      const cards = document.querySelectorAll('[data-sqe="item"], .shopee-search-item-result__item, .col-xs-2-4');

      for (const card of cards) {
        if (items.length >= maxItems) break;
        try {
          const titleEl = card.querySelector('[data-sqe="name"], .Cve6sh, .shopee-item-card--link');
          const priceEl = card.querySelector('[data-sqe="price"], .ZEgDH9, .shopee-item-card__current-price');
          const linkEl = card.querySelector('a[data-sqe="link"]');
          const soldEl = card.querySelector('[data-sqe="sold"], .r6HknA');
          const locationEl = card.querySelector('[data-sqe="location"], .zGGwiV');
          const imgEl = card.querySelector('img');

          const title = titleEl?.textContent?.trim() || "";
          const priceText = priceEl?.textContent?.replace(/[^\d]/g, "") || "0";
          const url = linkEl?.href || "";
          const soldText = soldEl?.textContent?.replace(/\D/g, "") || "0";
          const location = locationEl?.textContent?.trim() || "";
          const image = imgEl?.src || "";

          const price = parseInt(priceText) || 0;
          const sold = parseInt(soldText) || 0;

          if (title && price > 0) {
            items.push({
              title,
              price,
              url,
              platform: "shopee",
              seller_name: "", // Shopee search results don't show seller name reliably
              seller_rating: 0,
              seller_transactions: sold,
              location,
              condition: "bekas",
              image_count: 1,
              image_url: image,
              description: title,
            });
          }
        } catch (e) {}
      }
      return items;
    }, limit);

    return listings;
  } catch (error) {
    return { error: `Shopee scan failed: ${error.message}`, platform: "shopee", query };
  } finally {
    await context.close();
  }
}

export default { scan };
