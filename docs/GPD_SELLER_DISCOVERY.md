# 販売業者の探索証拠

公開ディレクトリは確認済みの稼働中販売業者を案内する。新しい販売業者の候補は、利用条件に適合する取得済みデータからオフラインで整理する。

```sh
node scripts/gpd33_seller_discovery.mjs manifest.json
```

入力は最大256 KiB、500件のJSON配列。情報源には `merchant_feed`、`partner_directory`、`ebay_browse`、`yahoo_shopping` を使用できる。各行に `source`、`source_seller_id`、`public_name`、`evidence_url`、`observed_at` を指定し、所在地が判明していれば `merchant_country` に2文字コードを指定する。`observed_at` はUTC。許可済みの販売業者・パートナーフィードに公開可能な同意参照がある場合は、`opt_in_evidence_url` と `opt_in_observed_at` を指定する。

同じ情報源の同じ販売業者IDは、最新の観測にまとめる。観測と同意参照の有効期間は30日。クエリとフラグメントを除去したHTTPSの参照を出力する。入力には公開可能な情報のみを使い、URLのパスにも秘密情報を含めない。異なる情報源の販売業者の同一性は審査する。

`review_discovery_evidence` は候補の根拠を調べる状態。`review_opt_in_evidence` は記載された同意の根拠と、販売業者本人・組織の権限を確認する状態。市場の出品情報は候補の根拠としてのみ扱う。審査前の候補は公開せず、接触や登録にも使わない。このコマンドはローカルに結果を出力し、本番や外部サイトには接続しない。

## 署名付き参加意思の確認

`scripts/gpd33_seller_opt_in.mjs` は、探索結果と販売業者が署名した参加意思を、独立して管理された本人確認済みの公開鍵台帳に照合する。対象は `merchant_feed` または `partner_directory` で、候補に同意参照・確認日時・所在地がそろっている場合に限る。処理はオフラインで実行され、販売業者への連絡やアカウントの作成、商品公開、費用の発生を伴わない。

```sh
node scripts/gpd33_seller_opt_in.mjs <探索結果.json> <非公開の公開鍵台帳.json> <署名エンベロープ配列.json> <新規の非公開出力ファイル.json>
```

各入力ファイルは実行者が所有する最大256 KiBの通常ファイルとし、権限を所有者に限定する。署名は1回200件まで。出力先も実行者が所有する非公開ディレクトリを使う。出力ファイルは既存ファイルを上書きせず、内容を書き終えた時点で所有者だけが読み書きできる形で保存する。探索結果と本人確認の台帳は別経路で用意し、鍵と販売業者の対応を管理者が確認する。テスト用と実環境用の台帳、鍵、成果物は分離する。

台帳は `schema: "gpd-seller-opt-in-trust-v1"`、`environment`（`test` または `live`）、販売業者本人確認ID（UUID）をキーにした `sellers` を持つ。各登録には `public_key`（Ed25519生公開鍵、小文字16進64文字）、確認済み `name`、`country_code`、`website_url`、`source_ids`（例 `merchant_feed:seller-a`）、`opt_in_origins`（同意参照を置けるHTTPSオリジン）を指定する。既存のGPD販売業者と商品フィードを接続する場合は、確認済みの `merchant_id` と `feed: {url, product_origins}` を追加する。URLはHTTPSであり、認証情報・クエリ・フラグメントを含めない。鍵、情報源のID、既存販売業者IDの重複登録は拒否される。

エンベロープは `{seller_id, payload, signature}`。後ろ2つはパディングなしbase64urlで、署名対象は `payload` を復号したUTF-8 JSONの原文。署名するJSONは `context: "gpd-seller-opt-in-v1"`、`environment`、`seller_id`、`request_id`（UUID）、`scope`、`source`、`source_seller_id`、`country_code`、`evidence_url`、`signed_at`、`expires_at` を持つ。未登録の場合の `scope` は `preview_onboarding`、既存フィード接続は `review_feed_connection` で台帳と同じ `feed_url` を加える。現在時刻、探索側が同意参照を観測した時刻、有効期限を照合する。有効期間は最大30日。同一の要求IDが異なる有効な内容を署名していた場合は、該当販売業者の下書きを出力しない。

