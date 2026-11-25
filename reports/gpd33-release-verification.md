# GPD v33.0 リリース検証

2026-11-25 / build `20261125-3300-catalog-checkpoint-a1`

## 配布ファイル

- [単一ファイル Worker](../releases/GPD33_0_COMPLETE_WORKER.js)
- [Supabase スキーマ変更](../supabase/migrations/20261125053000_gpd33_catalog.sql)
- [Worker 統合テスト](../tests/gpd33_worker.mjs) と [PostgreSQL 統合テスト](../tests/gpd33_database.mjs)

本番 Worker への貼り付け用ファイルは Cloudflare の ES module 形式。既存のバインディングと10分 Cron を使用する。一般商品探索の稼働には、同梱の SQL を先に適用した Supabase が必要。公開ヘルスの `verified_catalog` と `operations` が `null` の場合、RPC の利用可否を確認する。v32.9 を再デプロイすることで Worker のロールバックができる。追加した DB オブジェクトや登録済み商品は保持する。

## 局所検証

- Node 24 で JavaScript 構文検証。公開 `/selftest` の116項目と内蔵 Parts Collector の61項目が通過。
- HTTP 統合テストで MCP 初期化とツール一覧、購買判断・既存アニメ・部品有料ルートの x402 v2 Solana チャレンジ、Merchant ルート、欠損した送料・在庫とバリエーションの判定を確認。決済ファシリテーターと商品データはフィクスチャを使用。
- PostgreSQL 17.12 の独立した2接続で、同一 Cron スロットの排他と同一商品への並行登録を確認。意図的な INSERT 制約エラー後のロールバック、期限切れ後の候補再開、識別表記違いによる既存専門商品の保護、サービスロール権限と匿名アクセス拒否を確認。
- Worker 統合テストで USDA の429から既存マーケットプレイスへの切替と、ステージ済み候補の DB 障害後再開を確認。テスト対象の切替経路では、DB RPC と外部 HTTP を合わせて24サブリクエスト以下。Cloudflare の統合 Cron 全体の本番 CPU 時間は未測定。
- eBay Browse の公開スキーマで `ItemSummary` に商品バーコードが含まれず、`getItem?fieldgroups=PRODUCT` の `product.gtins` を使えることを確認。そのレスポンス形状で候補照合をテストした。[eBay Browse getItem](https://developer.ebay.com/api-docs/buy/browse/resources/item/methods/getItem)
- USDA API から Branded 食品、GTIN、ブランド、包装情報を含む実レスポンスを取得。CC0 データを帰属付きで登録し、公開 DEMO_KEY の使用を UTC 日次最大20回に制限。429後は24時間休止する。[USDA FoodData Central API Guide](https://fdc.nal.usda.gov/api-guide/)

## 容量と登録速度

PostgreSQL の隔離フィクスチャでは既存行相当124,181件に24カテゴリー各10,000件を追加し、DB 全体330,749,619バイト、商品テーブル260,702,208バイト、商品インデックス62,054,400バイトを観測した。全24カテゴリーの集計は328 ms。フィクスチャに本番の価格履歴、他テーブル、実データの分布、DB の肥大化は含まれない。本番の500 MB枠に収まるかは、`operations.storage` に出る測定値と観測履歴量で確認する必要がある。

1回の食品カタログ読込みは最大40候補、マーケットプレイスは探索1枠と詳細取得最大3件。DB 登録は1バッチ最大40候補。日次2,400件には144スロット平均約16.7件の新規確定が必要。食品ソースは1カテゴリーに限られ、Yahoo の停止中に eBay 詳細と食品ソースだけで日次2,400件を維持できる設計上の供給量は確認できていない。500件、1,000件、2,400件はすべて未検証の目標。

GTIN やメーカー・MPN の照合は保守的に行う。MPN 単独の新規 canonical 登録と、根拠が弱い旧行の一括認定は保留する。公開ヘルスの `verified_catalog` は検証済みの一般商品を集計し、既存の未再検証行を別フィールドで返す。`growth_24h` は旧来のイベント集計、`catalog_totals` は DB の商品行、`operations` は DB のジョブ結果。外部決済は既存の管理用 KPI でテスト決済と区別される。

本番の Supabase 接続では認証要求が繰り返されたため、適用済みスキーマ、実商品数、本番サイズ、Cron 完了率、実収益は未確認。公開本番ヘルスで確認できた Worker は v32.9.0 で、商品・イベントテレメトリは取得不可だった。[本番 discovery-health](https://anime-intelligence.goodmy0312.workers.dev/v1/system/discovery-health)
