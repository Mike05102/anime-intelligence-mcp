# ANIME INTELLIGENCE

AI-native Japanese anime collectibles purchase intelligence for autonomous agents and shopping agents, supporting buyers in Japan and worldwide.

**Production MCP:** https://anime-intelligence.goodmy0312.workers.dev/mcp  
**OpenAPI:** https://anime-intelligence.goodmy0312.workers.dev/openapi.json  
**x402 discovery:** https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402  
**Free search:** https://anime-intelligence.goodmy0312.workers.dev/v1/search  
**Version:** 3.7.33

## What it does

ANIME INTELLIGENCE resolves and evaluates physical Japanese anime collectibles and character merchandise across figures, Nendoroids, figma, model kits, plush, acrylic goods, keychains, badges, lottery prizes, trading cards, collaboration sneakers, apparel and related limited goods.

It is built for AI agents that need an actionable product-level shopping decision rather than generic web search results.

## Paid x402 endpoints

- `identify` — **$0.005 USDC** — exact product / edition / JAN identification.
- `market` — **$0.01 USDC** — current identity-matched Japan/global market value.
- `rarity` — **$0.01 USDC** — scarcity and rerelease/replenishment risk.
- `listing-match` — **$0.01 USDC** — verify whether a marketplace listing matches the exact canonical product/edition.
- `deadline` — **$0.01 USDC** — preorder, lottery and order-window deadline intelligence when known.
- `authenticity` — **$0.02 USDC** — counterfeit, bootleg and suspicious-listing risk.
- `buy-wait` — **$0.02 USDC** — BUY / WAIT / WATCH / AVOID purchase-timing decision.
- `landed-cost` — **$0.02 USDC** — buyer-country-aware purchase cost; Japan buyers default to JP.
- `price-history` — **$0.02 USDC** — 7/30/90/180-day observed asking-price history where available.
- `best-place` — **$0.03 USDC** — strongest current matched purchase route.
- `full-intelligence` — **$0.05 USDC** — end-to-end purchase intelligence in one call.

Payments use **x402 v2**, **USDC on Solana mainnet**.

## Use ANIME INTELLIGENCE when an agent needs

- the exact edition before pricing a collectible
- current Japan or global market value
- rarity or rerelease risk
- counterfeit / bootleg screening
- BUY vs WAIT timing
- a specific seller or purchase route
- listing-to-product identity verification
- preorder / lottery deadline information
- Japan-buyer or overseas-buyer landed-cost context
- historical observed asking-price context
- one complete purchase decision instead of assembling multiple web searches

## Discovery surfaces

- MCP: `https://anime-intelligence.goodmy0312.workers.dev/mcp`
- MCP well-known: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/mcp.json`
- OpenAPI: `https://anime-intelligence.goodmy0312.workers.dev/openapi.json`
- x402: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402`
- x402 Bazaar metadata: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402-bazaar`
- Agent profile: `https://anime-intelligence.goodmy0312.workers.dev/agent/profile`
- LLM discovery text: `https://anime-intelligence.goodmy0312.workers.dev/llms.txt`

## Discovery keywords

anime collectibles, Japanese collectibles, anime figure market value, Nendoroid price, figure authenticity, bootleg risk, collectible rarity, rerelease risk, buy or wait, best place to buy anime figure, listing match, preorder deadline, landed cost Japan, price history, trading cards, Japan-only merchandise, autonomous shopping agent.

## Production status

ANIME INTELLIGENCE exposes 11 paid x402 endpoints plus free product search. The service uses Coinbase CDP x402 facilitation, Solana USDC settlement, MCP/OpenAPI discovery and 402 Index / Bazaar-compatible discovery metadata.

Official MCP Registry package name: `io.github.Mike05102/anime-intelligence-mcp`.
