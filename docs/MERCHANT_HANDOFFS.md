# 販売業者への引き渡し

この段階では、買い手の同意を確認した運用者が、検証済み・稼働中の販売業者の有効なオファーを引き渡す。販売業者は既存のMerchant APIキーで自社宛ての引き渡しを取得し、結果を報告する。

| 操作 | 認証と入力 |
|---|---|
| `POST /admin/handoffs` | 管理者キー。買い手の同意確認 `buyer_authorized: true`、`handoff_id` と `offer_id` にUUID、`quantity` に1〜1,000の整数。 |
| `GET /v1/handoffs/status` | 作成時に発行された追跡トークンを `Authorization: Bearer <token>` で送信。対象の引き渡しの現在状態と最終更新時刻を取得。 |
| `GET /v1/merchant/handoffs` | `X-Merchant-Key`。自社の直近30件、またはクエリの `handoff_id` で指定した1件を取得。 |
| `POST /v1/merchant/handoffs/events` | `X-Merchant-Key`。引き渡しUUID、イベントUUID、`state` と、該当時に `order_reference`。 |
| `GET /admin/business-outcomes` | 管理者キー。販売業者が認証して報告した受理・注文・取消を、照合済み取引と区別して表示。 |

新規の引き渡しは `requested`。販売業者は `accepted` または `declined` を報告できる。受理後は `order_reported` または `cancelled`、注文報告済みは `cancelled` へ進める。注文報告には販売業者側の参照番号が必要。注文報告後の取消には同じ参照番号を使う。番号はハッシュとして保存し、APIの応答には出さない。

追跡トークンは7日間有効で、対象の引き渡し1件の読み取りに限られる。運用者はトークンを買い手に安全な経路で渡し、URLやログに入れない。管理キーの更新で発行済みトークンが無効になる。状態の証拠区分は `merchant_reported`。

再送では同じUUIDと同じ入力を使う。状態変更と監査イベントは一つのトランザクションで記録する。同じ参照番号を別の引き渡しで使う場合や、同じUUIDで異なる内容を送る場合は409を返す。

商品の注文、課金、送金は発生しない。注文・取消は販売業者の報告として扱う。外部注文台帳や入金との照合、購入側のセルフサービス認証と取引手数料は後続工程。

## 販売業者の署名付き報告

運用者は、本人確認済み販売業者から別の確認済み経路で受け取ったEd25519公開鍵を、Workerの任意変数 `GPD_MERCHANT_SIGNING_KEYS` に登録できる。値は販売業者UUIDから32バイトの公開鍵（小文字16進64文字）へのJSONオブジェクト。登録した販売業者のイベントには既存のMerchant APIキーと署名が必要になる。秘密鍵は販売業者側で管理する。

署名対象は、空白を入れずにJSON化した次の配列のUTF-8バイト列。

```text
["gpd-merchant-handoff-v1",merchant_id,handoff_id,event_id,state,reference_hash,signed_at]
```

UUIDは小文字。参照番号がある場合、`reference_hash` は `gpd33-order|<merchant_id>|<前後の空白を除いた参照番号>` のSHA-256を小文字16進にした値。参照番号がない場合はJSONの `null`。イベント本文にUnix秒の `signed_at` と署名を小文字16進128文字で送る。許容時刻差は5分。期限切れを再送するときは同じイベントUUIDと内容に新しい時刻で署名する。

署名は受付時に検証する。追跡・集計上の証拠は引き続き販売業者の報告として扱う。外部注文台帳、実入金、仲介料との照合は別途必要。

## 買い手のセルフサービス試験

`POST /v1/handoffs` は既存Supabase Authでメールまたは電話の確認を済ませたアカウントのアクセストークンを受け取る。アカウントはSupabase Auth側で作成・確認する。Workerは `/auth/v1/user` で毎回認証し、本文の買い手IDは使用しない。買い手が在庫・配送と取引条件を確認したうえで `request_id`、`offer_id`、`quantity`、`buyer_country`、`buyer_authorized: true` を送る。同一の買い手とリクエストIDで再送すると同じ引き渡しを返す。販売業者には配送先の国だけを提示する。

本番では既定で無効。起動条件は移行SQLの適用、既存Authの登録・本人確認経路の確認、`SUPABASE_PUBLISHABLE_KEY` または `SUPABASE_ANON_KEY`、`GPD_BUYER_SELF_SERVICE=1`。有効時はUTC日単位で1買い手3件・全体30件、数量100以下に制限する。商品在庫や配送の情報は販売業者の登録内容を参照し、注文や決済を実行しない。

一般商品の候補は `GET /v1/merchant/search?gtin=<GTIN>&buyer_country=<国>` から取得する。買い手が `POST /v1/handoffs` に同じ `gtin` を渡すと、保存時に商品とオファーの識別が一致することも確認する。観測専用の販売業者はセルフサービスの引き渡し対象外。

GTIN検索では、販売業者が観測した時刻 `source_updated_at` が直近7日以内（時計差として未来5分まで）のオファーを引き渡し候補にする。時刻が欠落したオファーや期限超過のオファーは比較用に残し、`offer_evidence_fresh: false` を返す。新規の引き渡しにGTINを持つオファーを使う場合は、リクエストでGTINを省略した場合もDBで鮮度を確認する。既存案件の状態確認は引き続き可能。

GTIN検索に `quantity`（1〜100、既定1）を渡すと、希望数量を引き渡し候補の判定に使う。数量の証拠は `stock_quantity_evidence` で `sufficient`、`insufficient`、`unknown` に分ける。GTINを持つオファーの新規引き渡しでは、複数個の依頼に報告済みの在庫数が必要。単品では数量が未報告でも在庫状態を参照する。新しいフィードで数量が未報告の場合、過去の報告数を在庫数として使わない。

一般商品の購買判断は、複数個の在庫数が未報告・不足の場合に確認を求める。検証済みGTINから販売業者検索へ移るURLには複数個の希望数量を引き継ぐ。100個を超える見積りでは、上限が100個のセルフサービス用URLを提示しない。
