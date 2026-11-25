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

## 独立承認後の公開

公開対象の [パートナー確認レポート](GPD_PARTNER_REVIEW.md) に対し、運用者が別の書込み承認ファイルを作成する。読み取り用のフィード承認やレポート自体に公開権限はない。

```sh
node scripts/gpd33_merchant_feed_publish.mjs --digest private/report.json
node scripts/gpd33_merchant_feed_publish.mjs private/report.json private/feed-approval.json private/write-approval.json
```

書込み承認の `schema` は `gpd-merchant-feed-write-approval-v1`。`allow_publish: true`、`merchant_id`、`snapshot_id`、左記ダイジェストを入れた `report_sha256`、末尾スラッシュのないHTTPSの `worker_origin`、UTCの `approved_until` を指定する。書込みを許すWorkerと承認対象の内容・期限を事前に確認する。販売業者キーは既存の `GPD_MERCHANT_API_KEY` 環境変数でプロセスに渡す。承認ファイル、レポート、キーを公開リポジトリやログに置かない。

公開処理はレポートをフィード承認と照合し直し、Workerにキーの所有者と確認済み状態を照会する。照合済みの対象にだけ専用フィード登録APIを呼ぶ。古い更新や同じ観測の再送は反映されず、既存オファーのIDを維持する。応答で反映件数と見送り件数を確認する。通信障害で応答が得られないときはこの処理から成功を判断できないため、同じ承認・同じレポートで状態を確認する。実取引や収益の確定処理とは独立している。
