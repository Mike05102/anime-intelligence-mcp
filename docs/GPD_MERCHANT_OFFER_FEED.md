# 合意済み販売業者の商品フィード

事前に販売業者本人または組織の権限保有者からフィード利用の同意を確認する。承認ファイルは運用者が作成し、フィード提供者から渡されたファイルとは独立して管理する。

```sh
node scripts/gpd33_merchant_offer_feed.mjs approval.json feed.json
```

承認JSONには `merchant_id`、承認した完全なHTTPSの `feed_url`、UTCの承認期限 `approved_until`、商品URLに使えるオリジンの配列 `product_origins` を指定する。フィードは `schema: "gpd-merchant-offer-feed-input-v1"` と、同じ `merchant_id`、`feed_url`、UTCの `observed_at`、`offers` 配列を持つ。各ファイルは256 KiB以下、オファーは1〜200件。観測時刻が7日を超えたフィードは拒否する。

各オファーには `merchant_sku`、`manufacturer`、`part_number`、`title`、`currency`、十進文字列の `price`、`stock_status`、`ships_to`、`product_url` を指定する。GTINが分かる場合は `gtin` に数字列を指定する。配送先は国別に明示する。未確認なら空配列を渡す。URLに認証情報、クエリ、フラグメントを含めない。重複SKUや不正行があるフィードは一括で拒否する。

出力の `upsert_payload` は、既存の認証付きMerchantオファーAPIのバッチ入力に合わせたプレビュー。運用者が確定した販売業者と商品、価格、在庫、配送条件を確認して使用する。この処理はローカルファイルを検証し、フェッチ、販売業者登録、商品登録、外部連絡、注文を行わない。GTINチェック桁は入力の妥当性の検査であり、商品の実在・同一性には独立した商品根拠を使う。

## 承認済みHTTPSフィードの取得

```sh
node scripts/gpd33_merchant_feed_fetch.mjs approval.json
```

承認ファイルのURLだけに認証情報なしのGETを1回送る。接続先を公開IPv4に限定し、名前解決したIPに接続を固定する。リダイレクト、HTTP、プライベートアドレス、圧縮応答は拒否する。接続と応答を通した時間制限は8秒で、最大256 KiBのJSONだけを読み取る。取込結果は同じプレビュー形式で、公開・登録・注文は行わない。IPv6専用配信や認証が必要なフィードは、許可された経路で取得したファイルをオフライン確認に渡す。
