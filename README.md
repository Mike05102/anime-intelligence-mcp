# ANIME INTELLIGENCE / AI PURCHASE INTELLIGENCE

Version **3.10.2**

Production MCP endpoint:

`https://anime-intelligence.goodmy0312.workers.dev/mcp`

Production API base:

`https://anime-intelligence.goodmy0312.workers.dev`

Repository:

`io.github.Mike05102/anime-intelligence-mcp`

---

## Overview

ANIME INTELLIGENCE / AI PURCHASE INTELLIGENCE is an MCP + API + x402 commerce-intelligence service designed for autonomous AI agents.

The service currently has three main capability groups:

1. **Anime / collectible purchase intelligence**
2. **PARTS INTELLIGENCE for industrial, replacement and discontinued parts**
3. **Generic commerce search for larger product markets**

Travel adapters also exist in the codebase, but live travel inventory remains disabled until provider credentials are configured.

The service is built on:

- Cloudflare Workers
- Supabase
- MCP
- OpenAPI
- x402
- Solana USDC
- Yahoo Shopping integration
- eBay Browse integration
- Rakuten affiliate routing
- public merchant / purchase pages

The design goal is to let an AI agent move from:

`search â identify â evaluate â decide â select seller â pay for intelligence â hand off to purchase`

without requiring a human to manually assemble information from multiple sources.

---

# 1. Anime / Collectible Intelligence

The original ANIME INTELLIGENCE engine focuses on physical Japanese anime collectibles.

Supported product categories include:

- scale figures
- Nendoroid
- figma
- prize figures
- plush
- acrylic goods
- keychains
- badges
- model kits
- trading cards
- collaboration apparel
- collaboration sneakers
- other physical anime merchandise

The system is designed to handle difficult identity problems such as:

- multiple editions of the same character
- rereleases
- manufacturer differences
- Japanese-only product names
- JAN/EAN differences
- prize vs retail versions
- seller-title noise
- incomplete marketplace listings
- ambiguous multilingual search queries

The service resolves a canonical product before returning higher-value purchase intelligence.

---

## Free Anime Search

### `GET /v1/search`

Example:

```text
/v1/search?query=Hatsune%20Miku
```

Use this for candidate discovery when the exact product is not yet known.

---

# 2. Paid Anime x402 Intelligence

Paid endpoints use Solana USDC via x402.

Current paid endpoints:

| Endpoint | Purpose | Price |
|---|---|---:|
| `/v1/identify` | exact product / edition identification | 0.005 USDC |
| `/v1/market` | current market value / price context | 0.01 USDC |
| `/v1/rarity` | scarcity and rerelease risk | 0.01 USDC |
| `/v1/authenticity` | counterfeit / listing mismatch risk | 0.02 USDC |
| `/v1/buy-wait` | BUY / WAIT / WATCH / AVOID decision | 0.02 USDC |
| `/v1/best-place` | best current purchase route | 0.03 USDC |
| `/v1/listing-match` | listing-to-canonical product verification | 0.01 USDC |
| `/v1/deadline` | preorder / lottery / purchase deadline | 0.01 USDC |
| `/v1/landed-cost` | buyer-country-aware landed cost | 0.02 USDC |
| `/v1/price-history` | historical price context | 0.02 USDC |
| `/v1/full-intelligence` | complete collectible decision intelligence | 0.05 USDC |
| `/v1/shopping-intelligence` | agent-ready purchase recommendation | 0.05 USDC |

The service resolves identity before payment when possible so an agent does not pay for the wrong product.

---

## x402 Payment Flow

1. Agent calls a paid endpoint without payment proof.
2. Server returns HTTP `402`.
3. Agent reads the `PAYMENT-REQUIRED` response header.
4. Agent creates the required Solana USDC payment.
5. Agent retries the exact same URL with `PAYMENT-SIGNATURE`.
6. `X-PAYMENT` is also accepted as a compatibility alias.
7. After verification and settlement, the endpoint returns HTTP `200`.
8. Successful responses include `PAYMENT-RESPONSE`.

Current x402 network:

- Solana mainnet
- USDC
- x402 v2

---

# 3. PARTS INTELLIGENCE

Version 3.10.x adds a second specialized information business:

**PARTS INTELLIGENCE**

It targets industrial, replacement, maintenance, discontinued and difficult-to-source parts.

Example categories:

- PLC
- sensors
- relays
- switches
- servo motors
- servo amplifiers
- inverters
- power supplies
- pneumatic components
- cylinders
- valves
- bearings
- motors
- connectors
- industrial control components
- machine replacement parts
- appliance / service parts
- camera parts
- audio parts
- tool parts
- IT / server replacement parts

