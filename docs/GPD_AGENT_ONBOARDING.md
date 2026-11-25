# AIエージェントの接続と登録

GET `/.well-known/gpd` からMCP、OpenAPI、x402、販売業者一覧、購買判断、買い手アカウント、引き渡しのURLを取得する。公開文書の取得でDBや外部APIは呼び出さない。買い手の機能は最初は無効。購買判断のx402の条件はOpenAPIとx402の文書を参照する。

運用者が既存のSupabase Authで公開登録、メール送信上限、本人確認、濫用対策を確認した場合、`GPD_BUYER_SELF_SERVICE=1`、`GPD_AGENT_SIGNUP_DISCOVERY=1` と既存の `SUPABASE_PUBLISHABLE_KEY` を設定できる。公開文書の登録情報には標準のHTTPS SupabaseプロジェクトURLと `sb_publishable_` 鍵のみが掲載される。従来のanonキーで動作する買い手APIもある。サービスロール鍵を公開文書に掲載しない。

エージェントの運用者は掲載されたプロジェクトのSupabase Authでアカウントを作成し、メールまたは電話による確認を完了する。取得したアクセストークンは `GET /v1/agent/account` と `POST /v1/handoffs` にBearer認証で渡す。アカウント確認の応答には固有IDと確認状態のみが含まれる。売り手への引き渡しは [取引の手順](MERCHANT_HANDOFFS.md) を参照する。

公開登録案内は既定で無効。本番Auth、外部エージェントの採用、登録数、利用頻度は未検証。

## MCP Registryと公開バージョン

MCPの既存の登録名は `io.github.Mike05102/anime-intelligence-mcp`。登録用メタデータを変更するときは、公開済みバージョンと照合済みのリリース候補を区別する。次の検証は候補Workerをローカルで起動し、公開先への通信を使わずにMCP初期化、ツール一覧、OpenAPI、探索文書を照合する。

```sh
node tests/gpd33_registry_draft.mjs
node scripts/gpd33_registry_draft.mjs --draft 33.0.0
```

通常のコミットまたはタグでは外部レジストリを更新しない。本番切替が承認・検証された後、外部レジストリへの公開も承認された場合に限り、`Publish verified GPD metadata to the MCP Registry` を `main` で実行し、本番のバージョンとビルドIDを指定する。公開前に実際のWorkerのヘルス応答、MCPメタデータ、GPD探索URLが一致することを確認する。開発時のメタデータ検証は登録、採用、支払いの実績とは区別する。
