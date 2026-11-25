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

第三者の過去のスキャンでも既存GPDのMCP接続とx402の露出が見つかる。これらは観測日と記載バージョンを伴う履歴として扱う。公式掲載の最新状態、実利用者、取引成立と照合済み入金には、それぞれ対応する証拠を使う。 [VerifyMCPのMCP接続記録](https://verifymcp.io/servers/mike05102-anime-intelligence-mcp/anime-intelligence) · [x402 Trustの提供者記録](https://x402-trust.com/provider/anime-intelligence.goodmy0312.workers.dev)

## 確認の順序

1. 外部公開・課金を伴わない範囲で、リリース候補のMCPとOpenAPI、402応答、Bazaarメタデータを検証する。
2. 本番移行条件を満たした後、最新の安定版で公式MCP Registryの一致と認証なしのMCP接続を監査する。既存掲載と一致しない場合、承認済みの公開ワークフローを使う。 [MCP獲得監査](GPD_AGENT_ONBOARDING.md)
3. 次に、402.adの無料フォームとCircleの掲載条件を確認する。承認された外部申請は掲載実績が確認できるまで保留として扱う。Bazaarは、承認済みの実決済が生じたときに同じリソースURLとメソッドを照合する。
4. 掲載・接続から本人確認、引き渡し、決済、照合済み収益へ進んだ事実を個別に記録する。本番・テストと、既存・新規バージョンを区別する。
