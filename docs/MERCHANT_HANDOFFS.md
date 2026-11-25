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
