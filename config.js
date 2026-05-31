import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "user-config.json");

const DEFAULTS = {
  budget: {
    maxPerItem: 500000,
    dailyBudget: 3000000,
    maxOpenItems: 5,
    maxDailyItems: 3,
    reserveCash: 200000,
  },
  margin: {
    minProfitPct: 30,
    minProfitAbsolute: 50000,
    targetMarkupPct: 50,
    maxItemAgeDays: 14,
    priceDropThresholdPct: 20,   // alert if price drops X% from market avg
  },
  categories: [
    { id: "elektronik", keywords: ["laptop", "pc", "monitor", "keyboard", "mouse", "headset"], weight: 1.0 },
    { id: "hp-tablet", keywords: ["iphone", "samsung", "xiaomi", "ipad", "tablet", "android"], weight: 1.2 },
    { id: "fashion-pria", keywords: ["sepatu", "jam tangan", "tas pria", "dompet", "kacamata"], weight: 0.8 },
    { id: "gaming", keywords: ["ps5", "nintendo", "xbox", "steam deck", "gamepad", "Rog ally"], weight: 1.3 },
    { id: "kamera", keywords: ["sony", "canon", "fujifilm", "gopro", "dji", "lensa"], weight: 1.1 },
    { id: "hobi-koleksi", keywords: ["action figure", "tamiya", "diecast", "lego", "fidget"], weight: 0.7 },
  ],
  screening: {
    intervalMin: 15,
    maxListingsPerScan: 50,
    platforms: ["tokopedia", "shopee", "bukalapak"],
    sortBy: "newest",               // newest | cheapest | relevance
    condition: ["bekas", "second"],  // prefer used items (more margin)
    minPrice: 50000,
    maxPrice: 2000000,
  },
  seller: {
    minRating: 4.0,
    minTransactions: 10,
    blockNewSeller: true,
    blockWords: ["rusak", "mati total", "sparepart", "parts only", "retur"],
  },
  models: {
    decisionModel: "anthropic/claude-sonnet-4",
    screeningModel: "openai/gpt-4o-mini",
    generalModel: "openai/gpt-4o-mini",
    temperature: 0.3,
    maxTokens: 4096,
    maxSteps: 15,
  },
  schedule: {
    screeningIntervalMin: 15,
    dailyReportHour: 20,   // WIB — daily summary
  },
};

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key]) && base[key]) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const user = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      return deepMerge(DEFAULTS, user);
    } catch (e) {
      console.error("Invalid user-config.json, using defaults:", e.message);
    }
  }
  return DEFAULTS;
}

const config = loadConfig();

export function getConfig() { return config; }
export function updateConfig(changes) {
  Object.assign(config, deepMerge(config, changes));
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Failed to persist config:", e.message);
  }
  return config;
}

export default config;
