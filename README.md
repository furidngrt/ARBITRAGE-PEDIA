# 🛒 ARBITRAGE-PEDIA

**Autonomous Marketplace Arbitrage Agent for Indonesian E-Commerce.**

Screen → Decide → Act → Learn — an LLM-powered agent that finds undervalued items on Tokopedia, Shopee, and Bukalapak, evaluates flip potential, and learns from every sale.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-ready-blue)](https://playwright.dev)

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                   ORCHESTRATOR                       │
│              cron every 15 minutes                   │
└──────────┬──────────────────┬───────────────────────┘
           │                  │
     ┌─────▼─────┐      ┌─────▼─────┐
     │  SCREENER  │      │  DECIDER  │
     │  Agent     │      │  Agent    │
     │            │      │           │
     │ scan_      │      │ compare_  │
     │ tokopedia  │      │ market_   │
     │ scan_      │ ───▶ │ price     │ ───▶ Telegram Alert
     │ shopee     │      │ calculate │      with Buy/Skip
     │ scan_      │      │ _margin   │
     │ bukalapak  │      │ recommend │
     └────────────┘      │ _buy      │
                         └───────────┘
                                │
                         ┌──────▼──────┐
                         │   LEARNING   │
                         │   ENGINE     │
                         │              │
                         │ record_sale  │
                         │ add_lesson   │
                         │ evolve_      │
                         │ thresholds   │
                         └──────────────┘
```

### 1. SCREEN — Find Undervalued Items

The **Screener Agent** scans 3 marketplaces in parallel using Playwright browsers:

| Platform | Tool | Strategy |
|---|---|---|
| Tokopedia | `scan_tokopedia` | Search with keywords + price filters |
| Shopee | `scan_shopee` | Search with condition="bekas" |
| Bukalapak | `scan_bukalapak` | Focus on electronics & gaming |

Each listing is pre-filtered by:
- Price range (configurable)
- Seller rating (min 4.0 ⭐)
- Transaction count (min 10)
- Blocked words filter (no "rusak", "sparepart", etc.)

Promising items are saved via `save_candidate` for the Decider to evaluate.

### 2. DECIDE — Evaluate Profit Potential

The **Decider Agent** (powered by Claude/GPT via OpenRouter) evaluates each candidate:

1. **`compare_market_price`** — Searches across all platforms for the same item to find fair market value
2. **`calculate_margin`** — Computes estimated profit after platform fees (5%), payment fees (1.5%), and shipping
3. **`check_seller_reputation`** — Flags suspicious sellers (low transactions, possible fake ratings)
4. **`recommend_buy`** — If profit meets thresholds (default: 30%+ margin, Rp50k+ absolute), recommends with confidence score

Only the top 1-3 opportunities per cycle are recommended. Budget caps prevent over-committing.

### 3. ACT — Execute & Track

- **Telegram Alerts** — Recommended buys are sent with reasoning and Buy/Skip buttons
- **`relist_item`** — Generates optimized title, description, and pricing for resale
- **`record_sale`** — Logs sale profit and triggers lesson generation
- Auto-buy is intentionally manual-confirm for safety

### 4. LEARN — Improve Over Time

Every sale feeds the learning engine:
- **`add_lesson`** — Converts flips into actionable rules (e.g., "iPhone series sells within 2-3 days if priced 10% below market")
- **`evolveThresholds()`** — After 5+ flips per category, auto-adjusts category weights and screening parameters
- **Performance tracking** — Win rate, avg profit %, best categories, hold time analytics

---

## Quick Start

### Prerequisites
- Node.js 18+
- OpenRouter API key ([get one](https://openrouter.ai))
- Playwright browsers

### Installation

```bash
git clone git@github.com:furidngrt/ARBITRAGE-PEDIA.git
cd ARBITRAGE-PEDIA
npm install
npx playwright install chromium
```

### Configuration

```bash
cp .env.example .env
# Edit .env — add your OPENROUTER_API_KEY
# Edit user-config.example.json → user-config.json (or use defaults)
```

**.env:**
```env
OPENROUTER_API_KEY=sk-or-...
DRY_RUN=true          # Set to false for production
```

**user-config.json** (defaults shown — all optional):
```json
{
  "budget": {
    "maxPerItem": 500000,
    "dailyBudget": 3000000,
    "maxOpenItems": 5
  },
  "margin": {
    "minProfitPct": 30,
    "minProfitAbsolute": 50000,
    "targetMarkupPct": 50
  },
  "categories": [
    { "id": "elektronik", "keywords": ["laptop", "monitor", "keyboard"], "weight": 1.0 },
    { "id": "gaming", "keywords": ["ps5", "nintendo switch", "steam deck"], "weight": 1.3 },
    { "id": "hp-tablet", "keywords": ["iphone", "samsung", "ipad"], "weight": 1.2 }
  ],
  "screening": {
    "intervalMin": 15,
    "maxListingsPerScan": 50,
    "platforms": ["tokopedia", "shopee", "bukalapak"]
  }
}
```

### Run

```bash
npm start          # Full agent: cron cycles + REPL
npm run dev        # Dry run mode (no state writes)
npm run screen     # Single screening cycle
npm run decide     # Single decision cycle
```

### REPL Commands

| Command | Action |
|---|---|
| `/screen` | Run screening cycle — scan all platforms |
| `/decide` | Evaluate pending candidates |
| `/status` | View current state + profit summary |
| `/report` | Daily performance report |
| `/profit` | Detailed profit log (JSON) |
| `/evolve` | Trigger threshold evolution |
| `/help` | Show all commands |

---

## Architecture

```
arbitrage-pedia/
├── agent.js              # ReAct LLM agent loop (OpenRouter)
├── index.js              # Orchestrator: cron + REPL
├── config.js             # Runtime config from user-config.json
├── prompt.js             # Dynamic system prompt per role
├── state.js              # Candidate/item tracking + profit log
├── lessons.js            # Learning engine: rules + threshold evolution
├── tools/
│   ├── definitions.js    # 15 OpenAI-format tool schemas
│   ├── executor.js       # Tool dispatch + safety checks
│   ├── tokopedia.js      # Playwright scraper (anti-bot bypass)
│   ├── shopee.js         # Playwright scraper
│   └── bukalapak.js      # Playwright scraper
├── sub-agents/           # Parallel screening sub-agent definitions
│   ├── screener-tokped.md
│   ├── screener-shopee.md
│   └── screener-bukalapak.md
├── data/                 # Runtime data (gitignored)
│   ├── state.json
│   ├── lessons.json
│   └── profit-log.json
└── user-config.json      # Your settings
```

### Agent Roles & Tool Access

| Role | Purpose | Tools |
|---|---|---|
| **SCREENER** | Find undervalued items | `scan_tokopedia`, `scan_shopee`, `scan_bukalapak`, `save_candidate`, `get_screening_report` |
| **DECIDER** | Evaluate profit potential | `compare_market_price`, `calculate_margin`, `check_seller_reputation`, `recommend_buy` |
| **GENERAL** | Chat & manual operations | All tools |

### Why LLM Instead of Simple Rules?

A rules-only scraper would miss context:
- "iPhone 14 Pro 128GB" at Rp 8M might be overpriced if market is Rp 7.5M, but underpriced if condition is "sealed box"
- "PS5 Digital" at Rp 4M — good deal or scam? LLM checks seller history, listing age, image count
- "Laptop gaming" — is it a 2020 model or 2024? LLM reads the full title and description

The LLM acts as a reasoning layer between raw scraping and executable decisions, similar to how Meridian's AI evaluates LP pools beyond just TVL and fees.

---

## Safety Features

- **DRY_RUN mode** — Test everything without writing state or sending alerts
- **Once-per-session lock** — `recommend_buy` can't fire twice in one cycle
- **Seller filters** — Auto-reject low-rating, low-transaction, suspicious sellers
- **Blocked words** — Skip listings with "rusak", "sparepart", "mati total"
- **Budget caps** — Max per-item + daily budget + max open items enforced
- **Manual confirm** — Auto-buy is intentionally disabled; user confirms via Telegram

---

## Roadmap

- [ ] Telegram bot with Buy/Skip inline buttons
- [ ] Full auto-buy via browser checkout automation
- [ ] Auto-relist on same platform
- [ ] Multi-platform price history tracking
- [ ] Image recognition for condition assessment
- [ ] WhatsApp/Facebook Marketplace scraper
- [ ] Dashboard web UI

---

## Credits

Architecture inspired by [Meridian](https://github.com/yunus-0x/meridian) — the autonomous DLMM liquidity agent for Solana.

Built with [OpenRouter](https://openrouter.ai), [Playwright](https://playwright.dev), and [node-cron](https://github.com/node-cron/node-cron).

## License

MIT
