# ANIME INTELLIGENCE / AI PURCHASE INTELLIGENCE

Version **3.9.2**.

Production MCP: https://anime-intelligence.goodmy0312.workers.dev/mcp

## What changed in 3.9.2

- x402 payment-conversion telemetry now records payment challenge issuance, payment retry receipt and a privacy-safe requirement fingerprint.
- `solana-endpoint-record` is classified as endpoint-record crawler traffic and excluded from confirmed external shopping intent.
- Travel adds Expedia Rapid as a real secondary accommodation availability adapter for known Expedia property IDs.
- Consumer electronics gains generic Yahoo/eBay market search.
- Automotive parts requires exact OE/MPN/part identity before selection.
- Enterprise procurement, MRO and electronic components require an exact manufacturer part number before selection.

## Key endpoints

- `/v1/shopping-intelligence`
- `/v1/commerce/search`
- `/v1/travel/status`
- `/v1/travel/shopping-intelligence`
- `/v1/travel/flights/search`
- `/v1/travel/accommodations/search`
- `/v1/travel/accommodations/smart-search`
- `/v1/travel/expedia/availability`
- `/v1/purchase-intent`
- `/openapi.json`
- `/llms.txt`
- `/agent/profile`
- `/agent/services`
- `/.well-known/x402`

Official MCP Registry package:
`io.github.Mike05102/anime-intelligence-mcp`
