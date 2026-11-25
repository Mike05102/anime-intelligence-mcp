# 集客チャネルの計測と次回の配分

`measureSignedGpd33AcquisitionFunnel(bundle, trust, options)` は、同じコホートの署名付き集計を読み、訪問・利用開始・引き渡し・確認済み注文・収益を表示する。実際の流入や収益は、計測元が独立に裏付けた値を提供した場合に限り表示する。ネットワーク通信、外部登録や発信、広告購入、注文、送金、DB更新は発生しない。

## 証拠の形式

`bundle` と `trust` はそれぞれ `schema_version: 1` と `environment: "test" | "live"` を持つ。信頼する公開鍵とチャネルは、証拠の発行者から独立した運用経路で固定する。以下の2役割は別々のEd25519鍵を使う。実環境用の鍵とテスト用の鍵も分ける。

| 役割 | 署名文脈 | 行の値 |
|---|---|---|
| `journeys` | `gpd33-acquisition-journeys-v1` | `channel` と追跡可能な一意の `visits`、`activations`、`handoffs`。利用開始は最初の成功したAPIまたはMCP利用、引き渡しは対応する受付記録に基づく。 |
| `outcomes` | `gpd33-acquisition-outcomes-v1` | `channel`、台帳で確認できる `verified_orders`、独立照合済みの `x402_information_usdc_atomic`、`brokerage_usdc_atomic`。額はUSDCの最小単位を表す10進文字列。 |

`trust.issuers` は発行者IDから `{role, public_key}` へのマップ。公開鍵は32バイトの小文字16進数。`trust.channels` は観測を承認したチャネル名から `{authorized_free_work: true | false}` へのマップ。費用を伴うチャネルは観測値として表示できるが、次回配分の対象から除く。

`bundle.envelopes` の各要素は `{issuer,payload,signature}`。署名対象はJSONのUTF-8バイト列。`payload` と `signature` はパディングなしbase64url。署名対象内の `{issuer,context,environment,cohort_id,window_start,window_end,attribution,rows}` で、`cohort_id` はUUID、時刻はUnix秒。上下の発行元で同一環境・同一コホート・同一集計期間とし、先着経路の根拠を確認した場合に限り `attribution: "verified_first_touch"` を付ける。憶測で参照元、チャネル、注文を割り当てない。

観測できない値は `null`。独立証拠で観測したゼロは `0` または `"0"`。各段階は前段階と関係付けた一意の対象を集計し、異なるチャネルへ二重に帰属させない。収益はx402情報料と仲介手数料を区別し、互いを足し合わせた総収益は出さない。取得元のログ、外部台帳、照合明細の実データは本機能に含まれない。

## 配分のプレビュー

`options.budget` は0〜24の作業単位で、各チャネルは最大4単位。承認済み無料チャネルに幅広く最低限を割り当て、十分な標本のある経路では引き渡し率と確認済み注文を加味する。テストの出力は `planning_only.environment: "test"`。実環境のコホート期間が実行時刻から7日を超えて過去、または未来側に5分を超える場合は、計測結果を表示しつつ作業を割り当てない。`options.expectedCohortId` で事前選択したコホートを照合できる。
