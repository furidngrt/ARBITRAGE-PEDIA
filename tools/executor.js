/**
 * Tool executor — dispatches tool calls with safety checks.
 * Follows Meridian pattern: name → fn map + pre/post hooks.
 */

import { addCandidates, updateCandidate, getPendingCandidates, getCandidate, getBoughtItems, markBought, recordProfit, getProfitSummary, clearCandidates } from "../state.js";
import { addLesson } from "../lessons.js";
import config from "../config.js";

// Lazy imports for heavy scraping deps
let tokopediaScraper = null;
let shopeeScraper = null;
let bukalapakScraper = null;

async function getTokopedia() {
  if (!tokopediaScraper) tokopediaScraper = await import("./tokopedia.js");
  return tokopediaScraper;
}
async function getShopee() {
  if (!shopeeScraper) shopeeScraper = await import("./shopee.js");
  return shopeeScraper;
}
async function getBukalapak() {
  if (!bukalapakScraper) bukalapakScraper = await import("./bukalapak.js");
  return bukalapakScraper;
}

const toolMap = {
  // --- SCREENING ---
  async scan_tokopedia(args) {
    const s = await getTokopedia();
    return s.scan(args.query, {
      limit: args.limit || config.screening.maxListingsPerScan,
      minPrice: args.minPrice || config.screening.minPrice,
      maxPrice: args.maxPrice || config.screening.maxPrice,
      condition: args.condition || "bekas",
    });
  },

  async scan_shopee(args) {
    const s = await getShopee();
    return s.scan(args.query, {
      limit: args.limit || config.screening.maxListingsPerScan,
      minPrice: args.minPrice || config.screening.minPrice,
      maxPrice: args.maxPrice || config.screening.maxPrice,
    });
  },

  async scan_bukalapak(args) {
    const s = await getBukalapak();
    return s.scan(args.query, {
      limit: args.limit || config.screening.maxListingsPerScan,
      minPrice: args.minPrice || config.screening.minPrice,
      maxPrice: args.maxPrice || config.screening.maxPrice,
    });
  },

  async search_across_platforms(args) {
    const [tokopedia, shopee, bukalapak] = await Promise.all([
      getTokopedia().then(s => s.scan(args.query, { limit: args.limit || 10 }).catch(() => [])),
      getShopee().then(s => s.scan(args.query, { limit: args.limit || 10 }).catch(() => [])),
      getBukalapak().then(s => s.scan(args.query, { limit: args.limit || 10 }).catch(() => [])),
    ]);

    const allPrices = [...tokopedia, ...shopee, ...bukalapak].map(i => i.price).filter(Boolean);
    const avgPrice = allPrices.length ? Math.round(allPrices.reduce((s, p) => s + p, 0) / allPrices.length) : null;
    const minPrice = allPrices.length ? Math.min(...allPrices) : null;
    const maxPrice = allPrices.length ? Math.max(...allPrices) : null;

    return {
      query: args.query,
      totalFound: allPrices.length,
      platforms: {
        tokopedia: tokopedia.length,
        shopee: shopee.length,
        bukalapak: bukalapak.length,
      },
      priceRange: { min: minPrice, max: maxPrice, avg: avgPrice },
      listings: [...tokopedia, ...shopee, ...bukalapak].slice(0, 15),
    };
  },

  // --- DECISION ---
  save_candidate(args) {
    // Apply seller filters
    if (args.seller_transactions !== undefined && args.seller_transactions < config.seller.minTransactions) {
      return { saved: false, reason: `Seller has only ${args.seller_transactions} transactions (min ${config.seller.minTransactions})` };
    }
    if (args.seller_rating !== undefined && args.seller_rating < config.seller.minRating) {
      return { saved: false, reason: `Seller rating ${args.seller_rating} below min ${config.seller.minRating}` };
    }
    if (config.seller.blockWords && args.title) {
      const title = args.title.toLowerCase();
      const blocked = config.seller.blockWords.find(w => title.includes(w));
      if (blocked) return { saved: false, reason: `Title contains blocked word: "${blocked}"` };
    }

    const added = addCandidates([args]);
    return {
      saved: added.length > 0,
      candidateId: added[0]?.id,
      totalCandidates: getPendingCandidates().length,
    };
  },

  async compare_market_price(args) {
    // Search across all platforms for this item
    const [tokopedia, shopee] = await Promise.all([
      getTokopedia().then(s => s.scan(args.query, { limit: 20, minPrice: args.candidatePrice * 0.3, maxPrice: args.candidatePrice * 3 }).catch(() => [])),
      getShopee().then(s => s.scan(args.query, { limit: 20, minPrice: args.candidatePrice * 0.3, maxPrice: args.candidatePrice * 3 }).catch(() => [])),
    ]);

    const all = [...tokopedia, ...shopee].filter(i => i.price && i.price > 0);
    const prices = all.map(i => i.price).sort((a, b) => a - b);

    if (prices.length < 3) {
      return {
        marketPrice: args.candidatePrice,
        confidence: "low",
        comparableListings: prices.length,
        note: `Only ${prices.length} comparable listings found — insufficient data`,
      };
    }

    // Remove outliers: trim top/bottom 10%
    const trim = Math.max(1, Math.floor(prices.length * 0.1));
    const trimmed = prices.slice(trim, prices.length - trim);
    const avg = Math.round(trimmed.reduce((s, p) => s + p, 0) / trimmed.length);
    const belowMarket = args.candidatePrice < avg;
    const discount = belowMarket ? Math.round(((avg - args.candidatePrice) / avg) * 100) : 0;

    // Suggested resale: 5-10% below market avg for quick flip
    const resalePrice = avg - Math.round(avg * 0.05);

    return {
      marketPrice: avg,
      candidatePrice: args.candidatePrice,
      belowMarket,
      discountPct: discount,
      resalePrice,
      priceRange: { min: prices[0], max: prices[prices.length - 1] },
      comparableListings: prices.length,
      confidence: prices.length >= 10 ? "high" : prices.length >= 5 ? "medium" : "low",
      sampleListings: all.slice(0, 5).map(i => ({ title: i.title, price: i.price, platform: i.platform })),
    };
  },

  async check_seller_reputation(args) {
    // Quick reputation check based on available data
    const candidates = getPendingCandidates()
      .filter(c => c.seller_name === args.seller_name && c.platform === args.platform);

    if (!candidates.length) {
      return { found: false, seller_name: args.seller_name, platform: args.platform };
    }

    const seller = candidates[0];
    const rating = seller.seller_rating || 0;
    const tx = seller.seller_transactions || 0;

    const flags = [];
    if (tx < 10) flags.push("LOW_TRANSACTIONS");
    if (rating < 4.0) flags.push("LOW_RATING");
    if (tx < 50 && rating > 4.8) flags.push("POSSIBLE_FAKE_RATING");

    return {
      seller_name: args.seller_name,
      platform: args.platform,
      rating,
      transactions: tx,
      itemsFound: candidates.length,
      flags,
      risk: flags.length >= 2 ? "high" : flags.length === 1 ? "medium" : "low",
    };
  },

  calculate_margin(args) {
    const buyPrice = args.buyPrice;
    const marketPrice = args.marketPrice;
    const shipping = args.shippingEstimate || 25000;
    const platformFee = Math.round(buyPrice * 0.05);   // 5% platform fee on resale
    const paymentFee = Math.round(buyPrice * 0.015);    // ~1.5% payment processing

    const totalCost = buyPrice + platformFee + paymentFee;
    const profit = marketPrice - totalCost;
    const profitPct = Math.round((profit / buyPrice) * 100);
    const meetsMinProfit = profit >= config.margin.minProfitAbsolute && profitPct >= config.margin.minProfitPct;

    return {
      buyPrice,
      marketPrice,
      costs: {
        platformFee,
        paymentFee,
        shippingEstimate: shipping,
        totalCost,
      },
      profit,
      profitPct,
      meetsMinProfit,
      minimumRequired: { profit: config.margin.minProfitAbsolute, pct: config.margin.minProfitPct },
    };
  },

  recommend_buy(args) {
    const candidate = getCandidate(args.candidateId);
    if (!candidate) return { error: "Candidate not found" };

    updateCandidate(args.candidateId, {
      status: "recommended",
      reasoning: args.reasoning,
      confidence: args.confidence,
      expectedProfit: args.expectedProfit,
      expectedProfitPct: args.expectedProfitPct,
      risks: args.risks,
      suggestedResalePrice: args.suggestedResalePrice,
      recommendedAt: new Date().toISOString(),
    });

    return {
      recommended: true,
      candidateId: args.candidateId,
      title: candidate.title,
      buyPrice: candidate.price,
      expectedProfit: args.expectedProfit,
      platform: candidate.platform,
      url: candidate.url,
    };
  },

  get_screening_report() {
    const pending = getPendingCandidates();
    const recommended = pending.filter(c => c.status === "recommended");

    // Category breakdown
    const byCategory = {};
    for (const c of pending) {
      byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    }

    return {
      totalCandidates: pending.length,
      recommended: recommended.length,
      byCategory,
      candidates: pending.slice(0, 20).map(c => ({
        id: c.id,
        title: c.title,
        price: c.price,
        platform: c.platform,
        category: c.category,
        status: c.status,
      })),
    };
  },

  // --- ACTION ---
  relist_item(args) {
    const items = getBoughtItems();
    const item = items.find(i => i.id === args.boughtItemId);
    if (!item) return { error: "Bought item not found" };

    const markup = args.markupPct || config.margin.targetMarkupPct;
    const sellPrice = Math.round(item.buyPrice * (1 + markup / 100));

    // Generate optimized title
    const words = item.title.split(" ");
    const optimizedTitle = [
      ...words.slice(0, 3),
      "|",
      "READY STOCK",
      "|",
      "NEGO TIPIS",
      "|",
      "FAST RESPON",
    ].join(" ");

    const description = `🔥 ${item.title}
    
Kondisi: Sesuai foto (lihat semua gambar)
Garansi: Garansi pribadi 3 hari (bukan garansi toko)
Pengiriman: Hari yang sama sebelum jam 15:00
Fast respon, tanya-tanya dulu boleh 😊

#${item.category} #second #bekasberkualitas #fastrespon`;

    return {
      suggestedPrice: sellPrice,
      markupPct: markup,
      suggestedTitle: optimizedTitle,
      suggestedDescription: description,
      platform: args.platform || item.platform,
      originalBuyPrice: item.buyPrice,
      estimatedProfit: sellPrice - item.buyPrice,
      estimatedProfitPct: Math.round(((sellPrice - item.buyPrice) / item.buyPrice) * 100),
      note: "Copy-paste title & description into the listing form. Manual listing still required.",
    };
  },

  get_bought_items() {
    const items = getBoughtItems();
    return {
      count: items.length,
      items: items.map(i => ({
        id: i.id,
        title: i.title,
        buyPrice: i.buyPrice,
        platform: i.platform,
        category: i.category,
        status: i.status,
        boughtAt: i.buyDate,
        holdingDays: Math.round((Date.now() - new Date(i.buyDate).getTime()) / 86400000),
      })),
    };
  },

  record_sale(args) {
    const result = recordProfit(args.boughtItemId, args.soldPrice, args.relistUrl);
    if (!result) return { error: "Item not found" };

    // Auto-generate lesson
    const lesson = `FLIP: ${result.title} — bought Rp${result.buyPrice.toLocaleString()}, sold Rp${result.soldPrice.toLocaleString()} (+${result.profitPct}% in ${result.holdDays} days) [${result.category}]`;
    addLesson(lesson, {
      tags: ["flip", result.category],
      role: "DECIDER",
      category: result.category,
      profitPct: result.profitPct,
    });

    return {
      recorded: true,
      ...result,
    };
  },

  get_profit_summary() {
    return getProfitSummary() || { totalFlips: 0, message: "No flips recorded yet. Start scanning to find opportunities!" };
  },

  add_lesson(args) {
    const lesson = addLesson(args.rule, {
      tags: args.tags || [],
      role: args.role || "GENERAL",
      category: args.category,
      metrics: args.profitPct ? { profitPct: args.profitPct } : {},
    });
    return { added: true, lessonId: lesson.id };
  },
};

const WRITE_TOOLS = new Set(["relist_item", "record_sale", "mark_bought"]);

export async function executeTool(name, args) {
  const fn = toolMap[name];
  if (!fn) return { error: `Unknown tool: ${name}` };

  // Safety: check DRY_RUN for write tools
  if (WRITE_TOOLS.has(name) && process.env.DRY_RUN === "true") {
    return { blocked: true, reason: `DRY_RUN mode — ${name} would write state` };
  }

  try {
    const result = await fn(args);
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      tool: name,
    };
  }
}

export default executeTool;
