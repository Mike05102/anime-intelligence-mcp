# GPDの外部獲得チャネル調査

調査日 2026-11-25。公式資料と公開レジストリを読み取りで確認した。チャネルは、同じ本番URLを外部から発見できるか、GPDを呼び出せるか、取引・入金につながったかの順で評価する。

| チャネル | 入り口・運用条件 | GPDでの検証と現在の証拠 |
|---|---|---|
| **公式MCP Registry** | 既存の名前空間で、本番稼働と合致するStreamable HTTPメタデータを更新する。リポジトリの公開ワークフローは明示承認と本番ビルドの照合を要求する。 | 公開APIで `io.github.Mike05102/anime-intelligence-mcp` の最新が `32.0.0`、`active`、`isLatest: true` と確認した。Remote URLは既存GPD Workerの `/mcp`。次の本番版は掲載バージョンと接続を取得監査で照合する。 [公式掲載API](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Mike05102%2Fanime-intelligence-mcp/versions/latest) · [公式案内](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/) |
| **Coinbase CDP Bazaar / Agentic Market** | 402応答の `extensions.bazaar` に正しいメソッドと再現できる入力例を記載する。公式Seller Toolsは、CDP Facilitatorによる最初のverify・settleを経たエンドポイントが索引対象になると説明している。Solanaも対応ネットワークに含まれる。 | 手数料や売上の確認とは独立に、公衆向けの掲載で正確なURL、メソッド、価格、ネットワークを照合する。掲載のための決済は事前承認が必要。今回、公式索引のGPD最新版の掲載と決済は未検証。 [Seller Toolsの仕様](https://agentic.market/validate/setup/prompt) · [Agentic Marketの掲載確認](https://agentic.market/validate) |
| **Circle Agent Marketplace** | 現行の公式案内は申請フォームによる人手審査。公開OpenAPI、未払い時の402と支払い後の応答、対象エンドポイント、支払先ウォレットの提示が前提。ウォレット審査・継続的な稼働確認がある。 | 掲載承認後は鍵不要のDiscovery APIで正確なリソースURLと採用する支払い条件を確認する。Solana検索には完全なCAIP-2ネットワーク識別子を使う。手数料・規約適合とGPD掲載は未確認。既存のSolana x402に合わせて審査条件を照合し、Gatewayの導入は別途判断する。 [掲載手順](https://developers.circle.com/agent-stack/agent-marketplace/get-listed) · [Discovery API](https://developers.circle.com/agent-stack/agent-marketplace/discovery-api) |
| **402.ad** | サイトのフォーム提出は無料で審査がある。プログラムによる `POST /v1/submit` は **0.10 USDC**。検索と詳細取得は無料。 | 外部公開・申請が承認された場合は無料の提出経路を使い、審査後に検索結果のサービスID、リポジトリ、掲載先URLと説明を照合する。GPD掲載は未確認。 [提出方法と料金](https://402.ad/submit) · [検索・詳細API](https://402.ad/agents) |
| **awesome-x402系のGitHubリスト** | コミュニティによる編集。最新の公開手順とx402開発者向けの技術的価値を示し、重複を検索したうえで一件の変更をPRにする。掲載はメンテナーの審査・マージ後。 | 技術例を共有する補助チャネル。採用を確認するときは、マージされた一覧の行、リンク先、本番の仕様を照合する。調査対象への提出・掲載は未確認。 [xpayshの投稿要件](https://github.com/xpaysh/awesome-x402/blob/main/CONTRIBUTING.md) · [Merit Systemsの一覧と投稿要件](https://github.com/Merit-Systems/awesome-agentic-commerce#contributing) |

| **Google Search** | 所有確認後に Search Console のサイトマップ画面またはAPIを使える。公開 robots.txt にサイトマップを置く場合は登録なしで発見可能。 | リポジトリの Worker は公開案内のサイトマップを提供する。所有確認、クローラーへの提出、検索結果への掲載は今回未確認。 [サイトマップの提出手順](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) · [Search Console API](https://developers.google.com/webmaster-tools/v1/sitemaps/submit) |
| **Smithery** | 公式方針は検証済みサーバーの選抜と直接MCP URLの提示。現在のGPDの登録手続き、無償条件、自動提出は未確認。 | GPDの最新掲載を確認できていない。既存のMCP URLの掲載候補。 [運営の方針](https://www.smithery.ai/future) |
| **Postman API Network** | 公式案内では公開ワークスペースからAPIを共有できる。公開範囲と利用プランを確認し、公開版OpenAPIを使う。 | アカウントでの登録、無料枠の適合、自動提出、GPDの掲載を未確認。 [公式公開案内](https://learning.postman.com/docs/postman-api-network/overview) |
| **Glama** | 公式MCP Registryの公開情報から取り込む経路があり、同経路ではGlamaへの個別提出は不要。デプロイやゲートウェイ利用はここでの掲載確認の対象外。 | GPDの名前空間の公開コネクターページを確認。案内名は旧称の ANIME INTELLIGENCE で、新リリースの掲載・接続状況は未確認。 [公式FAQ](https://glama.ai/mcp/faq) · [GPDの公開コネクター](https://glama.ai/mcp/connectors/io.github.Mike05102/anime-intelligence-mcp) |

第三者の過去のスキャンでも既存GPDのMCP接続とx402の露出が見つかる。これらは観測日と記載バージョンを伴う履歴として扱う。公式掲載の最新状態、実利用者、取引成立と照合済み入金には、それぞれ対応する証拠を使う。 [VerifyMCPのMCP接続記録](https://verifymcp.io/servers/mike05102-anime-intelligence-mcp/anime-intelligence) · [x402 Trustの提供者記録](https://x402-trust.com/provider/anime-intelligence.goodmy0312.workers.dev)

## 公開カタログでのGPD照合

2026-11-25 22:09 UTCまでに、公開検索を認証・決済情報なしで照会した。対象は `anime-intelligence.goodmy0312.workers.dev`、`Global Purchase Decision`、および `mike05102/anime-intelligence-mcp`。照会は8〜12秒の通信タイムアウト、最大128 KiB、リダイレクトなしに制限した。

| 公開検索先 | 対象と実測結果 | 掲載の判定 |
|---|---|---|
| Circle Discovery API | `GET /v2/x402/discovery/resources` で完全なホスト名、次に名称とSolana CAIP-2識別子を検索。いずれもHTTP 403。公開カタログの代替照会もHTTP 403。 [Discovery API](https://developers.circle.com/agent-stack/agent-marketplace/discovery-api) | 今回の接続経路では未確認 |
| 402.ad | 無料の検索 `POST /v1/search` で完全なホスト名とリポジトリを検索。初回はタイムアウト、代替照会では接続時にHTTP 403。 [無料の検索手順](https://402.ad/agents) | 今回の接続経路では未確認 |
| Coinbase Agentic Market | `GET /v1/services/search` で完全なホスト名と名称を検索。いずれもHTTP 403。公開サービスページへの代替照会もHTTP 403。 [公式検索経路](https://agentic.market/SKILL.md) | 今回の接続経路では未確認 |

公開検索の応答を読み取れなかったため、三つのチャネルは掲載の有無を判断できない。実行時の照会は検索だけで、掲載申請や支払いは発生していない。上段の公式MCP Registryの掲載結果と、第三者の履歴をそれぞれ独立した証拠として保持する。

## 確認できた外部掲載

2026-11-25の追加調査で、各ディレクトリ運営者の公開ページを照会した。GPDのホスト名またはGitHubの所有者とリポジトリ名が一致する追加ページは4件。公式MCP Registryを合わせると5チャネルで既存サービスの掲載を確認した。

| ディレクトリ | 照合した識別子と掲載数 | 証拠の範囲 |
|---|---|---|
| VerifyMCP | GPDのホストとStreamable HTTPの `/mcp`。2026-11-25のスキャンで接続可、25ツール・0リソース。 | 運営者が公開した接続観測。最新の統合候補や有料ツールの実行は観測範囲外。 [公開スキャン](https://verifymcp.io/servers/mike05102-anime-intelligence-mcp/anime-intelligence) |
| Glama MCP Connectors | `io.github.Mike05102/anime-intelligence-mcp` とGitHubリポジトリが一致。参照したスナップショットでは24ツール。 | ページに掲載されたヘルス確認日時は2026-11-07。アクセス数や登録数は未確認。 [公開コネクタ](https://glama.ai/mcp/connectors/io.github.Mike05102/anime-intelligence-mcp) |
| PayAPI Market | GPDの完全なホスト名と6エンドポイント。 | 提供者による所有権確認が済んでいない掲載。運営者の記載では決済照合なし。ページ内のSolanaとBaseの表示は食い違うため、支払い条件はGPDの直接応答を正とする。 [公開サービスページ](https://payapi.market/api/global-purchase-decision-api) |
| x402 Trust | GPDの完全なホスト名。掲載中のエンドポイント10件と掲載終了の履歴2件を表示。 | ソースごとの健康状態と価格のスナップショット。同じエンドポイントが別ディレクトリにも載るため、掲載数を合算して運用実績にしない。 [公開提供者プロファイル](https://x402-trust.com/provider/anime-intelligence.goodmy0312.workers.dev) |

掲載件数は発見可能性の証拠。掲載の版、掲載ページが示すツール数・価格、実際の本番仕様は個別に照合する。買い手の登録、販売業者への引き渡し、成立・入金には、各工程の記録を使う。

2026-11-26には **ProtocolProbe** の運営者ページで6件目の掲載を確認した。登録名 `io.github.Mike05102/anime-intelligence-mcp`、Registry版 `32.0.0`、リポジトリ、GPD本番ホストが一致する。同サイトの2026-11-19の読み取り専用MCP接続で、25ツール、0リソース、0プロンプトを観測したと記載されている。ツールの実行や支払いはこの観測に含まれない。 [ProtocolProbeの公開レコード](https://protocolprobe.com/mcp/servers/io.github.Mike05102/anime-intelligence-mcp)

同運営者の無料・認証不要の単一サーバーAPIも、対象レコードだけを8秒、最大128 KiB、リダイレクトなしで読み取り照会した。今回の接続経路ではHTTP 403。このため上記の掲載・履歴は運営者の公開ページによる確認で、JSON応答による照合は未確認。申請・登録の更新・決済は発生していない。 [無料APIの公式説明](https://protocolprobe.com/docs/api) · [対象レコードのAPI](https://protocolprobe.com/api/v1/servers/io.github.Mike05102/anime-intelligence-mcp)

同日の追加確認で、公開記録を運営者自身が掲示する **MCPCheckup** と **MCP Queen** の2件も、リポジトリまたは公式登録名と同一の `/mcp` 接続先で照合した。これで確認した公開掲載先は8チャネル。

- **MCPCheckup** はRegistry版 `32.0.0` 由来の接続先を掲載。認証なしで25ツールを読み取ったとし、公開データの直近30日では計測対象29日中29日に応答あり。カタログ上の所有権は未確認と表示されている。数値は同サイトの観測。 [公開チェック記録](https://mcpcheckup.com/check/mike05102/anime-intelligence-mcp)
- **MCP Queen** は同じ公式登録名と接続先を掲載。公開レコードはRegistry版 `3.10.2`、接続観測は2026-10-31、リポジトリとの対応付けの同期は2026-11-07。過去の運用観測として扱う。 [公開エビデンスページ](https://mcpqueen.com/s/io.github.Mike05102/anime-intelligence-mcp)

**Rooms by Aurmada** の公開ディレクトリで9件目を確認した。旧名称のコミュニティ掲載で、Claude Codeなどの設定例がGPDの正確なStreamable HTTP接続先 `https://anime-intelligence.goodmy0312.workers.dev/mcp` を案内する。2026-11-25確認の稼働表示には25ツール、無料確認を実施した26日間の稼働率100%、Rooms経由の直近30日呼び出しは**0件**と記載されている。0件はRoomsの仲介経路に限る。掲載は所有者未確認と表示され、ページはDNSまたはファイルによる無料の所有者確認を案内している。今回行ったのは運営者の公開レコードの照合。 [Roomsの公開掲載](https://rooms.aurmada.com/agents/anime-intelligence-ai-purchase-intelligence)

**PluginBench** の公開ディレクトリで10件目を確認した。公式登録名の一致と、公開の接続設定が案内する正確なGPD `/mcp` URLを照合した。掲載内容は旧名称のANIME INTELLIGENCEとRegistry版 `3.7.98` で、現行の総合購買判断機能の掲載範囲、プラットフォーム経由の利用・支払いは未確認。 [PluginBenchの公開掲載](https://pluginbench.com/mcp/io.github.Mike05102/anime-intelligence-mcp)

## Bingと参加検索エンジンへの更新通知

2026-11-26調査。IndexNowは、公開URLの追加・更新・削除をBingなどの参加検索エンジンに通知する公開プロトコル。直接通知には、同じホストで専用の所有権確認テキストを外部から取得可能にし、そのホストで変更したURLを送る。正常な応答は通知の受領を示し、検索結果への掲載はBing Webmaster Toolsなどの検査で別途確認する。 [IndexNow仕様](https://www.indexnow.org/documentation?hl=en) · [Bingの設定と確認方法](https://www.bing.com/indexnow/getstarted)

CloudflareのCrawler Hintsは無料プランで提供され、IndexNowに対応する。GPDが使う `workers.dev` のサブドメインで、現行アカウントからその設定を制御できるかは未確認。独自ドメインや有料契約を前提にせず、既存ホストで所有権確認テキストを公開できる場合に、直接通知の適用を確認する。 [Cloudflareの提供条件](https://developers.cloudflare.com/cache/advanced-configuration/crawler-hints/)

隔離Workerでは `robots.txt` と `sitemap.xml` が両方HTTP 200。robotsは同一ホストのサイトマップを参照し、サイトマップの6 URLはすべて同一ホストで、エージェント向け案内 `/agents` を含む。本番の両URLは今回の接続経路でHTTP 403となり、検索掲載とともに未確認。通知・所有権設定は行っていない。通知が承認された場合は、実際に変更された公開案内ページに限定し、管理・認証・取引URLは対象外とする。 [GPDの検索向け公開メタデータ](../releases/GPD33_0_COMPLETE_WORKER.js)

## 買い手向け配布経路の追加調査

2026-11-26に公式資料を確認。GPDの有料購買判断をそのまま提供できるか、無料試用の入口に使えるかを評価した。

| 経路 | 無料条件・適合性 | 提出・自動化 | GPD掲載 |
|---|---|---|---|
| ChatGPT / Codexプラグインディレクトリ | 提出費用は未確認。現行ガイドはデジタルサービスの直接・間接販売と暗号資産送金の実行を認めていない。無料検索のみを独立した機能として審査に出せるかは別途確認。 | 検証済み開発者が提出ポータルからMCPを含むパッケージを申請し、審査後に公開。自動公開経路は未確認。 [提出手順](https://developers.openai.com/plugins/deploy/submission) · [審査基準](https://developers.openai.com/plugins/plugin-guidelines) | 未確認 |
| Microsoft 365 Copilot Agent Store | GPDと既存無料枠で公開できる条件は未確認。 | 公式SDK・Toolkitで開発可能。Agent Storeまたは商用マーケットプレイスに公開する経路。既存のGPD MCPだけで申請する方法と公開自動化は未確認。 [公式案内](https://developer.microsoft.com/en-us/microsoft-365/copilot) | 未確認 |
| Chrome Web Store | 新規公開には一回限りの開発者登録料が必要。ブラウザー拡張機能向け。 | 開発者登録後にダッシュボードで申請。登録済み発行者向けに公開APIあり。 [登録条件](https://developer.chrome.com/docs/webstore/register/) · [公開API](https://developer.chrome.com/docs/webstore) | 未確認 |

Coinbase Bazaarの公式資料を再確認した。カタログAPIはファシリテーターが発見・キャッシュしたリソースを返し、Bazaar MCPの検索と有料呼び出しは別ツール。カタログAPIの例はBearer認証を使う。掲載照合は対象ホスト、URL、HTTPメソッド、ネットワークまで突合する。有料ツールのプロキシ実行は決済に進むため、今回の掲載調査では呼び出していない。GPDの掲載状況は未確認。 [カタログAPI](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/browse-the-catalog) · [Bazaar MCP](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/bazaar-mcp-server)

旧経路も読み取りで再確認した。Circleは申請フォームと手動審査を案内し、掲載料金は資料内で確認できなかった。402.adの提出ページは今回の取得でタイムアウトし、前回の料金記録を維持する。xpayshとMerit Systemsの公開一覧本文に `anime-intelligence` は見つからず、GPDの掲載証拠は得られなかった。 [Circle掲載手順](https://developers.circle.com/agent-stack/agent-marketplace/get-listed) · [402.ad提出ページ](https://402.ad/submit) · [xpaysh一覧](https://github.com/xpaysh/awesome-x402) · [Merit Systems一覧](https://github.com/Merit-Systems/awesome-agentic-commerce)

累計は調査20経路、無償条件確認4件、登録手順実装1件、既存掲載確認9件。追加3経路は無料適格・登録準備・実掲載に算入していない。

## MCP専門ディレクトリの追加調査

| 経路 | 無料条件・提出・自動化 | GPD掲載 |
|---|---|---|
| MCP.so | 現行公開フォームはリポジトリURLまたはリモートURLでの提出を案内。自動即時掲載の表示料金は一回39 USD。フォームからの無料提出経路は確認できなかった。 [公式提出ページ](https://mcp.so/submit) | 正式名称、所有者、接続先を照合できる公開レコードは未確認。 |
| PulseMCP | 2026-09-03更新の公式案内で新規提出・変更とも停止中。再開後は公式MCP Registryを取り込む方針。再開日と再開後の費用条件は未確認。 [公式提出ページ](https://www.pulsemcp.com/submit) | 対象サーバーの公開レコードは未確認。 |

累計は調査22経路、無償条件確認4件、登録手順実装1件、既存掲載確認9件。今回確認した公式資料は提出条件の証拠として記録した。既存掲載の増分は0件。

## 確認の順序

1. 外部公開・課金を伴わない範囲で、リリース候補のMCPとOpenAPI、402応答、Bazaarメタデータを検証する。
2. 本番移行条件を満たした後、最新の安定版で公式MCP Registryの一致と認証なしのMCP接続を監査する。既存掲載と一致しない場合、承認済みの公開ワークフローを使う。 [MCP獲得監査](GPD_AGENT_ONBOARDING.md)
3. 次に、402.adの無料フォームとCircleの掲載条件を確認する。承認された外部申請は掲載実績が確認できるまで保留として扱う。Bazaarは、承認済みの実決済が生じたときに同じリソースURLとメソッドを照合する。
4. 掲載・接続から本人確認、引き渡し、決済、照合済み収益へ進んだ事実を個別に記録する。本番・テストと、既存・新規バージョンを区別する。
