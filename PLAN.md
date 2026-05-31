# ARBITRAGE-PEDIA — Autonomous Marketplace Arbitrage Agent

## Architecture (Meridian Blueprint)

```
                    ┌─────────────────────────────────┐
                    │        ORCHESTRATOR (cron)       │
                    │   screen_every=15m               │
                    └─────────────┬───────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ SCREENER-TOKOPED│   │ SCREENER-SHOPEE │   │ SCREENER-BUKA   │
│ (sub-agent)     │   │ (sub-agent)     │   │ (sub-agent)     │
│ Playwright scan │   │ Playwright scan │   │ Playwright scan │
│ 15 kategori     │   │ 10 kategori     │   │ 8 kategori      │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
                                ▼
                    ┌─────────────────────────────────┐
                    │     DECISION AGENT (LLM)        │
                    │   • price comparison            │
                    │   • margin calculation          │
                    │   • scam/defect detection       │
                    │   • rank by profit potential    │
                    └─────────────┬───────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
     ┌────────────┐     ┌────────────┐     ┌────────────┐
     │  ALERT     │     │ AUTO-BUY   │     │ AUTO-RELIST│
     │ Telegram   │     │ (confirm)  │     │ w/ markup  │
     └────────────┘     └────────────┘     └────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────────┐
                    │      LEARNING ENGINE            │
                    │  • profit per category          │
                    │  • seller reliability score     │
                    │  • optimal markup % per niche   │
                    │  • evolve screening keywords    │
                    └─────────────────────────────────┘
```

## Project Structure

```
arbitrage-pedia/
├── index.js              # Entry: cron orchestrator + CLI
├── agent.js              # ReAct LLM agent loop (OpenRouter)
├── config.js             # Runtime config
├── prompt.js             # System prompt builder (SCREENER/DECIDER)
├── state.js              # Tracked items + profit history (state.json)
├── lessons.js            # Learning from sold items
├── telegram.js           # Notifications + commands
├── logger.js             # Daily rotating logs
├── tools/
│   ├── definitions.js    # OpenAI-format tool schemas
│   ├── executor.js       # Tool dispatch + safety checks
│   ├── tokopedia.js      # Tokopedia scraper (Playwright)
│   ├── shopee.js         # Shopee scraper (Playwright)
│   ├── bukalapak.js      # Bukalapak scraper (Playwright)
│   ├── market-compare.js # Price comparison across platforms
│   ├── relister.js       # Auto-relist with markup
│   └── buyer.js          # Browser-based checkout (manual confirm)
├── package.json
├── user-config.json      # Budget, categories, markup rules
├── .env                  # API keys, Telegram token
├── data/
│   ├── state.json        # Active items being tracked
│   ├── lessons.json      # Learned patterns
│   └── profit-log.json   # All flip history
└── sub-agents/           # Claude Code sub-agent definitions
    ├── screener-tokped.md
    ├── screener-shopee.md
    └── screener-bukalapak.md
```

## Agent Roles & Tool Access

| Role | Job | Key Tools |
|---|---|---|
| **SCREENER** | Scan marketplace listings | `scan_tokopedia`, `scan_shopee`, `scan_bukalapak`, `search_across_platforms` |
| **DECIDER** | Evaluate & rank opportunities | `compare_prices`, `check_seller_rep`, `calculate_margin`, `detect_scam` |
| **GENERAL** | Chat & manual ops | All tools |

## Decision Pipeline

```
1. SCAN: Sub-agents scrape listings per marketplace
2. DEDUP: Remove duplicates across platforms
3. ENRICH: Add market price, seller rating, category
4. FILTER: Remove below-min-margin, suspicious sellers
5. RANK: Sort by estimated profit × confidence
6. ALERT: Top 5 → Telegram notification
7. ACTION: User confirms → auto-buy or skip
8. TRACK: Track bought items for relisting
9. RELIST: Auto-create listing with optimized title/desc
10. LEARN: On sale → record profit, evolve strategy
```

## Phase 1: Screening + Alert (MVP — 2 days)

- [ ] Project scaffold (package.json, deps)
- [ ] Config system (categories, budget, margin thresholds)
- [ ] Tokopedia scraper (Playwright, anti-bot)
- [ ] Shopee scraper (Playwright)
- [ ] Dedup + price comparison engine
- [ ] LLM decision agent (OpenRouter)
- [ ] Telegram alert integration
- [ ] Cron scheduler (15-min cycles)

## Phase 2: Learning Engine (1 day)

- [ ] State tracking (bought items, listing URLs)
- [ ] Profit logging
- [ ] Lessons engine (per-category margin optimization)
- [ ] Seller reputation scoring

## Phase 3: Auto-actions (2 days)

- [ ] Browser-based auto-buy (Playwright checkout)
- [ ] Auto-relist with LLM-generated description
- [ ] Manual confirmation flow via Telegram buttons
- [ ] Safety: max-budget, max-items-per-day

## Config

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
    "elektronik", "hp-tablet", "fashion-pria",
    "sepatu", "kamera", "gaming", "hobi-koleksi"
  ],
  "screening": {
    "intervalMin": 15,
    "maxListingsPerScan": 100,
    "keywords": ["murah", "diskon", "bekas", "second", "promo"]
  },
  "seller": {
    "minRating": 4.0,
    "minTransactions": 10,
    "blockNewSeller": true
  },
  "models": {
    "screeningModel": "openai/gpt-4o-mini",
    "decisionModel": "anthropic/claude-sonnet-4"
  }
}
```

## Risk Gates

- NEVER auto-buy without balance check
- Max 1 item per scan cycle
- Seller < 10 transactions → skip
- Price < 10% market average → flag as potential scam
- New account seller → manual review
- Total open items ≤ maxOpenItems
