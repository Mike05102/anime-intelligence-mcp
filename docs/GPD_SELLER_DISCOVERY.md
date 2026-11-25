# 販売業者の探索証拠

公開ディレクトリは確認済みの稼働中販売業者を案内する。新しい販売業者の候補は、利用条件に適合する取得済みデータからオフラインで整理する。

```sh
node scripts/gpd33_seller_discovery.mjs manifest.json
```

入力は最大256 KiB、500件のJSON配列。情報源には `merchant_feed`、`partner_directory`、`ebay_browse`、`yahoo_shopping` を使用できる。各行に `source`、`source_seller_id`、`public_name`、`evidence_url`、`observed_at` を指定し、所在地が判明していれば `merchant_country` に2文字コードを指定する。`observed_at` はUTC。許可済みの販売業者・パートナーフィードに公開可能な同意参照がある場合は、`opt_in_evidence_url` と `opt_in_observed_at` を指定する。

同じ情報源の同じ販売業者IDは、最新の観測にまとめる。観測と同意参照の有効期間は30日。クエリとフラグメントを除去したHTTPSの参照を出力する。入力には公開可能な情報のみを使い、URLのパスにも秘密情報を含めない。異なる情報源の販売業者の同一性は審査する。

`review_discovery_evidence` は候補の根拠を調べる状態。`review_opt_in_evidence` は記載された同意の根拠と、販売業者本人・組織の権限を確認する状態。市場の出品情報は候補の根拠としてのみ扱う。審査前の候補は公開せず、接触や登録にも使わない。このコマンドはローカルに結果を出力し、本番や外部サイトには接続しない。
