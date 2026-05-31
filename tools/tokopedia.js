/**
 * Tokopedia Scraper — Playwright-based with anti-bot detection bypass.
 * Scrapes search results for undervalued items.
 * 
 * Strategy: search URL pattern → parse listing cards → extract structured data.
 * No login required for search results.
 */

import { chromium } from "playwright";

let _browser = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });
  return _browser;
}

export async function scan(query, opts = {}) {
  const {
    limit = 50,
    minPrice = 50000,
    maxPrice = 2000000,
    condition = "bekas",
  } = opts;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  });

  // Anti-bot: hide automation
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    // Build search URL
    const searchQuery = `${query} ${condition === "bekas" ? "bekas" : ""}`.trim();
    const encoded = encodeURIComponent(searchQuery);
    const url = `https://www.tokopedia.com/search?q=${encoded}&source=search&pmax=${maxPrice}&pmin=${minPrice}&condition=2`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000); // let dynamic content load

    // Extract listings from DOM
    const listings = await page.evaluate((maxItems) => {
      const items = [];
      const cards = document.querySelectorAll('[data-testid="divProductWrapper"], [data-testid="master-product-card"], .css-1aszvby');

      for (const card of cards) {
        if (items.length >= maxItems) break;

        try {
          const titleEl = card.querySelector('[data-testid="linkProductName"], .css-1bjwylw, .prd_link-product-name');
          const priceEl = card.querySelector('[data-testid="linkProductPrice"], .css-o5uqvq, .prd_link-product-price');
          const linkEl = card.querySelector('a[href*="/ta/"]');
          const sellerEl = card.querySelector('[data-testid="linkProductShopname"], .css-1kr22w3');
          const locationEl = card.querySelector('[data-testid="linkProductShopLocation"], .css-1kdc32b');
          const ratingEl = card.querySelector('[data-testid="linkProductRating"], .css-1q2jfqu');
          const soldEl = card.querySelector('[data-testid="linkProductSold"], .css-1q2jfqu');
          const imgEl = card.querySelector('img');

          const title = titleEl?.textContent?.trim() || "";
          const priceText = priceEl?.textContent?.trim() || "0";
          const url = linkEl?.href || "";
          const seller = sellerEl?.textContent?.trim() || "";
          const location = locationEl?.textContent?.trim() || "";
          const ratingText = ratingEl?.textContent?.trim() || "";
          const soldText = soldEl?.textContent?.replace(/\D/g, "") || "0";
          const image = imgEl?.src || "";

          // Parse price: "Rp 1.500.000" → 1500000
          const price = parseInt(priceText.replace(/[^\d]/g, "")) || 0;

          // Parse rating: "4.8" → 4.8
          const rating = parseFloat(ratingText) || 0;

          // Parse sold count
          const sold = parseInt(soldText) || 0;

          if (title && price > 0) {
            items.push({
              title,
              price,
              url,
              platform: "tokopedia",
              seller_name: seller,
              seller_rating: rating,
              seller_transactions: sold,
              location,
              condition: "bekas",
              image_count: 1,
              image_url: image,
              description: title, // search results don't show full description
            });
          }
        } catch (e) {
          // skip malformed cards
        }
      }

      return items;
    }, limit);

    return listings;
  } catch (error) {
    return { error: `Tokopedia scan failed: ${error.message}`, platform: "tokopedia", query };
  } finally {
    await context.close();
  }
}

export default { scan };
