# AIエージェントの接続と登録

GET `/.well-known/gpd` からMCP、OpenAPI、x402、販売業者一覧、購買判断、買い手アカウント、引き渡しのURLを取得する。公開文書の取得でDBや外部APIは呼び出さない。買い手の機能は最初は無効。購買判断のx402の条件はOpenAPIとx402の文書を参照する。

運用者が既存のSupabase Authで公開登録、メール送信上限、本人確認、濫用対策を確認した場合、`GPD_BUYER_SELF_SERVICE=1`、`GPD_AGENT_SIGNUP_DISCOVERY=1` と既存の `SUPABASE_PUBLISHABLE_KEY` を設定できる。公開文書の登録情報には標準のHTTPS SupabaseプロジェクトURLと `sb_publishable_` 鍵のみが掲載される。従来のanonキーで動作する買い手APIもある。サービスロール鍵を公開文書に掲載しない。

エージェントの運用者は掲載されたプロジェクトのSupabase Authでアカウントを作成し、メールまたは電話による確認を完了する。取得したアクセストークンは `GET /v1/agent/account` と `POST /v1/handoffs` にBearer認証で渡す。アカウント確認の応答には固有IDと確認状態のみが含まれる。売り手への引き渡しは [取引の手順](MERCHANT_HANDOFFS.md) を参照する。

公開登録案内は既定で無効。本番Auth、外部エージェントの採用、登録数、利用頻度は未検証。

## 最初の接続を確認する

1. エージェントのMCPクライアントに、探索文書の `mcp_url` をStreamable HTTPで設定する。`onboarding.free_mcp_tools` に掲載された `product_resolve`、`merchant_directory` などを試す。HTTPクライアントでは探索文書が案内する `/agents/examples` の無料例を使える。
2. `buyer.mode` が `registration_advertised` の場合は、運用者が `buyer.registration` のSupabaseプロジェクトと公開可能な鍵を対応するクライアントに設定し、登録と本人確認を行う。`account_verification_configured` の場合は、既に確認済みのアカウントを使う。`unavailable` の場合は、無料の探索と購買判断の案内を利用できる。
3. 取得したアクセストークンをクライアントの認証ストアに保持し、同じGPDの接続先にある `buyer.account_url` へ `Authorization: Bearer <access_token>` を送る。`200` と `verified: true` を確認する。`401` ならサインインと本人確認を確認し、`503` なら買い手経路の稼働確認を待つ。この確認で購入や決済は行われない。
4. 実際に引き渡す前に売り手、商品の状態、在庫と配送先を確認し、買い手の同意を得る。対象の条件と再送に使うリクエストIDは [取引の手順](MERCHANT_HANDOFFS.md) を参照する。

`/agents/readiness` の `buyer_configuration` は設定の状態を返す。本番の登録可否は、上記の確認済みアカウントによる応答と区別する。自動処理に渡すトークン、メールアドレス、決済情報を公開文書やログに含めない。

## MCP Registryと公開バージョン

MCPの既存の登録名は `io.github.Mike05102/anime-intelligence-mcp`。登録用メタデータを変更するときは、公開済みバージョンと照合済みのリリース候補を区別する。次の検証は候補Workerをローカルで起動し、公開先への通信を使わずにMCP初期化、ツール一覧、OpenAPI、探索文書を照合する。

```sh
node tests/gpd33_registry_draft.mjs
node scripts/gpd33_registry_draft.mjs --draft 33.0.0
```

通常のコミットまたはタグでは外部レジストリを更新しない。本番切替が承認・検証された後、外部レジストリへの公開も承認された場合に限り、`Publish verified GPD metadata to the MCP Registry` を `main` で実行し、本番のバージョンとビルドIDを指定する。公開前に実際のWorkerのヘルス応答、MCPメタデータ、GPD探索URLが一致することを確認する。開発時のメタデータ検証は登録、採用、支払いの実績とは区別する。

## 外部からの発見と接続を確認する

公開済みのバージョンについて、公式MCP Registryの最新掲載、実際のWorkerバージョンとビルド、公開URLを照合する。認証なしでMCP初期化とツール一覧取得まで行い、無料の探索と有料の購買判断の公開メタデータを確認する。

```sh
node scripts/gpd33_acquisition_audit.mjs "<deployed-version>" "<deployed-build-id>"
```

`channel_ready: true` には、認証なしのMCP接続と、現在のバージョンに一致する公式の有効な最新掲載の両方が必要。出力の `registry_status` で掲載が見つからない場合や、バージョンが異なる場合を区別できる。掲載情報だけを取得する場合は `node scripts/gpd33_registry_observe.mjs "<deployed-version>"` を使う。確認コマンドは有料ツール、購入処理、外部レジストリ更新を呼び出さない。

隔離Workerとレジストリのモックで `node tests/gpd33_acquisition_audit.mjs` と `node tests/gpd33_registry_observe.mjs` を再現できる。実際の公開掲載・接続、利用者獲得、決済の証拠は、それぞれの観測結果に基づいて扱う。