The commercial value comes from resolving questions such as:

- What exact part is this?
- Is it discontinued?
- What is the successor?
- Is there a verified replacement?
- Is a candidate truly compatible?
- Which official document supports the relationship?
- Is the original still available?
- What is the best sourcing route?

---

## PARTS Data Model

PARTS INTELLIGENCE uses Supabase as the system of record.

Core tables:

### `parts_catalog`

Canonical part identity.

Typical fields:

- manufacturer
- brand
- part number
- normalized part number
- name
- category
- lifecycle status
- discontinued date
- successor part number
- specifications
- dimensions
- electrical attributes
- mechanical attributes
- official URL
- source confidence

### `parts_relations`

Explicit relationships between parts.

Supported relation types:

- `successor`
- `substitute`
- `compatible`
- `incompatible`
- `used_in`

This table is one of the most important assets in the service.

### `parts_documents`

Evidence and official reference documents.

Examples:

- official PDF
- catalog
- manual
- datasheet
- specification sheet
- replacement table
- compatibility note

### `parts_offers`

Observed sourcing information.

Examples:

- merchant
- price
- currency
- condition
- stock status
- URL
- observation time

### `parts_sources`

Configured official manufacturer sources.

The initial source registry contains:

- OMRON
- Mitsubishi Electric
- SMC
- IDEC
- Panasonic Industry
- Yaskawa
- Oriental Motor
- THK
- NSK
- Azbil

---

## PARTS Compatibility Policy

PARTS INTELLIGENCE does **not** infer compatibility merely because:

- product names look similar
- dimensions look similar
- model numbers look similar
- marketplace sellers claim interchangeability

A positive substitute / compatibility recommendation requires an explicit relation record with supporting evidence.

Unverified candidates are returned separately.

This is a deliberate safety and data-quality rule.

---

## PARTS Endpoints

### `GET /v1/parts/status`

Returns PARTS database and ingestion status.

### `GET /v1/parts/search`

Free part search.

Example:

```text
/v1/parts/search?part_number=E2E-X5ME1
```

or:

```text
/v1/parts/search?query=OMRON%20sensor
```

### `GET /v1/parts-intelligence`

Paid full PARTS intelligence.

Price:

`0.05 USDC`

Typical output includes:

- canonical part identity
- lifecycle state
- discontinuation status
- successor relationship
- verified substitute relationships
- unverified candidate relationships
- incompatibility evidence
- official documents
- sourcing observations
- purchase / sourcing decision

---

# 4. PARTS Ingestion Mode in v3.10.2

Version 3.10.1 included a larger autonomous manufacturer-site crawler.

Version 3.10.2 intentionally removes that crawler from the Cloudflare Worker runtime to reduce deployment size and runtime complexity.

Current ingestion mode:

`Supabase bulk import + admin upsert`

This keeps the production Worker smaller and more stable.

Initial target:

- several thousand high-quality parts
- then approximately 10,000 high-value FA / industrial parts
- then expand by manufacturer and category

No new external vendor API key is required for the PARTS core.

Existing Yahoo / eBay integrations may optionally enrich sourcing information.

---

## PARTS Database Setup

Run:

`PARTS_INTELLIGENCE_v3_10_2_SCHEMA.sql`

once in the existing Supabase SQL Editor.

The schema creates:

- `parts_catalog`
- `parts_relations`
- `parts_documents`
- `parts_offers`
- `parts_sources`
- `parts_ingest_runs`

It also seeds the initial official manufacturer source registry.

---

# 5. Generic Commerce Search

The server also exposes a more general AI purchase-intelligence layer.

### `POST /v1/commerce/search`

Supported domains currently include:

- `consumer_electronics`
- `automotive_parts`
- `enterprise_procurement`
- `mro_and_industrial_components`
- `electronic_components`

Current provider integrations reuse existing configured commerce sources.

---

## Identity Guards

Different domains use different recommendation rules.

### Consumer electronics

Generic market search is allowed.

### Automotive parts

An exact OE / MPN / part number is required before recommendation.

### Enterprise procurement / MRO / electronic components

An exact manufacturer part number is required before recommendation.

The service deliberately avoids recommending technically incompatible components from broad keyword similarity alone.

---

# 6. Travel Adapters

Travel code remains present in the Worker.

Current architecture supports:

- Booking.com Demand
- Duffel
- Expedia Rapid
- Amadeus adapter slot

Current production status:

`awaiting_credentials`

No travel provider is considered live unless:

`GET /v1/travel/status`

reports the provider as configured.

Travel is not currently the focus of the service because those providers require external API credentials.

---

# 7. MCP

