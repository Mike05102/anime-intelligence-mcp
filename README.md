# ANIME INTELLIGENCE

**AI-native market, authenticity, rarity and buying intelligence for Japanese anime figures and collectibles.**

ANIME INTELLIGENCE is an MCP and x402 service designed for autonomous AI agents that need to identify Japanese anime collectibles, understand current market value, evaluate rarity and counterfeit risk, decide whether to buy now or wait, and find where to buy.

AI agents can start with free product search and purchase deeper intelligence per request using **x402 v2 with USDC on Solana mainnet**.

## Live Service

Base URL:

`https://anime-intelligence.goodmy0312.workers.dev`

Free search:

`GET /v1/search`

Example:

`https://anime-intelligence.goodmy0312.workers.dev/v1/search?query=初音ミク`

No payment is required for product search.

## Paid x402 Intelligence APIs

| API | Purpose | Price |
|---|---|---:|
| `/v1/identify` | Resolve an ambiguous figure or collectible to an exact canonical product | $0.005 USDC |
| `/v1/market` | Current asking prices, market value and resale-value intelligence | $0.01 USDC |
| `/v1/rarity` | Rarity, scarcity, availability and rerelease-risk analysis | $0.01 USDC |
| `/v1/authenticity` | Counterfeit, bootleg and suspicious-listing risk assessment | $0.02 USDC |
| `/v1/buy-wait` | BUY / WAIT / WATCH / AVOID purchase decision | $0.02 USDC |
| `/v1/best-place` | Compare current purchase routes and find where to buy | $0.03 USDC |
| `/v1/full-intelligence` | Complete identity, valuation, rarity, authenticity and buying intelligence | $0.05 USDC |

Payment protocol: **x402 v2**

Asset: **USDC**

Network: **Solana mainnet**

## What AI Agents Can Ask

Examples:

- "Identify this Hatsune Miku figure."
- "What is this anime figure worth now?"
- "What is the current resale value?"
- "Is this figure rare or hard to find?"
- "Could this listing be a counterfeit or bootleg?"
- "Should I buy this figure now or wait?"
- "Where is the best place to buy it?"
- "Is this collectible worth buying?"

ANIME INTELLIGENCE is designed to convert these natural-language intents into specialized collectible intelligence.

## Recommended Agent Flow

For uncertain product identity:

`search → identify → market / rarity → authenticity / buy-wait → best-place`

For a complete purchase decision:

`full-intelligence`

The low-cost `/v1/identify` endpoint is designed as the entry point for agents that first need to establish exact product identity.

## Market Intelligence

Market analysis uses matched asking-price observations from sources including Yahoo Shopping, eBay and stored market observations.

ANIME INTELLIGENCE attempts to reject likely product-identity mismatches before using listings for valuation.

Market observations are time-sensitive and include freshness information where available.

Rakuten may be used as an affiliate purchase-routing channel. It is not treated as a live-price source unless an exact registered offer contains appropriate price metadata.

## Product Identity

Products can be resolved using information such as:

- Japanese or English product name
- JAN / EAN-13
- Model number
- Manufacturer
- Series
- Character or franchise
- Canonical product UUID
- Known aliases

The product database is designed to grow from official product records and previously resolved product queries.

## MCP

ANIME INTELLIGENCE is published to the **Official MCP Registry**.

MCP endpoint:

`https://anime-intelligence.goodmy0312.workers.dev/mcp`

Server:

`io.github.Mike05102/anime-intelligence-mcp`

Current version:

`2.9.16`

The MCP server exposes free canonical product search plus seven paid intelligence tools.

## OpenAPI

OpenAPI 3.1 specification:

`https://anime-intelligence.goodmy0312.workers.dev/openapi.json`

## x402 Discovery

x402 metadata:

`https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402`

Bazaar discovery metadata:

`https://anime-intelligence.goodmy0312.workers.dev/.well-known/x402-bazaar`

ANIME INTELLIGENCE exposes x402 v2 discovery metadata for all seven paid intelligence resources.

## Discovery

ANIME INTELLIGENCE is available through multiple AI-agent discovery paths, including:

- Official MCP Registry
- 402 Index
- x402scan
- OpenAPI
- MCP
- x402 discovery metadata

Additional agent marketplaces may index the service independently.

## Built for Autonomous AI Commerce

ANIME INTELLIGENCE is designed for machine-to-machine commerce.

An AI agent can:

`discover → identify → evaluate → pay → receive intelligence → choose a purchase route`

without requiring a subscription or human checkout flow for each intelligence request.

The objective is to provide a specialized intelligence layer between AI agents and the fragmented Japanese anime collectibles market.

## Status

Production service: **Online**

MCP version: **2.9.16**

Paid intelligence endpoints: **7**

Free search endpoint: **1**

Payment: **x402 v2 / USDC / Solana mainnet**
