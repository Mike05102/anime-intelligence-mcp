# 取引証拠と仲介手数料の照合

`scripts/gpd33_reconcile.mjs` は、別々に取得・検証した注文台帳、契約条件、確定入出金とGPDの引き渡し記録を照合する。DB・ネットワークへの接続、送金、課金、記録の更新は行わない。運用者が管理する隔離環境で実行し、入力も出力も公開ログやGitHubに保管しない。

検証済みの入力ファイルを使う場合は `node scripts/gpd33_reconcile.mjs <ファイルパス>` を実行する。開発時は `node tests/gpd33_reconcile.mjs` でテスト値を使う。

## 入力と信頼境界

入力JSONの `schema_version` は `1`。`environment` は集計対象として `test` または `live` を指定する。すべての配列の各行も `environment` を持つ。実環境とテストの分類は、信頼済み取込処理が出所とネットワークを確認して設定する。

| 配列 | 必要な値 |
|---|---|
| `handoffs` | `handoff_id`、`merchant_id`、`order_reference_hash`、`state`（`order_reported` または `cancelled`）。 |
| `orders` | 同じIDと参照ハッシュ、台帳の `source`、`record_id`、`state`（`confirmed` または `cancelled`）、`verification`。販売業者の正式注文台帳を信頼済み経路で確認後、`authoritative_ledger` を付ける。 |
| `fees` | `handoff_id`、`merchant_id`、`invoice_id`、`agreement_id`、`network`、`asset`、`amount_atomic`、`payer`、`payee`、`approval`。合意済み条件から請求額を確定して `contract_verified` を付ける。 |
| `receipts` | `handoff_id`、`invoice_id`、`network`、`asset`、`transfer_id`、`amount_atomic`、`payer`、`payee`、`category`（`brokerage_fee`、`x402_information`、`goods_payment`）、`direction`（`credit` または `refund`）、`verification`。決済台帳で確定を確認後、`finalized_ledger` を付ける。 |

UUIDとハッシュは小文字。注文参照には [販売業者への引き渡し](MERCHANT_HANDOFFS.md) と同じハッシュ化を使う。額は通貨の最小単位を10進整数文字列で渡す。`asset` はネットワーク内で一意な通貨識別子を使う（Solanaトークンならミントアドレス）。`transfer_id` には同一ネットワーク内で一意な送金の識別子を使う。複数送金を含み得る台帳では取引署名に指示インデックスを加えて区別する。`invoice_id` は環境内で一意とし、入金と請求の関連づけを信頼済み取込処理で確認する。返金は元の請求と同じID、逆方向の口座で扱う。

受信した署名付き報告、x402チャレンジ、購入意向から上記の検証区分は付けられない。公開APIの本文を直接入力しない。収入合計は確認済み注文の契約額と確定入金が一致する仲介料のみを資産・ネットワーク別に返す。完全に整合する重複は1件にまとめる。矛盾、未入金、不足金額、無効な入出金は要照合として残す。取消後の入金は返金確認の対象として扱う。

現在の範囲はローカルの証拠照合とテスト。取込元の真正性・確定性の検証、完全な対象期間の抽出、契約連携、会計台帳への取り込みは接続前に別途検証が必要。`supplied_live_evidence_only` は提供された実環境区分の証拠の範囲を表す。テスト出力は `test_only`。
