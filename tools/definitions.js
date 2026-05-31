/**
 * Tool definitions in OpenAI function-calling format.
 * These are what the LLM sees and can call.
 */

import config from "../config.js";

export const toolDefinitions = [
  // ═══════════════════ SCREENING TOOLS ═══════════════════
  {
    type: "function",
    function: {
      name: "scan_tokopedia",
      description: `Scan Tokopedia for items matching configured categories and keywords.
Returns up to ${config.screening.maxListingsPerScan} listings sorted by newest.
Each listing includes: title, price, url, seller name, seller rating, seller transactions, condition, location, image count.
Use this as the primary tool for finding arbitrage opportunities on Tokopedia.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query — use category keywords from config. Example: 'iphone bekas' or 'ps5 second'"
          },
          limit: {
            type: "number",
            description: `Max results (default ${config.screening.maxListingsPerScan})`
          },
          minPrice: { type: "number", description: `Minimum price in IDR (default ${config.screening.minPrice})` },
          maxPrice: { type: "number", description: `Maximum price in IDR (default ${config.screening.maxPrice})` },
          condition: {
            type: "string",
            enum: ["bekas", "baru", "semua"],
            description: "Filter by condition. Prefer 'bekas' for higher margin."
          }
        },
        required: ["query"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "scan_shopee",
      description: `Scan Shopee for items matching a search query.
Returns listings with: title, price, url, seller, rating, sold count, location, condition.
Shopee has strong buyer protection — good for higher-value flips.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results" },
          minPrice: { type: "number" },
          maxPrice: { type: "number" },
        },
        required: ["query"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "scan_bukalapak",
      description: `Scan Bukalapak for items. Good for electronics and gaming categories.
Returns listings with title, price, url, seller, rating, condition.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number" },
          minPrice: { type: "number" },
          maxPrice: { type: "number" },
        },
        required: ["query"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "search_across_platforms",
      description: `Search for the same item across Tokopedia, Shopee, and Bukalapak simultaneously.
Use this to compare prices for a specific product across all platforms.
Returns results grouped by platform with price range and availability.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Exact product name to search across all platforms" },
          limit: { type: "number", description: "Max results per platform (default 10)" },
        },
        required: ["query"]
      }
    }
  },

  // ═══════════════════ DECISION TOOLS ═══════════════════
  {
    type: "function",
    function: {
      name: "save_candidate",
      description: `Save a listing as a candidate for decision review.
Store all relevant fields so the DECIDER agent can evaluate.
Call this for each promising listing found during screening.`,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Product title" },
          price: { type: "number", description: "Listing price in IDR" },
          url: { type: "string", description: "Product URL" },
          platform: { type: "string", enum: ["tokopedia", "shopee", "bukalapak"], description: "Marketplace" },
          category: { type: "string", description: "Category from config (elektronik, hp-tablet, gaming, etc.)" },
          seller_name: { type: "string" },
          seller_rating: { type: "number", description: "Seller rating 0-5" },
          seller_transactions: { type: "number", description: "Number of completed transactions" },
          condition: { type: "string", enum: ["bekas", "baru", "tidak_diketahui"] },
          image_count: { type: "number" },
          location: { type: "string", description: "Seller city/province" },
          description: { type: "string", description: "Product description snippet (first 200 chars)" },
        },
        required: ["title", "price", "url", "platform", "category"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "compare_market_price",
      description: `Estimate the fair market price of an item by checking prices across all platforms.
Returns: avg market price, lowest price, highest price, number of listings found, and the recommended resale price.
Use this for EVERY candidate before recommending a buy.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The item name to search for market comparison" },
          category: { type: "string", description: "Category for context" },
          candidatePrice: { type: "number", description: "The candidate's listing price for margin calculation" },
        },
        required: ["query", "candidatePrice"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "check_seller_reputation",
      description: `Deep-check a seller's reputation.
Looks for: reputation score, transaction history, review quality, return rate, and any red flags.
Use for sellers with < 100 transactions or any suspicion.`,
      parameters: {
        type: "object",
        properties: {
          seller_name: { type: "string", description: "Seller username" },
          platform: { type: "string", enum: ["tokopedia", "shopee", "bukalapak"] },
        },
        required: ["seller_name", "platform"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "calculate_margin",
      description: `Calculate estimated flip profit for a candidate.
Accounts for: platform fee (5%), shipping estimate, payment fee.
Returns estimated profit in IDR and percentage.
Always call this before recommending a buy.`,
      parameters: {
        type: "object",
        properties: {
          buyPrice: { type: "number", description: "The listing price" },
          marketPrice: { type: "number", description: "Estimated resale market price" },
          shippingEstimate: { type: "number", description: "Estimated shipping cost (default 25000)" },
        },
        required: ["buyPrice", "marketPrice"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "recommend_buy",
      description: `Recommend a candidate for purchase.
This is the final decision tool. The orchestrator will send a Telegram alert with Buy/Skip buttons.
Include clear reasoning: why this item, expected profit, confidence level, and any risks.`,
      parameters: {
        type: "object",
        properties: {
          candidateId: { type: "string", description: "ID from save_candidate" },
          reasoning: { type: "string", description: "Why this is a good buy — be specific" },
          confidence: { type: "number", description: "Confidence score 0-1" },
          expectedProfit: { type: "number", description: "Estimated profit in IDR" },
          expectedProfitPct: { type: "number", description: "Estimated profit percentage" },
          risks: { type: "string", description: "Any risks or concerns" },
          suggestedResalePrice: { type: "number", description: "Optimal resale price" },
        },
        required: ["candidateId", "reasoning", "confidence"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "get_screening_report",
      description: `Get the current screening report: how many candidates found, their categories, price distribution.
Also returns candidates that passed seller checks vs. those that were rejected.`,
      parameters: { type: "object", properties: {} }
    }
  },

  // ═══════════════════ ACTION TOOLS ═══════════════════
  {
    type: "function",
    function: {
      name: "relist_item",
      description: `Create a relisting on the same platform with optimal title, description, and price.
Generates AI-optimized listing: SEO-friendly title, compelling description, strategic pricing.
Returns the relist URL and estimated listing performance.`,
      parameters: {
        type: "object",
        properties: {
          boughtItemId: { type: "string", description: "ID from mark_bought / bought items list" },
          markupPct: {
            type: "number",
            description: `Markup percentage above buy price. Default: ${config.margin.targetMarkupPct}%`
          },
          platform: { type: "string", description: "Platform to relist on (same platform by default)" },
        },
        required: ["boughtItemId"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "get_bought_items",
      description: "List all items that have been bought and are awaiting resale. Shows holding time, buy price, and current status.",
      parameters: { type: "object", properties: {} }
    }
  },

  {
    type: "function",
    function: {
      name: "record_sale",
      description: `Record that a bought item has been sold. Updates profit tracking and triggers lesson generation.
Use this after successfully flipping an item.`,
      parameters: {
        type: "object",
        properties: {
          boughtItemId: { type: "string" },
          soldPrice: { type: "number", description: "Actual selling price in IDR" },
          relistUrl: { type: "string", description: "URL where it was sold (optional)" },
        },
        required: ["boughtItemId", "soldPrice"]
      }
    }
  },

  // ═══════════════════ LEARNING TOOLS ═══════════════════
  {
    type: "function",
    function: {
      name: "get_profit_summary",
      description: "Get the complete profit/loss summary: total flips, win rate, avg profit %, best categories, recent flips.",
      parameters: { type: "object", properties: {} }
    }
  },

  {
    type: "function",
    function: {
      name: "add_lesson",
      description: `Save a lesson learned from a flip (or missed opportunity).
Examples: "iphone bekas kondisi 90% selalu laku 1-3 hari", "hindari seller tanpa foto asli"`,
      parameters: {
        type: "object",
        properties: {
          rule: { type: "string", description: "Concrete, actionable lesson" },
          tags: { type: "array", items: { type: "string" }, description: "Tags like ['category', 'seller', 'pricing']" },
          role: { type: "string", enum: ["SCREENER", "DECIDER", "GENERAL"] },
          category: { type: "string", description: "Which category this applies to" },
          profitPct: { type: "number", description: "If from a flip, the profit % achieved" },
        },
        required: ["rule"]
      }
    }
  },
];

export const SCREENER_TOOLS = new Set([
  "scan_tokopedia", "scan_shopee", "scan_bukalapak",
  "search_across_platforms", "save_candidate", "get_screening_report",
  "check_seller_reputation",
]);

export const DECIDER_TOOLS = new Set([
  "compare_market_price", "check_seller_reputation",
  "calculate_margin", "recommend_buy", "get_screening_report",
  "save_candidate", "search_across_platforms",
]);

export const ACTION_TOOLS = new Set([
  "relist_item", "get_bought_items", "record_sale",
  "get_profit_summary", "add_lesson",
]);

export default toolDefinitions;
