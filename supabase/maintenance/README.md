# GPD 33 storage maintenance

Run `gpd33_storage_audit.sql` in SQL Editor to obtain a read-only report. It returns event counts, estimated stored payload bytes and the payload eligible for removal, along with the largest relations and their actual bytes. Shared index, TOAST and page overhead are not allocated to individual event types. An expired-payload estimate is not a forecast of disk space reclaimed.

The retention policy keeps 14 days of diagnostic history. Only the listed diagnostic and autonomous exploration events are eligible. Payment events, payment-related fields, product-linked events, purchase decisions and market snapshots are preserved. Unknown types are preserved. The policy does not change product rows, observations, payments or billing tables.

For a direct PostgreSQL connection or Supabase session pooler, run the following from the repository using an existing operator account and standard psql connection settings. Keep connection details out of command history and shared outputs.

```sh
bash supabase/maintenance/run_gpd33_storage.sh --audit
bash supabase/maintenance/run_gpd33_storage.sh --prune
bash supabase/maintenance/run_gpd33_storage.sh --reclaim
```

After the audit and physical headroom check, `--apply` runs the prune and reclaim steps in one invocation. Review the audit before pruning. The prune command installs the dedicated retention RPC if needed, removes bounded batches in separate transactions, runs ordinary VACUUM ANALYZE and reports the result. Ordinary VACUUM makes pages reusable and might not shrink the relation on disk. If the project is read-only or the estimate does not leave enough room for the catalog, reassess before proceeding.

The reclaim command uses a separate autocommitted VACUUM FULL with a two-second lock wait. Run it only in a maintenance window with adequate physical space for the rewritten live rows, indexes and WAL. It takes an exclusive lock on the event table. The command reports actual sizes afterward. If there is insufficient space, use ordinary VACUUM for reuse and arrange a separately verified export and rewrite. Do not use VACUUM FULL on the entire database for this procedure.

After the Worker is deployed, the service role invokes the restricted retention RPC every hour. Each batch is bounded. The scheduled path logs errors without disrupting catalog expansion. New scheduled candidate diagnostics omit fields that are available in retained market snapshots or unnecessary for the metrics. Financial and market history still require monitored capacity. New catalog inserts omit null metadata values. The catalog batch pauses above 400 million database bytes to leave a small operating margin.

Database size and physical disk usage are separate limits. Before opening catalog growth, verify the organization's usage and include the retained data, future product rows, indexes, preserved events and a working margin. The audit and test fixture are not measurements of how many bytes production will reclaim. [Supabase size limits](https://supabase.com/docs/guides/platform/database-size) · [PostgreSQL VACUUM](https://www.postgresql.org/docs/17/sql-vacuum.html)

## Request telemetry compaction

The ingress audit counts eligible raw rows using the same criteria as the compactor. Old GET/HEAD requests qualify only when stored flags show there was no payment header, query or product ID and no payment attempt matches the stored request ID. The function keeps counts by UTC day, event, endpoint, source, version, quoted amount and network. Counts and raw-row removal commit together. The protected payment rows are untouched. The admin KPI endpoint returns compacted ingress totals in its own field. Existing KPI fields continue to use retained raw events.

For the catalog pool and seeding cursor, the newest two snapshots of each type remain available. Only older diagnostic state is pruned. The existing run script applies both retention migrations before its cleanup pass. Verify capacity after compaction before applying the catalog migration.

## Storage policy and recovery

Initial cleanup requires `GPD33_ARCHIVE_DIR` on a private machine for a PostgreSQL custom-format backup of `api_events`. The script validates the backup table-data entry and SHA-256 checksum before it changes production rows. It needs a PostgreSQL client with `psql`, `pg_dump` and `pg_restore`. Store the backup outside Supabase and keep it private.

The insert trigger stores counts by UTC day for unsigned entries in the four traffic and quote stages. In x402, payment retries carry the original accepted terms and the facilitator validates the signed transaction. The trigger leaves the actual retry, verification, settlement and replay records in place. It also preserves any event that carries transaction or payer data. Routine health logs expire after 24 hours and recognized operational errors expire after seven days. Applying the physical rewrite requires measured disk space and a maintenance window. Scheduled cleanup relies on routine PostgreSQL vacuuming for page reuse.

Storage is sampled hourly. At 400 MB, the catalog batch pauses writes. At 450 MB, optional diagnostics are suppressed. Billing quota, WAL and other writers are independent of these per-database controls. Payment evidence remains protected at every threshold.

## iPhone から一度だけ実行する場合

Safari で GitHub のリポジトリを開き、Actions の **GPD 33 production maintenance** から **Run workflow** を選択する。作業ブランチは `main`。画面が狭い場合は Safari の「デスクトップ用Webサイトを表示」を使う。

- 既存の PostgreSQL 接続は `GPD33_DATABASE_URL`、`SUPABASE_DB_URL`、`DATABASE_URL` の順に使用する。未設定の場合はリポジトリの **Settings → Secrets and variables → Actions → New repository secret** に、既存の Supabase Session pooler 接続文字列を `GPD33_DATABASE_URL` として保存する。接続はTLSのホスト検証付きで行う。`GPD33_DB_CA_PEM` は独自のCA証明書が必要な場合のみ設定する。
- `GPD33_BACKUP_PASSPHRASE` はバックアップ専用の24文字以上の強いパスフレーズを使う。既存のDBパスワードとは分け、パスワードマネージャーに保管する。公開リポジトリに保存される成果物は暗号化済みファイルのみで、保持期間は30日。Actionsの成果物に利用可能な無料容量を確認する。機密情報をチャット、コミット、Actionsの入力欄に貼り付ける必要はない。
- 既存の `SUPABASE_ACCESS_TOKEN` が利用できるときは、物理ディスクの空き容量をSupabaseから取得する。トークンがなければ、SupabaseのDisk Usageで直近の空き容量を確認し、バイト単位で `disk_free_bytes` に入力する。
- Workerの自動切替には既存の `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` をActions secretsへ設定する。DBの保守だけを行うときは `deploy_worker` を解除する。

`check` は接続の確認用でデータを変更しない。`maintain` は暗号化済みバックアップをアップロードし、ダウンロードしたコピーのチェックサムと隔離環境でのイベントテーブル復元を検証してから、対象ログをバッチ処理する。十分な物理空き容量が確認できた場合にのみ `VACUUM FULL` を実行する。回収後のDBが400 MB未満の場合だけ商品スキーマの移行に進む。Workerは既存バインディングを確認した上で切り替わり、ヘルス確認に失敗した場合は直前のバージョンへ戻る。
