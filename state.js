import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const PROFIT_LOG_PATH = path.join(DATA_DIR, "profit-log.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function ensure(path, fallback) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    fs.writeFileSync(path, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function save(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// --- State: active/candidate/bought items ---
function loadState() {
  return ensure(STATE_PATH, {
    candidates: [],       // items found during screening
    recommendations: [],  // items recommended to buy
    bought: [],           // items purchased (tracking for relist)
    listed: [],           // items we relisted for sale
    sold: [],             // flipped items
    screeningRunAt: null,
    lastDecideAt: null,
  });
}

export function getState() { return loadState(); }

export function getStateSummary() {
  const s = loadState();
  const parts = [];
  if (s.candidates.length) parts.push(`${s.candidates.length} candidates from last scan`);
  if (s.recommendations.length) parts.push(`${s.recommendations.length} buy recommendations`);
  if (s.bought.length) parts.push(`${s.bought.length} items bought (tracking for flip)`);
  if (s.listed.length) parts.push(`${s.listed.length} items currently listed for sale`);
  if (s.sold.length) parts.push(`${s.sold.length} items successfully flipped`);
  if (s.screeningRunAt) {
    const ago = Math.round((Date.now() - new Date(s.screeningRunAt).getTime()) / 60000);
    parts.push(`Last scan: ${ago}m ago`);
  }
  return parts.length ? parts.join(" | ") : "No active items. Ready to scan.";
}

// --- Candidate operations ---
export function addCandidates(items) {
  const state = loadState();
  const existing = new Set(state.candidates.map(c => c.url));
  const added = [];
  for (const item of items) {
    if (!existing.has(item.url)) {
      item.id = `cand_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      item.foundAt = new Date().toISOString();
      item.status = "pending";
      state.candidates.push(item);
      existing.add(item.url);
      added.push(item);
    }
  }
  state.screeningRunAt = new Date().toISOString();
  save(STATE_PATH, state);
  return added;
}

export function getPendingCandidates() {
  return loadState().candidates.filter(c => c.status === "pending");
}

export function getCandidate(id) {
  return loadState().candidates.find(c => c.id === id);
}

export function updateCandidate(id, updates) {
  const state = loadState();
  const idx = state.candidates.findIndex(c => c.id === id);
  if (idx >= 0) {
    Object.assign(state.candidates[idx], updates);
    save(STATE_PATH, state);
    return state.candidates[idx];
  }
  return null;
}

export function clearCandidates() {
  const state = loadState();
  state.candidates = [];
  save(STATE_PATH, state);
}

// --- Bought items ---
export function markBought(candidateId, actualPrice) {
  const state = loadState();
  const cand = state.candidates.find(c => c.id === candidateId);
  if (!cand) return null;
  cand.status = "bought";
  const bought = {
    id: `buy_${Date.now()}`,
    candidateId,
    title: cand.title,
    platform: cand.platform,
    buyPrice: actualPrice || cand.price,
    buyDate: new Date().toISOString(),
    category: cand.category,
    url: cand.url,
    status: "holding",   // holding | listed | sold
    relistUrl: null,
    soldPrice: null,
    soldDate: null,
  };
  state.bought.push(bought);
  save(STATE_PATH, state);
  return bought;
}

export function getBoughtItems() {
  return loadState().bought.filter(b => b.status !== "sold");
}

// --- Profit tracking ---
export function recordProfit(boughtId, soldPrice, relistUrl) {
  const state = loadState();
  const item = state.bought.find(b => b.id === boughtId);
  if (!item) return null;
  item.status = "sold";
  item.soldPrice = soldPrice;
  item.soldDate = new Date().toISOString();
  item.relistUrl = relistUrl;

  const profit = {
    itemId: boughtId,
    title: item.title,
    category: item.category,
    buyPrice: item.buyPrice,
    soldPrice,
    profit: soldPrice - item.buyPrice,
    profitPct: Math.round(((soldPrice - item.buyPrice) / item.buyPrice) * 100),
    holdDays: Math.round((Date.now() - new Date(item.buyDate).getTime()) / 86400000),
    recordedAt: new Date().toISOString(),
  };
  state.sold.push(profit);

  // Save to profit log
  const log = ensure(PROFIT_LOG_PATH, []);
  log.push(profit);
  save(PROFIT_LOG_PATH, log);
  save(STATE_PATH, state);
  return profit;
}

export function getProfitSummary() {
  const log = ensure(PROFIT_LOG_PATH, []);
  if (!log.length) return null;
  const total = log.reduce((s, p) => s + p.profit, 0);
  const avgPct = Math.round(log.reduce((s, p) => s + p.profitPct, 0) / log.length);
  const wins = log.filter(p => p.profit > 0).length;
  return {
    totalProfit: total,
    avgProfitPct: avgPct,
    totalFlips: log.length,
    winRate: Math.round((wins / log.length) * 100),
    recentFlips: log.slice(-5).reverse(),
  };
}
