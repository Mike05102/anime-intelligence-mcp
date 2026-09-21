# ANIME INTELLIGENCE

AI-native Japanese anime collectibles purchase intelligence for autonomous agents and shopping agents, supporting buyers in Japan and worldwide.

**Production MCP:** https://anime-intelligence.goodmy0312.workers.dev/mcp  
**OpenAPI:** https://anime-intelligence.goodmy0312.workers.dev/openapi.json  
**x402 discovery:** https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402  
**Free search:** https://anime-intelligence.goodmy0312.workers.dev/v1/search  
**Agent services:** https://anime-intelligence.goodmy0312.workers.dev/agent/services  
**Version:** 3.7.78

<!-- mcp-name: io.github.Mike05102/anime-intelligence-mcp -->

## What it does

ANIME INTELLIGENCE resolves and evaluates physical Japanese anime collectibles and character merchandise across figures, Nendoroids, figma, model kits, plush, acrylic goods, keychains, badges, lottery prizes, trading cards, collaboration sneakers, apparel and related limited goods.

It is built for AI agents that need an actionable product-level shopping decision rather than generic web search results.

Discovery starts from ordinary buyer language. Exact JAN codes or edition names are not required for search/recommendation. Explicit franchise, character and category constraints are treated as hard constraints; softer preferences such as color, size, exclusivity, condition, budget and shipping are only claimed when evidence is available.

Core multilingual discovery support: **Japanese, English, Simplified Chinese, Traditional Chinese, Korean, Spanish, French and German**. Other languages are best-effort only.

## x402 entry point

For a low-cost first paid call, use:

- `identify` — **0.005 USDC** — canonical product / edition identification.

If a paid endpoint returns HTTP 402, read the machine-readable x402 payment requirement and retry the **same request** with a valid `PAYMENT-SIGNATURE` header (legacy alias `X-PAYMENT` is also accepted).

Payments use **x402 v2**, **USDC on Solana mainnet**.

## Paid x402 endpoints

- `identify` — **0.005 USDC** — exact product / edition / JAN identification.
- `market` — **0.01 USDC** — current identity-matched Japan/global market value.
- `rarity` — **0.01 USDC** — scarcity and rerelease/replenishment risk.
- `listing-match` — **0.01 USDC** — verify whether a marketplace listing matches the exact canonical product/edition.
- `deadline` — **0.01 USDC** — preorder, lottery and order-window deadline intelligence when known.
- `authenticity` — **0.02 USDC** — counterfeit, bootleg and suspicious-listing risk.
- `buy-wait` — **0.02 USDC** — BUY / WAIT / WATCH / AVOID purchase-timing decision.
- `landed-cost` — **0.02 USDC** — buyer-country-aware purchase cost; Japan buyers default to JP.
- `price-history` — **0.02 USDC** — 7/30/90/180-day observed asking-price history where available.
- `best-place` — **0.03 USDC** — strongest current matched purchase route.
- `full-intelligence` — **0.05 USDC** — end-to-end purchase intelligence in one call.

## Discovery surfaces

- MCP: `https://anime-intelligence.goodmy0312.workers.dev/mcp`
- MCP well-known: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/mcp.json`
- OpenAPI: `https://anime-intelligence.goodmy0312.workers.dev/openapi.json`
- x402: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402`
- x402 Bazaar metadata: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402-bazaar`
- Agent profile: `https://anime-intelligence.goodmy0312.workers.dev/agent/profile`
- Agent services: `https://anime-intelligence.goodmy0312.workers.dev/agent/services`
- LLM discovery text: `https://anime-intelligence.goodmy0312.workers.dev/llms.txt`

## Discovery keywords

anime collectibles, Japanese collectibles, anime shopping agent, anime figure recommendation, Nendoroid, figure authenticity, bootleg risk, collectible rarity, rerelease risk, buy or wait, best place to buy anime figure, listing match, preorder deadline, landed cost Japan, price history, Japan-only merchandise, autonomous shopping agent, x402, Solana USDC.

## Production status

ANIME INTELLIGENCE exposes **12 MCP tools: 11 paid x402 endpoints plus 1 free search tool**. The service uses Coinbase CDP x402 facilitation, Solana USDC settlement, MCP/OpenAPI discovery and Bazaar-compatible discovery metadata.

Production preflight audits verify explicit hard constraints and avoid charging when required product/preference evidence is missing. Social-context requests without the referenced image/URL are guarded rather than guessed.

Official MCP Registry package name: `io.github.Mike05102/anime-intelligence-mcp`.
