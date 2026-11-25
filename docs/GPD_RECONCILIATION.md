# 取引証拠と仲介手数料の照合

`scripts/gpd33_reconcile.mjs` は、別々に取得・検証した注文台帳、契約条件、確定入出金とGPDの引き渡し記録を照合する。DB・ネットワークへの接続、送金、課金、記録の更新は行わない。運用者が管理する隔離環境で実行し、入力も出力も公開ログやGitHubに保管しない。

テスト用の整形済み入力を使う場合は `node scripts/gpd33_reconcile.mjs <ファイルパス>` を実行する。実環境区分のファイルは、下記の署名付き取り込みを使う。開発時は `node tests/gpd33_reconcile.mjs` と `node tests/gpd33_reconcile_signed.mjs` でテスト値を使う。

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

現在の範囲は署名の検証、ローカルでの証拠照合、テスト。外部事業者の台帳からの取得と決済ネットワークでの確定確認、完全な対象期間の抽出、契約連携、会計台帳への取り込みは接続前に別途検証が必要。`supplied_live_evidence_only` は提供された実環境区分の証拠の範囲を表す。テスト出力は `test_only`。

## 署名付きスナップショット

運用者が独立した経路で固定した公開鍵の台帳を使い、`node scripts/gpd33_reconcile_signed.mjs <証拠バンドル> <公開鍵台帳>` で照合する。公開鍵台帳は証拠バンドルの作成者から取得せず、書き換え権限を管理する。有効な署名は登録した出所の証言を認証する。運用者は、各出所が実際に台帳を照会し、確定性を確認してから署名するように管理する。

公開鍵台帳には `schema_version: 1`、`environment`、発行者IDをキーとする `issuers` を指定する。各発行者は `role` とEd25519の生公開鍵 `public_key`（小文字16進64文字）を持つ。注文・契約の発行者は許可対象の `merchant_ids`、入出金の発行者は `networks` を指定する。鍵の使い回しは禁止。テストと実環境の公開鍵台帳は別ファイルとし、異なる鍵で運用する。

証拠バンドルには `schema_version: 1`、`environment`、`envelopes` を指定する。各要素は発行者ID `issuer`、ペイロードUTF-8のパディングなしbase64url `payload`、そのバイト列に対するEd25519署名のパディングなしbase64url `signature` を持つ。ペイロードは `context`、`issuer`、`environment`、`snapshot_id`（UUID）、`observed_at`（Unix秒）、`rows` のJSONオブジェクト。すべての発行者が同一のスナップショットID・時刻を使う。ゼロ件の発行者も空配列に署名する。対象期間の鮮度は出力の `observed_at` と運用側の照合期間を比較して管理する。

| 発行者の役割 | 署名の文脈 | 行に必要な追加条件 |
|---|---|---|
| `handoffs` | `gpd33-handoffs-v1` | GPDの引き渡し台帳から抽出。 |
| `orders` | `gpd33-external-order-ledger-v1` | 許可販売業者の正式台帳にある成立または取消。 |
| `fees` | `gpd33-agreed-fees-v1` | 許可販売業者で `contract_state: "executed"`。 |
| `receipts` | `gpd33-finalized-settlement-v1` | 許可ネットワークで `settlement_state: "finalized"`。 |

署名付き取り込みは、上記の条件を満たす出所から `verification` と `approval` を付ける。元の行に含まれる自己申告値は使用しない。

### 外部台帳アダプターとのファイル連携

既存の無料環境で、許可された読み取り専用台帳アダプターが発行者別の署名エンベロープを書き出せる場合、バンドルの手動作成を省略できる。管理下の非公開ステージングディレクトリに、同じスナップショットの `<発行者ID>.json` を配置する。各ファイルはエンベロープ1件。作成途中のファイルは公開せず、同じディレクトリで一時ファイルからの名前変更を使う。

```sh
node scripts/gpd33_reconcile_acquire.mjs <ステージングディレクトリ> <管理者の公開鍵台帳> <期待するスナップショットUUID>
```

取得処理は固定された発行者のファイルだけを読み、リンク、通常ファイル以外、サイズ上限を超えるファイル、読み取り中に変化したファイルを拒否する。公開鍵台帳はステージングの書き込み権限と分離する。署名や指定のスナップショットが一致した証拠だけが照合に進む。台帳への直接接続や確定性の取得はアダプター側の責務。本リポジトリの検証は隔離された署名済みファイルを使う。

### 承認済みHTTPS発行元からの取得

管理者の公開鍵台帳に任意の `https_sources` を加え、発行者ごとに承認済みの完全なHTTPS URLを `url` として固定できる。Bearer認証が必要な場合は `authorization_env` に既存の環境変数名を指定し、値を台帳やURLに書かない。URLの登録先、運営主体、証拠取得権限は運用前に確認する。発行元は承認済みのスナップショットだけを返す読み取り専用先を使う。実行時に発行元やURLを証拠ファイルから決めることはない。

`acquireHttpsGpd33Snapshot(trust, snapshotId)` は、登録済みの発行元にだけGETする。公開IPv4に接続を固定してTLSでホスト名を検証し、転送先の変更やURLへの認証情報の埋め込みを拒否する。バッチのネットワーク処理は20秒、復号後の入力は発行元ごとに1 MiB・合計4 MiBに制限する。エンベロープの発行元、署名、指定のスナップショットが一致してから照合する。リポジトリ内のテストはモック応答だけを使う。ファイルからの取得も従来どおり使える。
