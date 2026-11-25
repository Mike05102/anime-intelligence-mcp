# 承認済み販売業者フィードの定期観測

[フィード取得](GPD_MERCHANT_OFFER_FEED.md#承認済みhttpsフィードの取得)の承認が済んだ販売業者を対象にする。運用者が非公開のレジストリを用意し、既存の承認JSONを各販売業者に対応させる。レジストリと承認ファイルは実行ユーザーの所有とし、モードは `0600`。各承認ファイルはレジストリと同じディレクトリに置く。

```json
{
  "schema": "gpd-merchant-coverage-registry-v1",
  "max_feeds_per_tick": 2,
  "sources": [
    {"source": "approved-example", "approval_file": "approved-example.json"}
  ]
}
```

私有の状態ディレクトリに最新の集計を保存する。以下のコマンドは手動でもスケジューラーからも実行できる。

```sh
node scripts/gpd33_merchant_coverage_tick.mjs /private/registry.json /private/coverage-state
```

定期運用では、Linuxの `flock` を使える既存ジョブに上のコマンドを1時間ごとに設定する。たとえば既存のcronを使う場合は、所有者だけが書き込める設定ファイルで次のように指定する。実行環境のパスに置き換える。

```cron
7 * * * * /usr/bin/node /checkout/scripts/gpd33_merchant_coverage_tick.mjs /private/registry.json /private/coverage-state
```

32ソースまでを順番に巡回し、1時間に最大4フィード、1フィードあたり承認済みの同一URLから最大256 KiBを読み取る。並行起動はロックで抑え、再起動直後の重複取得を避けるため通信前に今回の枠を保存する。不足している承認や取得失敗は販売業者単位の状態に記録する。他の販売業者の観測は継続する。

状態ファイル `merchant-coverage.json` は公開せず、SKU、URL、価格、顧客・決済情報を含めない。構造化GTINを持つオファー数、在庫数の不明件数、在庫と配送先が申告されたオファー数と観測時刻を保存する。販売業者が報告した値として扱い、独立した商品照合や実在庫の確認には使わない。このジョブは取得と観測だけを実施する。オファー公開、販売業者への新規の連絡、購入や決済は別の承認対象。
