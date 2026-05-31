import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_PATH = path.join(__dirname, "data", "lessons.json");
const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function load() {
  if (!fs.existsSync(LESSONS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(LESSONS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function save(data) {
  fs.writeFileSync(LESSONS_PATH, JSON.stringify(data, null, 2));
}

export function addLesson(rule, { tags = [], role = "GENERAL", pinned = false, metrics = {} } = {}) {
  const lessons = load();
  const lesson = {
    id: lessons.length + 1,
    rule,
    tags,
    role: role.toUpperCase(),
    pinned,
    createdAt: new Date().toISOString(),
    metrics,
  };
  lessons.push(lesson);
  save(lessons);
  return lesson;
}

export function getLessonsForPrompt({ role = "GENERAL", maxLessons = 8 } = {}) {
  const lessons = load();
  if (!lessons.length) return null;

  const targeted = role.toUpperCase();

  // Pinned first, then most recent, filtered by role
  const relevant = lessons
    .filter(l => l.pinned || l.role === targeted || l.role === "GENERAL" || targeted === "GENERAL")
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.id - a.id;
    })
    .slice(0, maxLessons);

  if (!relevant.length) return null;

  return relevant
    .map(l => `${l.pinned ? "📌 " : ""}${l.rule}${l.metrics.profit ? ` (avg profit: +${l.metrics.profit}%)` : ""}`)
    .join("\n");
}

export function getPerformanceSummary() {
  const lessons = load();
  const withMetrics = lessons.filter(l => l.metrics && l.metrics.profit);
  if (!withMetrics.length) return null;

  const latest = withMetrics.slice(-10);
  const avgProfit = Math.round(latest.reduce((s, l) => s + l.metrics.profit, 0) / latest.length);
  const bestCategory = {};
  for (const l of withMetrics) {
    const cat = l.metrics.category || "unknown";
    if (!bestCategory[cat]) bestCategory[cat] = { count: 0, totalProfit: 0 };
    bestCategory[cat].count++;
    bestCategory[cat].totalProfit += l.metrics.profit;
  }

  const lines = [`${withMetrics.length} lessons from past flips | avg profit: +${avgProfit}%`];
  const sorted = Object.entries(bestCategory)
    .sort((a, b) => b[1].totalProfit / b[1].count - a[1].totalProfit / a[1].count);
  for (const [cat, data] of sorted.slice(0, 3)) {
    lines.push(`  ${cat}: avg +${Math.round(data.totalProfit / data.count)}% (${data.count} flips)`);
  }
  return lines.join("\n");
}

export function evolveThresholds() {
  const lessons = load();
  const withMetrics = lessons.filter(l => l.metrics && l.metrics.profitPct != null);
  if (withMetrics.length < 5) return null;

  const byCategory = {};
  for (const l of withMetrics) {
    const cat = l.metrics.category || "unknown";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(l.metrics.profitPct);
  }

  const adjustments = {};
  for (const [cat, profits] of Object.entries(byCategory)) {
    const avg = profits.reduce((s, p) => s + p, 0) / profits.length;
    // Category with high avg profit → increase weight (scan more)
    if (avg > 50 && profits.length >= 3) {
      adjustments[cat] = { action: "boost", reason: `avg ${Math.round(avg)}% profit over ${profits.length} flips` };
    } else if (avg < 0 && profits.length >= 3) {
      adjustments[cat] = { action: "deprioritize", reason: `avg ${Math.round(avg)}% loss` };
    }
  }

  return adjustments;
}
