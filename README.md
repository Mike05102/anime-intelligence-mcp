# ANIME INTELLIGENCE

AI-native Japanese anime collectibles and character-merchandise intelligence for autonomous agents.

**Production MCP:** https://anime-intelligence.goodmy0312.workers.dev/mcp  
**OpenAPI:** https://anime-intelligence.goodmy0312.workers.dev/openapi.json  
**x402 discovery:** https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402  
**Version:** 3.0.33

## What it covers

ANIME INTELLIGENCE identifies and evaluates Japanese anime collectibles across figures, Nendoroids, figma, model kits, plush, acrylic goods, keychains, badges, lottery prizes, trading cards, collaboration sneakers, apparel and other limited character goods.

The service is designed for AI agents that need to resolve the exact item before making a pricing or purchase decision.

## MCP tools and x402 pricing

- `identify` — **$0.005 USDC** — resolve exact product identity from product name, JAN/EAN, model/style code or aliases.
- `market` — **$0.01 USDC** — current matched asking-price and market-value intelligence.
- `rarity` — **$0.01 USDC** — rarity, scarcity and rerelease/replenishment-risk analysis.
- `authenticity` — **$0.02 USDC** — counterfeit, bootleg and suspicious-listing risk.
- `buy-wait` — **$0.02 USDC** — BUY / WAIT / WATCH / AVOID decision.
- `best-place` — **$0.03 USDC** — strongest current purchase route from matched supported-marketplace offers.
- `full-intelligence` — **$0.05 USDC** — identity, market, rarity, authenticity, decision and purchase route in one call.

Payments use **x402 v2**, **USDC on Solana mainnet**.

A free REST discovery/search endpoint is also available at `https://anime-intelligence.goodmy0312.workers.dev/v1/search`.

## Discovery surfaces

- MCP: `https://anime-intelligence.goodmy0312.workers.dev/mcp`
- MCP well-known: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/mcp.json`
- OpenAPI: `https://anime-intelligence.goodmy0312.workers.dev/openapi.json`
- x402: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402`
- x402 Bazaar metadata: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402-bazaar`
- AI plugin metadata: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/ai-plugin.json`
- LLM discovery text: `https://anime-intelligence.goodmy0312.workers.dev/llms.txt`

## Product intelligence model

ANIME INTELLIGENCE maintains a canonical Japanese collectibles product master and combines it with current marketplace observations. Unknown products can be discovered, normalized and added to the product graph.

The same product identity can feed market valuation, rarity, authenticity risk, BUY/WAIT logic and purchase routing.

## Production status

Worker version **3.0.33** is live. The seven paid x402 endpoints return valid HTTP 402 payment requirements and are registered as active/healthy on 402 Index.

Official MCP Registry package name: `io.github.Mike05102/anime-intelligence-mcp`.
