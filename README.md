# ANIME INTELLIGENCE / AI PURCHASE INTELLIGENCE

Agent commerce intelligence for AI agents. The production service combines Japanese anime collectible purchase intelligence with a multi-provider Travel Core.

**Production MCP:** https://anime-intelligence.goodmy0312.workers.dev/mcp  
**OpenAPI:** https://anime-intelligence.goodmy0312.workers.dev/openapi.json  
**x402 discovery:** https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402  
**Free anime search:** https://anime-intelligence.goodmy0312.workers.dev/v1/search  
**Agent services:** https://anime-intelligence.goodmy0312.workers.dev/agent/services  
**Travel status:** https://anime-intelligence.goodmy0312.workers.dev/v1/travel/status  
**Travel shopping intelligence:** https://anime-intelligence.goodmy0312.workers.dev/v1/travel/shopping-intelligence  
**Flight search:** https://anime-intelligence.goodmy0312.workers.dev/v1/travel/flights/search  
**Public shop:** https://anime-intelligence.goodmy0312.workers.dev/shop  
**Version:** 3.9.1

<!-- mcp-name: io.github.Mike05102/anime-intelligence-mcp -->

## Anime collectible intelligence

ANIME INTELLIGENCE resolves and evaluates physical Japanese anime collectibles and character merchandise across figures, Nendoroids, figma, model kits, plush, acrylic goods, keychains, badges, lottery prizes, trading cards, collaboration sneakers, apparel and related limited goods.

It separates canonical product identity from noisy marketplace listing titles and supports multilingual discovery. Core languages are Japanese, English, Simplified Chinese, Traditional Chinese, Korean, Spanish, French and German.

## AI Purchase Intelligence

The same MCP server exposes a general commerce layer for autonomous shopping agents.

Current large-market adapter:

- **Travel**
  - Accommodation / ground inventory: Booking.com Demand API when configured
  - Flights: Duffel when configured
  - Secondary adapter slots: Expedia Rapid and Amadeus
  - Provider readiness: `/v1/travel/status`
  - Unified decision endpoint: `/v1/travel/shopping-intelligence`
  - Flight search: `/v1/travel/flights/search`
  - Accommodation search: `/v1/travel/accommodations/search`
  - Natural-language accommodation search: `/v1/travel/accommodations/smart-search`

Travel does not claim live availability when provider credentials are absent.

## Paid x402 intelligence endpoints

- `identify` â **0.005 USDC**
- `market` â **0.01 USDC**
- `rarity` â **0.01 USDC**
- `listing-match` â **0.01 USDC**
- `deadline` â **0.01 USDC**
- `authenticity` â **0.02 USDC**
- `buy-wait` â **0.02 USDC**
- `landed-cost` â **0.02 USDC**
- `price-history` â **0.02 USDC**
- `best-place` â **0.03 USDC**
- `full-intelligence` â **0.05 USDC**
- `shopping-intelligence` â **0.05 USDC**

Payments use **x402 v2**, **USDC on Solana mainnet**.

## MCP tool surface

Version 3.9.1 exposes **16 MCP tools**:

- 12 paid x402 intelligence tools
- `search_anime_product`
- `record_purchase_intent`
- `travel_shopping_intelligence`
- `travel_provider_status`

## Discovery surfaces

- MCP: `https://anime-intelligence.goodmy0312.workers.dev/mcp`
- MCP well-known: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/mcp.json`
- OpenAPI: `https://anime-intelligence.goodmy0312.workers.dev/openapi.json`
- x402: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402`
- x402 Bazaar metadata: `https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402-bazaar`
- Agent profile: `https://anime-intelligence.goodmy0312.workers.dev/agent/profile`
- Agent services: `https://anime-intelligence.goodmy0312.workers.dev/agent/services`
- LLM discovery text: `https://anime-intelligence.goodmy0312.workers.dev/llms.txt`

## Registry identity

Official MCP Registry package name:

`io.github.Mike05102/anime-intelligence-mcp`

The repository `server.json`, production Worker version, MCP tool surface and registry publication should remain on the same release version to prevent downstream directories from reverting to stale tool metadata.
