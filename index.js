#!/usr/bin/env node
/**
 * ARBITRAGE-PEDIA — Autonomous Marketplace Arbitrage Agent
 * 
 * Screen → Decide → Act → Learn
 * Cron-driven cycles + interactive REPL + Telegram alerts.
 */

import cron from "node-cron";
import readline from "readline";
import { agentLoop } from "./agent.js";
import config from "./config.js";
import { getState, getStateSummary, getPendingCandidates, getProfitSummary } from "./state.js";
import { evolveThresholds } from "./lessons.js";

// ═══════════════════ CONFIG ═══════════════════

const DRY_RUN = process.env.DRY_RUN === "true";
const MODE = DRY_RUN ? "DRY RUN" : "LIVE";

// ═══════════════════ CRON CYCLES ═══════════════════

let screeningCron = null;
let dailyReportCron = null;

function formatIDR(n) {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

async function runScreeningCycle(silent = false) {
  const startTime = Date.now();
  console.log(`\n🔍 [SCREENING CYCLE] ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`);
  
  const goal = buildScreeningGoal();
  console.log(`  Goal: "${goal}"`);

  const result = await agentLoop(goal, {
    agentType: "SCREENER",
    maxSteps: 10,
    onToolStart: ({ name, args }) => {
      if (name.startsWith("scan_")) {
        console.log(`  📡 ${name}("${args.query}") ...`);
      }
    },
    onToolFinish: ({ name, result }) => {
      if (name.startsWith("scan_")) {
        const count = Array.isArray(result) ? result.length : result?.totalFound || 0;
        if (result?.error) console.log(`    ❌ ${result.error}`);
        else console.log(`    ✅ ${count} listings`);
      }
      if (name === "save_candidate") {
        console.log(`    💾 ${result?.saved ? "SAVED" : "REJECTED"} ${result?.reason || ""}`);
      }
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Done in ${elapsed}s`);

  if (!silent && result.content) {
    console.log(`\n📊 Screening Report:\n${result.content.slice(0, 500)}...`);
  }

  return result;
}

async function runDecisionCycle(silent = false) {
  const startTime = Date.now();
  console.log(`\n🧠 [DECISION CYCLE] ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`);

  const candidates = getPendingCandidates();
  if (!candidates.length) {
    console.log("  No pending candidates — run screening first.");
    return { content: "No candidates to evaluate." };
  }

  const goal = buildDecisionGoal(candidates);
  console.log(`  Evaluating ${candidates.length} candidates...`);

  const result = await agentLoop(goal, {
    agentType: "DECIDER",
    maxSteps: 12,
    onToolStart: ({ name, args }) => {
      if (name === "compare_market_price") console.log(`  💰 Market check: "${args.query}"`);
      if (name === "recommend_buy") console.log(`  ⭐ RECOMMENDING: ${args.candidateId}`);
    },
    onToolFinish: ({ name, result }) => {
      if (name === "recommend_buy" && result?.recommended) {
        console.log(`    🎯 ${result.title} | buy ${formatIDR(result.buyPrice)} → expect +${formatIDR(result.expectedProfit)}`);
      }
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Done in ${elapsed}s`);

  return result;
}

function buildScreeningGoal() {
  const cats = config.categories.map(c => c.id).join(", ");
  const keywords = config.categories.flatMap(c => c.keywords).slice(0, 8).join(", ");
  return `Scan Tokopedia, Shopee, and Bukalapak for undervalued items in categories: ${cats}. 
Search keywords: ${keywords}. 
Only save items that pass all seller checks. 
Focus on "bekas" (used) condition for maximum margin.
After scanning, call get_screening_report.`;
}

function buildDecisionGoal(candidates) {
  const summary = candidates.slice(0, 10).map(c =>
    `[${c.id}] "${c.title}" - ${formatIDR(c.price)} on ${c.platform} (seller: ${c.seller_name}, rating: ${c.seller_rating})`
  ).join("\n");

  return `Evaluate these ${candidates.length} candidates for arbitrage potential.

CANDIDATES:
${summary}

For each promising candidate:
1. Call compare_market_price to find the real market value
2. Call calculate_margin to estimate profit
3. If profit meets thresholds (>=${config.margin.minProfitPct}%, >=${formatIDR(config.margin.minProfitAbsolute)}), call recommend_buy

Be thorough but decisive. Recommend only the best 1-3 opportunities.
Budget: max ${formatIDR(config.budget.maxPerItem)}/item, ${formatIDR(config.budget.dailyBudget)} daily.`;
}

// ═══════════════════ DAILY REPORT ═══════════════════

async function runDailyReport() {
  const summary = getProfitSummary();
  const state = getStateSummary();
  const evolutions = evolveThresholds();

  let report = `📊 ARBITRAGE-PEDIA DAILY REPORT\n`;
  report += `🕐 ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}\n\n`;

  if (summary) {
    report += `💰 Profit Summary:\n`;
    report += `   Total Flips: ${summary.totalFlips}\n`;
    report += `   Win Rate: ${summary.winRate}%\n`;
    report += `   Avg Profit: +${summary.avgProfitPct}%\n`;
    report += `   Total Profit: ${formatIDR(summary.totalProfit)}\n\n`;
  } else {
    report += `💰 No flips recorded yet.\n\n`;
  }

  report += `📦 Current State: ${state}\n`;

  if (evolutions && Object.keys(evolutions).length) {
    report += `\n🔄 Threshold Evolutions:\n`;
    for (const [cat, adj] of Object.entries(evolutions)) {
      report += `   ${cat}: ${adj.action} — ${adj.reason}\n`;
    }
  }

  console.log(`\n${report}`);
  return report;
}

// ═══════════════════ REPL ═══════════════════

function startREPL() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function prompt() {
    const timers = {
      screening: screeningCron ? "active" : "paused",
    };
    rl.question(`[screen: ${timers.screening}] > `, async (input) => {
      const cmd = input.trim();

      if (cmd === "/screen" || cmd === "/scan") {
        await runScreeningCycle();
      } else if (cmd === "/decide" || cmd === "/eval") {
        await runDecisionCycle();
      } else if (cmd === "/status") {
        console.log(getStateSummary());
        const summary = getProfitSummary();
        if (summary) console.log(`Profit: ${formatIDR(summary.totalProfit)} from ${summary.totalFlips} flips`);
      } else if (cmd === "/report") {
        await runDailyReport();
      } else if (cmd === "/profit") {
        console.log(JSON.stringify(getProfitSummary(), null, 2));
      } else if (cmd === "/evolve") {
        const ev = evolveThresholds();
        console.log(ev || "Not enough data yet (need 5+ flips)");
      } else if (cmd === "/stop" || cmd === "/quit" || cmd === "/exit") {
        console.log("Shutting down...");
        if (screeningCron) screeningCron.stop();
        if (dailyReportCron) dailyReportCron.stop();
        rl.close();
        process.exit(0);
      } else if (cmd === "/help") {
        console.log(`
Commands:
  /screen, /scan  — Run screening cycle
  /decide, /eval  — Evaluate candidates
  /status         — Current state & profit
  /report         — Daily summary report
  /profit         — Detailed profit log
  /evolve         — Trigger threshold evolution
  /stop, /quit    — Graceful shutdown
  anything else   — Chat with the agent
        `);
      } else if (cmd.length > 0) {
        // Free chat
        console.log("🤖 Agent:");
        const result = await agentLoop(cmd, { agentType: "GENERAL", maxSteps: 5 });
        console.log(result.content);
      }

      prompt();
    });
  }

  console.log(`\n🛒 ARBITRAGE-PEDIA — ${MODE}`);
  console.log(`   Budget: ${formatIDR(config.budget.maxPerItem)}/item | ${formatIDR(config.budget.dailyBudget)}/day`);
  console.log(`   Categories: ${config.categories.map(c => c.id).join(", ")}`);
  console.log(`   Type /help for commands\n`);
  prompt();
}

// ═══════════════════ MAIN ═══════════════════

function startCron() {
  // Screening every N minutes
  const screenInterval = config.schedule.screeningIntervalMin;
  screeningCron = cron.schedule(`*/${screenInterval} * * * *`, async () => {
    try {
      await runScreeningCycle(true);
      // After screening, run decision
      const candidates = getPendingCandidates();
      if (candidates.length > 0) {
        await runDecisionCycle(true);
      }
    } catch (error) {
      console.error("Cron cycle error:", error.message);
    }
  });

  // Daily report at configured hour (WIB → UTC)
  const reportHourUTC = (config.schedule.dailyReportHour - 7 + 24) % 24;
  dailyReportCron = cron.schedule(`0 ${reportHourUTC} * * *`, async () => {
    try {
      await runDailyReport();
    } catch (error) {
      console.error("Daily report error:", error.message);
    }
  });

  console.log(`⏰ Screening: every ${screenInterval} min | Daily report: ${config.schedule.dailyReportHour}:00 WIB`);
}

async function main() {
  console.log("🛒 ARBITRAGE-PEDIA starting...");
  console.log(`   Mode: ${MODE}`);
  console.log(`   Model: ${process.env.LLM_MODEL || "openai/gpt-4o-mini"}`);

  // Handle --once flags
  if (process.argv.includes("--once")) {
    if (process.argv.includes("--screen")) {
      const result = await runScreeningCycle();
      console.log(`\n${result.content}`);
    } else if (process.argv.includes("--decide")) {
      const result = await runDecisionCycle();
      console.log(`\n${result.content}`);
    }
    process.exit(0);
  }

  // Start cron
  startCron();

  // Start REPL
  startREPL();
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
