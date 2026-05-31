/**
 * Bukalapak Scraper — simpler than Tokopedia/Shopee, good for electronics.
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
  const { limit = 30, minPrice = 50000, maxPrice = 2000000 } = opts;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "id-ID",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.bukalapak.com/products?search%5Bkeywords%5D=${encoded}&search%5Bcondition%5D=used&search%5Bmin_price%5D=${minPrice}&search%5Bmax_price%5D=${maxPrice}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const listings = await page.evaluate((maxItems) => {
      const items = [];
      const cards = document.querySelectorAll('.bl-product-card, .te-product-card, [data-testid="product-card"]');

      for (const card of cards) {
        if (items.length >= maxItems) break;
        try {
          const titleEl = card.querySelector('.bl-text--ellipsis__2, .bl-product-card__description, a[data-testid="product-card-link"]');
          const priceEl = card.querySelector('.bl-text--subheading-4, .bl-product-card__price, [data-testid="product-card-price"]');
          const linkEl = card.querySelector('a[href*="/products/"]');
          const sellerEl = card.querySelector('.bl-product-card__seller, [data-testid="product-card-seller"]');
          const ratingEl = card.querySelector('.bl-product-card__rating, [data-testid="product-card-rating"]');
          const imgEl = card.querySelector('img');

          const title = titleEl?.textContent?.trim() || "";
          const priceText = priceEl?.textContent?.replace(/[^\d]/g, "") || "0";
          const url = linkEl?.href || "";
          const seller = sellerEl?.textContent?.trim() || "";
          const ratingText = ratingEl?.textContent?.trim() || "";

          const price = parseInt(priceText) || 0;
          const rating = parseFloat(ratingText) || 0;
          const image = imgEl?.src || "";

          if (title && price > 0) {
            items.push({
              title,
              price,
              url,
              platform: "bukalapak",
              seller_name: seller,
              seller_rating: rating,
              seller_transactions: 0,
              location: "",
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
    return { error: `Bukalapak scan failed: ${error.message}`, platform: "bukalapak", query };
  } finally {
    await context.close();
  }
}

export default { scan };