`private_preview` の結果には、未登録販売業者の `registration_draft` または既存販売業者の `feed_connection_draft` が含まれる。登録には販売業者本人による利用規約の同意が必要で、フィード接続には運用者の期限付き承認が必要。確認後に [承認済み商品フィードの手順](GPD_MERCHANT_OFFER_FEED.md) へ進む。署名、連絡先、同意URLは下書きに転記しない。署名付き参加意思の確認だけで契約や本番登録が完了したとは扱わない。

## 承認済み情報源の自動巡回

```sh
node scripts/gpd33_seller_discovery_tick.mjs <非公開ソース台帳.json> <非公開需要集計.json> <所有者専用の状態ディレクトリ>
```

ソース台帳は `schema: "gpd-seller-discovery-registry-v1"`、`environment`、`max_reads`（1〜2）、最大24件の `sources` を指定する。各情報源は一意の `id`、`kind`（探索入力と同じ4種類）、公開で認証不要の固定HTTPS `endpoint`、利用条件の `terms_url`、期限 `approved_until`、`approved_for: "public_seller_discovery"`、`no_cost_public_read: true`、対象 `domains`、`buyer_countries`、`evidence_origins` を持つ。購入先地域を問わない情報源は `buyer_countries: []` とする。パートナーや販売業者の明示同意を参照できる情報源には、必要に応じて `consent_origins` を設定する。利用条件、無料閲覧、オリジンは運用者が確認してから台帳に載せる。付与済みの条件は外部サイトから自動変更しない。

需要集計は `schema: "gpd-seller-discovery-demand-v1"`、台帳と同じ `environment`、`observed_at`、`rows` を持つ。各行は `domain`、`buyer_country`、個人を含まない `request_count` の合計。7日を過ぎた需要集計では巡回順を使う。需要優先と最も長く未確認の情報源を組み合わせる。外部には固定URLへのGETのみ送り、需要値・検索語・利用者識別子を送らない。1時間あたり最大2件・1回64 KiBで、読み取り前に枠を確保する。429を受けた情報源には6時間以上の待機を設け、サーバーがより長い `Retry-After` を示す場合はその時刻まで待つ。

取得先は `schema: "gpd-seller-discovery-feed-v1"` と最大100件の `sellers` を返す。行の形式は上記の探索証拠と同じだが、`source` は台帳の `kind` で固定する。ネイティブAPIの応答を使う場合は、そのAPIの利用条件の範囲内でこの形式に整形する公開アダプターの運営主体とURLを承認する。市場由来の行から同意証拠を作らない。外部販売業者IDに台帳のソースIDを付け、異なる取得先の同じIDを混同しない（例 `partner_directory:partner.seller-a`）。

非公開ディレクトリの `seller-discovery-report.json` はそのまま署名付き参加意思の確認コマンドに渡せる。CLIの標準出力は件数と実行状態のみ。試験区分ではモックリーダーを用い、外部ソースを有効にしない。本番運用で使用するソース台帳の承認と設定は別途必要。

## 米国 NHTSA vPIC のメーカー候補

`nhtsa_vpic` は鍵なしの公式メーカー一覧を利用する。ソースのカテゴリーは `automotive_parts` に限定し、台帳で `https://vpic.nhtsa.dot.gov/api/vehicles/GetAllManufacturers?format=json&page=1` のようにページを固定する。照会は既存の回数・応答サイズ・クールダウン制限に従う。米国市場向けの公的メーカー情報を提供するが、個別製品、販売可否、配送能力、同意は別途確認する。 [API仕様](https://vpic.nhtsa.dot.gov/api/) · [公開データ案内](https://data.transportation.gov/Automobiles/NHTSA-Product-Information-Catalog-and-Vehicle-List/j8kd-qyeh)

2026-11-25 UTCに第1ページを公開GETで取得し、応答100件を隔離環境のアダプターでメーカー候補100件に変換した。実販売業者の同意確認、取込、本番設定は未実施。

2026-11-26 UTCに第2ページを17,459バイトで取得した。第1ページと公式メーカーIDで照合し、新規候補100件、累計200件を確認した。ページ設定名を変更しても同じメーカーIDに対応する候補キーは一定。