MCP endpoint:

```text
https://anime-intelligence.goodmy0312.workers.dev/mcp
```

The server supports Streamable HTTP MCP.

Relevant tools include:

- `search_anime_product`
- paid anime intelligence tools
- `record_purchase_intent`
- `commerce_search`
- `parts_search`
- `parts_intelligence`
- `parts_status`
- travel tools

MCP metadata is designed so AI agents can understand:

- when to use a tool
- why the tool is paid
- expected output
- x402 payment behavior
- identity requirements
- compatibility restrictions

---

# 8. OpenAPI and Discovery

OpenAPI:

```text
/openapi.json
```

LLM-readable service description:

```text
/llms.txt
```

x402 discovery metadata:

```text
/.well-known/x402
```

MCP discovery metadata:

```text
/.well-known/mcp.json
```

Agent profile:

```text
/agent/profile
```

Agent services:

```text
/agent/services
```

Health:

```text
/health
```

---

# 9. Public Purchase Pages

Rakuten affiliate URLs are not directly redistributed through API responses.

Instead, the API can return a public product page hosted by ANIME INTELLIGENCE.

Example pattern:

```text
/shop/product/<canonical-product-id>
```

The public page can contain merchant routing and affiliate links in a human-readable media context.

This separation reduces ambiguity between machine-facing intelligence and merchant-facing affiliate routing.

---

# 10. Telemetry and KPI

The service records conversion telemetry in Supabase.

Important x402 funnel events include:

- API request
- canonical product selection
- x402 gate entered
- payment challenge issued
- payment retry received
- payment attempt
- payment verified
- paid call
- settlement success
- settlement failure

Important commerce events include:

- purchase intent created
- merchant selected
- purchase URL served
- affiliate click
- checkout started
- purchase confirmed

---

## External Revenue KPI

The system separates:

- true external commercial traffic
- crawlers / monitors
- admin tests
- known self-tests
- contextless synthetic probes

Important target KPIs include:

```text
confirmed_external_shopping_intent_calls > 0
external_canonical_product_selected > 0
payment_retry_received > 0
external_payment_attempts > 0
external_payment_verified > 0
external_paid_calls > 0
external_revenue_usdc > 0
```

A self-payment from the operator's own wallet should not be treated as external commercial revenue.

---

# 11. Health Check

Production health endpoint:

```text
https://anime-intelligence.goodmy0312.workers.dev/health
```

A healthy deployment should currently report:

```json
{
  "ok": true,
  "version": "3.10.2",
  "supabase": "ok"
}
```

PARTS status should report:

```text
active_supabase_core
```

and:

```text
new_external_api_keys_required: false
```

---

# 12. Deployment

Main production file:

`ANIME_INTELLIGENCE_v3_10_2_FULL_WORKER.txt`

Deployment workflow:

1. Open the Cloudflare Worker editor.
2. Replace the entire existing Worker with the new Worker file.
3. Deploy.
4. Verify `/health`.
5. Confirm `version = 3.10.2`.
6. Copy the same Worker source to GitHub `worker.js`.
7. Replace `server.json`.
8. Replace README.
9. Confirm the MCP Registry workflow succeeds.

---

# 13. Supabase

The project uses the existing Supabase environment and credentials.

PARTS INTELLIGENCE does not require an additional database account.

The Worker reuses the current Supabase service-role / secret configuration.

No anonymous database write policy is required.

---

# 14. Current Production Status

As of v3.10.2:

- Cloudflare Worker: active
- Supabase: active
- Anime intelligence: active
- x402: active
- MCP: active
- OpenAPI: active
- PARTS INTELLIGENCE core: active
- PARTS external API-key requirement: none
- Generic commerce search: active where existing provider credentials are configured
- Travel: adapter code present, live providers not configured
- Autonomous PARTS crawling: disabled in Worker
- PARTS bulk population: Supabase import / admin upsert

---

# 15. Current Priority

The next growth phase is to build the PARTS database itself.

Priority order:

1. populate several thousand canonical industrial parts
2. normalize manufacturer + part-number identity
3. attach official documents
4. add lifecycle / discontinued status
5. add verified successor relationships
6. add verified substitute / compatibility relationships
7. add sourcing observations
8. grow toward ~10,000 high-value records
9. expose more of the resulting intelligence through MCP + x402

The long-term asset is not merely the number of parts.

The highest-value data is the evidence-backed relationship graph:

```text
part â successor
part â verified substitute
part â incompatible alternative
part â machine / equipment usage
part â official document
part â current sourcing option
```

That relationship graph is what turns PARTS INTELLIGENCE from a search index into paid decision intelligence.
