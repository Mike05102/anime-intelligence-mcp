# GPD: integration guide for AI agent developers

**Live API:** https://anime-intelligence.goodmy0312.workers.dev  
**MCP:** https://anime-intelligence.goodmy0312.workers.dev/mcp  
**OpenAPI:** https://anime-intelligence.goodmy0312.workers.dev/openapi.json  
**Agent examples:** https://anime-intelligence.goodmy0312.workers.dev/agents/examples

## Who this is for

Use GPD when your AI agent must decide which *physical product* to buy, identify an exact manufacturer part number, evaluate sourcing evidence, or compare purchase routes. Industrial maintenance and spare parts, anime collectibles, and broader consumer goods are supported to varying degrees.

## 1. Inspect the live API contract (free)

```bash
curl -fsSL https://anime-intelligence.goodmy0312.workers.dev/openapi.json -o gpd-openapi.json
curl -fsSL https://anime-intelligence.goodmy0312.workers.dev/agents/examples
```

Use the live schema to construct the JSON body. **Do not assume that the example request below is the authoritative schema**; the live OpenAPI specification takes precedence.

## 2. Connect MCP

Use Streamable HTTP MCP at:

```text
https://anime-intelligence.goodmy0312.workers.dev/mcp
```

For clients that accept a remote MCP server URL, configure that URL directly. Inspect available tools and descriptions in your client before calling them.

## 3. Test x402 without spending money

The paid purchase-decision endpoint is `POST /v1/purchase-decision`, configured for **0.10 USDC** on Solana mainnet. A request without payment should return a payment challenge when it reaches the x402 gate.

```bash
# Replace BODY with a valid request from the live OpenAPI/examples.
BODY='{}'
curl -i -sS \
  -X POST 'https://anime-intelligence.goodmy0312.workers.dev/v1/purchase-decision' \
  -H 'Content-Type: application/json' \
  --data "$BODY"
```

An empty object may be rejected by input validation instead of reaching HTTP 402. Use a valid body to verify the payment gate. **Do not interpret a 402 response as a successful payment.**

## 4. Make a paid request

Use an x402-compatible client and a user-authorized funded wallet. Read the server's payment requirements, authorize a payment, and retry with the required payment proof. Only treat a response as a settled paid call after the payment verification/settlement and API response have been confirmed. GPD's fee is for decision intelligence, not the physical product.

## 5. Evaluate before production use

Test a realistic query with a known product/part number, then inspect:
- Whether the exact product is identified
- What source evidence supports the recommendation
- Whether seller/stock/compatibility claims are verified
- What fields are unknown
- Whether the resulting decision is actionable

Please report reproducible issues or missing agent integrations in this repository's GitHub Issues. Include request shape with secrets removed, expected behavior, observed HTTP status and response excerpts. Never include wallet secrets or payment signatures.

## Service and commercial caveats

- Coverage and seller evidence vary across categories.
- GPD does not guarantee stock, compatibility or total landed cost where evidence is absent.
- Registry publication and endpoint uptime do not prove external paid usage.
- Payment requires explicit user authorization.

**Official MCP Registry server name:** `io.github.Mike05102/anime-intelligence-mcp`
