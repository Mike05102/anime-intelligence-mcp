# 合意済み販売業者の商品フィード

事前に販売業者本人または組織の権限保有者からフィード利用の同意を確認する。承認ファイルは運用者が作成し、フィード提供者から渡されたファイルとは独立して管理する。

```sh
node scripts/gpd33_merchant_offer_feed.mjs approval.json feed.json
```

承認JSONには `merchant_id`、承認した完全なHTTPSの `feed_url`、UTCの承認期限 `approved_until`、商品URLに使えるオリジンの配列 `product_origins` を指定する。フィードは `schema: "gpd-merchant-offer-feed-input-v1"` と、同じ `merchant_id`、`feed_url`、UTCの `observed_at`、`offers` 配列を持つ。各ファイルは256 KiB以下、オファーは1〜200件。観測時刻が7日を超えたフィードは拒否する。

各オファーには `merchant_sku`、`manufacturer`、`part_number`、`title`、`currency`、十進文字列の `price`、`stock_status`、`ships_to`、`product_url` を指定する。GTINが分かる場合は `gtin` に数字列を指定する。配送先は国別に明示する。未確認なら空配列を渡す。URLに認証情報、クエリ、フラグメントを含めない。重複SKUや不正行があるフィードは一括で拒否する。

在庫数を確認できた場合は `stock_quantity` に0〜2,147,483,647のJSON整数を指定する。確認できない場合は省略または `null` とし、購入可能な数量として扱わない。プレビューと公開前の再検証は同じ範囲で確認する。

商品の状態を確認できた場合は `condition` に `new`、`used`、`refurbished`、`open_box` のいずれかを指定する。不明の場合は `unknown`、省略、または `null` を使う。状態を推定して新品として扱うことはない。

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

同じレポートを繰り返し処理する運用では、公開コマンドの末尾に権限 `0700` の既存レシートディレクトリを指定する。Linuxの `flock` で並行公開を防ぎ、確認済みの応答だけを権限 `0600` のレシートとして保存する。同じWorker、販売業者、スナップショット、レポートの承認が再度確認できた場合は `already_imported` を返し、DNSやHTTPの通信を省く。`import_in_progress` は別プロセスが処理中であることを示す。レシート保存前に停止した場合は成功を確定できないため、同じ承認条件での再送をWorkerの冪等性で処理する。

## WooCommerce Store APIからのプレビュー

WooCommerceの店舗運用者が、具体的な商品と販売条件についてGPDへの取得を承認した場合に使う。署名付きのフィード接続への同意を確認し、運用者が独立した既存の読み取り承認JSONに次を追加する。

- `feed_format: "woocommerce-store-api-v1"` を指定する。承認URLを `/wp-json/wc/store/v1/products` または単一商品 `/wp-json/wc/store/v1/products/<id>` に固定する。同じHTTPS接続の制限でGETを1回行い、追加ページを自動取得しない。
- `woo_products` に最大50件の承認済み商品を登録する。各行にWooCommerceの正の整数 `id`、`type`（`simple` または個別の `variation`）、`merchant_sku`、`manufacturer`、`part_number`、`gtin`、正確な `product_url`、配送先の `ships_to` を記載する。`condition` は確認できる場合に指定する。
- WooCommerceが返したID、SKU、GTIN、商品URLが承認と一致した行を取り込み候補にする。GTINは数字列とチェック桁を検証する。一般的なSKU、名称、ブランドをそのままメーカー型番やGTINとして扱わない。未承認の商品は候補に入れない。

価格はStore APIが返した通貨と最小通貨単位から十進文字列に変換する。価格幅がある親商品や、パスワードで保護された商品は受け付けない。在庫・取り寄せの欄が揃う範囲で状態を記録し、店舗の低在庫表示から数量を推定しない。応答でキャッシュ経過を取得でき、1時間を超える場合は拒否する。観測時刻は取得した時点で、店舗データそのものの更新時刻とは区別する。

実行方法は既存の `gpd33_merchant_feed_fetch.mjs approval.json` と同じ。結果は公開前のプレビューで、公開リクエストの作成時にも承認済み識別子、製造元、リンク、配送先を照合する。 `node tests/gpd33_woocommerce_feed.mjs` は独立した承認、GTIN照合、GBPとJPY、在庫不明、改変時の拒否をモックで確認する。 [公式のPublic Store API](https://developer.woocommerce.com/docs/apis/store-api/) · [商品と価格属性](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products) · [公式の在庫状態欄](https://woocommerce.github.io/code-reference/files/woocommerce-src-storeapi-schemas-v1-productschema.html)
