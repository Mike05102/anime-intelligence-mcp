# 世界の商品情報源と利用条件

2026-11-25に提供元の資料を確認した。稼働済みの接続、新規候補、照合にだけ使える資料を区別する。取引に使える商品として数えるには、商品識別に加えて、対象地域の販売業者、在庫、配送、価格と観測日時の根拠が必要。情報源を調査した段階の件数や国数は稼働実績に含めない。

## 取得・保存の判断

| 情報源 | 取得できるものと利用条件 | GPDでの扱い |
|---|---|---|
| USDA FoodData Central | ブランド食品の構造化GTIN/UPC、ブランド、商品版、包装、販売対象国。CC0。USDAは出典表示を求める。API文書の `DEMO_KEY` は1 IPあたり30回/時・50回/日で初期探索向け。 | 既存コードに小分け取得がある。販売先・在庫・配送の根拠は別に必要。大きな公式ファイルを利用する場合は隔離環境で必要列と差分のみ抽出し、本番DBに元ファイルを送らない。 [APIとライセンス](https://fdc.nal.usda.gov/api-guide/) · [フィールド定義](https://fdc.nal.usda.gov/portal-data/external/dataDictionary) · [公式データ](https://fdc.nal.usda.gov/download-datasets/) |
| EPA ENERGY STAR | 小型電子機器、家庭用・業務用機器などの認証モデルをSocrataで公開。家庭用洗濯機のデータセット `bghd-e2wd` はメーカー・モデル・UPCの列を持つ。匿名クエリには混雑時の制限がある。EPAは認証マークの使用について個別に確認を求める。 | 追加候補の優先度が高い。UPCが厳密に特定できる1モデルと、メーカー＋モデルだけで照合する行を区別する。認証画像、販売業者、在庫は取得対象外。 [EPA API案内](https://www.energystar.gov/products/spec/energy_star_api_user_essentials_pd) · [洗濯機のフィールド](https://data.energystar.gov/Active-Specifications/ENERGY-STAR-Certified-Residential-Clothes-Washers/bghd-e2wd/data) · [Socrataの制限](https://dev.socrata.com/docs/app-tokens) |
| EU EPREL | EUのエネルギー表示対象モデル。GTINは任意で付かない場合がある。API利用には申請・宣誓書とキーが必要。付加価値を加えた利用には条件付きで使える。出典表示、訂正・削除の追随、データそのものの再販禁止がある。 | 一部家電・表示機器の追加候補。新規キーや条件への同意を今の無料リリースの前提にしない。既存承認が確認できる場合に小規模検証する。 [APIキー申請](https://eprel.ec.europa.eu/screen/requestpublicapikey) · [公式利用条件](https://ec.europa.eu/assets/move-ener/eprel/EPREL%20Public/Public%20API%20Term%20and%20Conditions/API_TERMS_AND_CONDITIONS_EN.pdf) · [GTIN検索の限界](https://energy-efficient-products.ec.europa.eu/eprel/how-search-product-model-eprel_en) |
| 豪州・NZ Energy Rating、カナダ NRCan | 豪州・NZは登録機器データの公開配布先を案内する。カナダは対象製品の適合モデルを検索できる。機種・電圧・地域の照合候補。 | データセットごとの再利用条件と構造化識別列を確認後に試す。販売や配送の可否は別証拠を参照する。 [AU/NZの登録機器データ](https://www.energyrating.gov.au/about-us/gems-regulator/registered-appliance-and-equipment-data) · [カナダの規制対象一覧](https://natural-resources.canada.ca/energy-efficiency/energy-efficiency-regulations?pedisable=true) |
| Open Food Facts、Open Beauty Facts、Open Pet Food Facts、Open Products Facts | 商品種別付きのバーコード照会。Open Food FactsのDBはODbLで、表示、データ結合、再配布に条件がある。リクエスト元の識別とAPIごとの制限がある。関連DBの条件・精度・国別件数は個別確認が必要。 | 店舗・メーカー由来の同一性証拠とは別に記録する。入力サンプルやAPI選定前に、ODbLの出典・共有条件をGPDの統合DBと公開応答で満たせる構成をレビューする。出典が確認できない画像は取り込まない。 [公式API案内](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) · [関連商品DBの照会](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/scanning-cosmetics-pet-food-and-other-products/) · [APIの利用条件](https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api) |
| 書誌・音楽メタデータ | 国立国会図書館の全国書誌は提供元IDで絞れるSRU・週次更新データがある。NDL自身のメタデータと他機関由来の範囲で条件が異なり、営利利用の事前申請が必要な場合がある。BnFのSRUはISBNを検索でき、書誌ページはフランスの公開ライセンスを案内する。Open Libraryは高頻度の商用バックエンド利用を想定しておらず、公式ダンプを案内する。MusicBrainzのリリースとバーコードはCC0のコアデータに含まれる。商用向けのホストAPI利用は条件・プランが別。 | JP/FRでは版単位の書誌とISBNを優先審査。英語圏・音楽は公式ダンプの対象行だけを評価する。書影、全文、補助データ、同一作品の別版は分ける。 [NDL全国書誌](https://www.ndl.go.jp/data/data_service/jnb) · [NDL提供元別条件](https://ndlsearch.ndl.go.jp/en/help/api/provider) · [NDL商用条件](https://ndlsearch.ndl.go.jp/en/help/api/) · [BnF SRU](https://api.bnf.fr/fr/api-sru-catalogue-general) · [Open Library API](https://openlibrary.org/developers/api) · [Open Libraryの権利](https://openlibrary.org/developers/licensing) · [MusicBrainzデータ範囲](https://musicbrainz.org/doc/MusicBrainz_Database) · [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) |
| FDA/NLM AccessGUDID、openFDA UDI | 医療機器のDI、メーカー由来ラベル情報。AccessGUDIDには特定DIを照会するAPIと更新ファイルがある。openFDAは特記がなければCC0だが、GMDNコンテンツの商用転用には別の条件がある。 | 製品識別補助として、DIの発行規格を確認して保管する。医療機器全体でDIをGTIN扱いせず、分類、規制適合、用途適合、販売可否の推定に使わない。GMDNデータは対象外。 [AccessGUDID API](https://accessgudid.nlm.nih.gov/resources/developers/v3/device_lookup_api) · [更新データ](https://accessgudid.nlm.nih.gov/help/download) · [openFDAライセンス](https://open.fda.gov/license/) |
| eBay Browse、Yahoo!ショッピング、楽天市場 | eBayの複数市場でGTIN・カテゴリ・商品詳細を照会できる。Buy APIはアプリ承認と規約に従う。eBayの公開表示条件には出品情報6時間、その他24時間の鮮度上限と、一定の派生統計に事前書面許可の条件がある。Yahoo!はショッピング用Client IDが必要。楽天の商品検索はAPIのバージョンと認証に依存する。 | 既存の認証・契約範囲で販売条件の観測に使う。eBayの観測を長期のカタログ情報や集計に流用する用途と既存TTLは契約条件と照合する。利用権を取得、保存、表示、再配布に分けて確認する。障害時はクールダウンし、制限を迂回しない。 [eBay Browse](https://developer.ebay.com/api-docs/buy/static/api-browse.html) · [対象市場](https://developer.ebay.com/api-docs/buy/ref-marketplace-supported.html) · [本番要件](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html) · [API規約](https://developer.ebay.com/support/api-license-agreement) · [Yahoo!公式検索](https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html) · [楽天公式検索](https://webservice.rakuten.co.jp/documentation/ichiba-item-search) |
| Mercado Libre、Lazada、Amazon | Mercado Libreの検索例はアクセストークンを使用。API規約には用途・コンテンツの制約がある。Lazadaの販売業者データは各販売業者の承認が必要。Amazon Creators APIはアソシエイト登録、資格、認証に依存する。 | 地域ごとの接続候補。新規アカウント、契約、キー、料金を前提に稼働扱いしない。既存の承認済み販売業者が権利を持つ独自フィードを提供する経路を優先する。 [Mercado Libre API](https://developers.mercadolibre.com.ar/en_us/items-and-searches) · [規約](https://developers.mercadolivre.com.br/pt_br/termos-e-condicoes) · [Lazadaの販売業者承認](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777) · [Amazonの資格](https://affiliate.amazon.co.jp/creatorsapi/docs/en-us/introduction) |
| 承認済み販売業者・メーカーの直提供フィード | 商品の識別子とバリエーション、取引可能国、通貨、在庫、配送、観測時刻を、提供元が承認した範囲で取得できる。Shopifyの店舗API・Google Merchant APIは権限範囲とアカウント承認が必要。 | 全カテゴリーの販売条件と直接取り引きを結びつける主要候補。まず署名付き参加意思、承認済みHTTPS、読み取り範囲、期限を確認する。Googleの商品フィードの属性定義は形式整備に使える。 [GPDの承認・登録](GPD_MERCHANT_OFFER_FEED.md) · [Shopifyのスコープ](https://shopify.dev/docs/api/admin-graphql/latest/objects/productvariant) · [Googleの第三者承認](https://developers.google.com/merchant/api/guides/authorization/access-client-accounts) |
| GS1 Verified by GS1、GDSN、GS1 Japan | 公開Verified by GS1の結果は内部利用向け。公開・再配布には制約がある。GDSNは認定データプール経由。GS1 Japanは国内商品DBサービスを案内する。 | 一般商品DBへの自動転載経路に採用しない。利用可能な範囲で、提供元が指定した条件の下で照合の参考にする。 [GS1公開照会規約](https://www.gs1.org/docs/verified-by-gs1/public-verified-by-gs1-tou.pdf) · [認定データプール](https://support.gs1.org/support/solutions/articles/43000734213-what-is-a-data-pool-and-where-can-i-find-a-list-of-gdsn-certified-data-pools-) · [GS1 Japan](https://www.gs1jp.org/database_service/) |
| 公共のリコール・機種学習用資料 | 米国CPSCが機械可読なリコールAPIを公開。日本の消費者庁、英国OPSSも公開警告を提供。米国NHTSA vPICは車両・メーカーの情報を取得できる。北米のACES/PIESを支える一部DBは有料。 | リコール照合・競合確認・メーカー探索に用途を限定する。車両登録と当該部品の適合、リコール未掲載と製品安全性、警告情報と販売在庫を同一視しない。 [CPSC API](https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information) · [日本の消費者安全情報](https://www.caa.go.jp/en/policy/consumer_safety/) · [英国OPSS](https://www.gov.uk/product-safety-alerts-reports-recalls) · [vPIC](https://vpic.nhtsa.dot.gov/about/) · [ACES/PIES条件](https://www.autocare.org/data-standards) |

## 24カテゴリーへの適用

市場検索は地域・契約内に限定して横断的に使う。下表は、表示された市場商品と切り分けて確認する主な根拠および不足を示す。メーカー・認定販売業者の提供フィードは、すべてのカテゴリーで商品・販売条件を埋める候補。

| GPDカテゴリー | 先行できる商品識別の根拠 | 調達判断に残る確認 |
|---|---|---|
| `consumer_electronics` | US ENERGY STARのモニター・計算機など、EU EPRELの対象表示機器、メーカーのGTIN・型番 | 容量、同梱、仕向け国、保証と電源 |
| `automotive_parts` | メーカー＋MPN/OE、販売元の技術カタログ。vPICは車両やメーカー候補 | VINや年式だけで互換判定をせず、車種・駆動・適合表を照合 |
| `home_appliances` | US ENERGY STAR、EU EPREL、AU/NZ・CAの認証モデル。構造化UPCがある機種は厳密照合 | 電圧、容量、設置、現地保証と配送 |
| `fashion` | 販売業者提供のバリエーション単位GTIN、ブランドSKU | サイズ体系、色・素材・真贋、返品条件 |
| `books_media` | JP全国書誌、FR BnF、英語書誌候補、MusicBrainz物理メディア | ISBN/バーコードが指す版、言語・仕様・物理媒体、販売在庫 |
| `toys_hobbies` | メーカー・卸のGTIN、世代と同梱品、リコールの補助照合 | 対象年齢、安全基準、限定版。専門アニメ件数と分離 |
| `beauty_personal_care` | Open Beauty Factsの識別補助、ブランド・卸のGTIN | 適用する販売国、容量・成分表示、セット、真贋 |
| `sports_outdoors` | メーカーのGTIN・型番とサイズ | サイズ・仕様、認証が必要な用品、地域別返品 |
| `home_living` | メーカー品番、GTIN。一部水回り製品はUS WaterSenseのモデル一覧 | 材質、寸法、設置、配送。 [EPA WaterSense](https://lookforwatersense.epa.gov/index.html) |
| `office_business` | メーカー・事務用品卸のGTIN、型番。一部機器はENERGY STAR | 個数・セット、納期、消耗品の適合 |
| `medical_supplies` | AccessGUDIDのDIと発行規格、メーカー・正規流通の資料 | 地域規制・販売資格・用途・トレーサビリティ。症状や医療判断に使用しない |
| `food_grocery` | USDA Branded、Open Food Facts候補 | 包装量、販売対象国、賞味期限・温度管理、追加の販売条件 |
| `baby_kids` | メーカー・卸のGTIN、US/JP/UKのリコール資料 | 年齢、使用規格、商品版・バッチ、対象年齢の安全条件 |
| `pet_supplies` | Open Pet Food Facts候補はペットフードのみ。その他はメーカー・卸 | 対象動物、包装量、販売地域。治療効果を推定しない |
| `tools_hardware` | メーカー型番とGTIN、業務卸。水回りはWaterSense対象のみ | 電源・駆動、キット内容、適合、配送 |
| `garden_outdoor` | メーカー・ガーデン卸の型番、GTIN | 寸法・電圧・用途、対象国での販売・配送可否 |
| `musical_instruments` | メーカー型番・GTIN、楽器店の明示型式 | 楽器・アクセサリの世代と仕向け品。MusicBrainzは録音商品の根拠 |
| `jewelry_watches` | ブランドの正規リファレンス、認定販売業者 | 材質、真贋、外装・個体条件、地域保証 |
| `arts_crafts` | メーカー・専門卸のGTINとバリエーション | 色・規格・セット、地域の取扱制限 |
| `industrial_supplies` | メーカー・工業卸の厳密な型式またはGTIN | 規格、改訂、販売業者・納期。産業部品の専門データと重複集計しない |
| `scientific_lab` | 計測器メーカーと認定販売業者のGTIN・型式 | 校正、規格、附属品、研究安全要件と地域制限 |
| `restaurant_hospitality` | 業務用機器のENERGY STAR対象モデル、厨房機器のメーカー・業務卸 | 容量、電圧、設置、地域基準、現地保守 |
| `safety_security` | メーカーの適合証拠と機種の厳密照合、UL等の個別確認、公共リコール | 認証範囲を地域・版ごとに確認。公開検索の無断自動収集は対象外。 [ULの認証情報案内](https://www.ul.com/software/product-sourcing-and-certifications-database) |
| `general_commerce` | 商品分類が確定していない直提供フィードの検証済みGTIN | 分類が判明したら正しいカテゴリーに計上。市場の商品名だけで分類しない |

## 地域ごとの初期接続

- **日本**は既存条件下のYahoo!・楽天で販売条件を探索し、書籍は全国書誌、その他は日本向けJANとメーカー・販売業者の提供データを優先する。日本のJANが海外の同梱・電圧を保証するとは扱わない。 [Yahoo!](https://developer.yahoo.co.jp/webapi/shopping/) · [楽天](https://webservice.rakuten.co.jp/documentation/ichiba-item-search) · [全国書誌](https://www.ndl.go.jp/data/data_service/jnb)
- **米国・カナダ**はUSDA、EPA、FDA/NLMの対象商品と、承認済みeBay市場・提供元フィードを組み合わせる。カナダ向けの適合モデル、通貨、配送は個別に判定する。 [USDA](https://fdc.nal.usda.gov/api-guide/) · [EPA](https://www.energystar.gov/products/productstr) · [FDA/NLM](https://accessgudid.nlm.nih.gov/) · [カナダNRCan](https://natural-resources.canada.ca/energy-efficiency/energy-efficiency-regulations?pedisable=true)
- **欧州・英国**はEU EPRELの条件付き機種データとBnF書誌を候補にし、DE・FR・UKなどの販売条件は市場ごとに観測する。EU・英国で送料、税、規制、返品の情報を別に保持する。 [EPREL](https://energy-efficient-products.ec.europa.eu/faqs-0/what-eprel_en) · [BnF](https://api.bnf.fr/fr/api-sru-catalogue-general) · [eBay市場表](https://developer.ebay.com/api-docs/buy/ref-marketplace-supported.html)
- **豪州・NZ**はEnergy Ratingのモデル照合と提供元フィードを起点にする。豪州市場の出品からNZ向け配送を推定しない。 [豪州・NZ登録DB](https://www.energyrating.gov.au/program-tools/energy-rating-registration-database)
- **東南アジア・中南米**は国別フィードを優先する。LazadaとMercado Libreは承認範囲の確認後の候補。例えばSG・TH・ID、MX・BR・ARは別の仕向け市場として評価する。 [Lazadaの認証](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777) · [Mercado Libreの国別サイト](https://developers.mercadolibre.com.ar/es_ar/que-es-mensajeria/dominios-y-categorias)
- **その他の地域**は契約と配送実績が確認できる提供元を個別に登録する。今回の調査から中国、インド、中東、アフリカ全域を一括して賄える承認済み無料ソースは確認できていない。

## 隔離環境で検証する順序

1. **既存経路**では、現在のUSDA取得上限とクールダウン、Yahoo!・eBayの応答制限、観測時刻の期限を再現する。eBayの公表規約と既存許可の範囲を確認し、出品・派生統計・保存期間の上限を実装で対応させる。
2. **追加候補**では、ENERGY STARのUPC列がある単一データセットを最初に小分け検証する。単品と複数UPC、異容量・同型番、廃止・訂正、商品ID不明、非US仕向けをテストする。次に出典・提供元を限定した全国書誌、BnFのISBNと版の照合を検証する。
3. **販売条件**は、署名付きGPD参加意思と取得権を確認したHTTPSフィードを商品識別と突き合わせる。閲覧・保存・公開の権利が異なる場合は別管理し、原文の長期保存を避ける。価格・通貨・在庫・配送が欠ける商品は該当条件を未確認とする。 [販売業者探索と同意](GPD_SELLER_DISCOVERY.md) · [承認済みフィード](GPD_MERCHANT_OFFER_FEED.md)
4. **導入判定**では、カテゴリー・仕向け国ごとに、構造化識別の合格率、重複を除いた新規数、実際に購入先へ進める商品の比率、失効・取消の反映、取得回数とバイト数を記録する。既存のCPU・転送・DB容量予算の範囲で結果を観測する。本番登録は未実施。公開サンプルではEPAの5行とvPICの100行を確認した。 [実測と再開記録](GPD_CONTINUITY.md)

## フランス BnF の公開照会

2026-11-25 UTC、公式SRUで ISBN `9782070612758` の完全一致検索を認証なしで実施した。最大2件・64 KiBの取得枠で、UNIMARCの書誌1件と構造化ISBN欄（010）1件を確認した。フランス語圏の版同定の候補。商品価格、販売可否、配送は含まれず、隔離用の `python3 scripts/gpd33_bnf_edition.py <ISBN> <SRU応答.xml>` は単一の版と検査済みISBNが一致する場合に書誌証拠を返す。カタログへの適用は未実施。 [BnF公式SRU仕様](https://api.bnf.fr/fr/api-sru-catalogue-general)

## ENERGY STAR 先頭ページの実測

2026-11-25 UTCに、家庭用洗濯機を `pd_id` 昇順で最大40件取得した。選択した列だけの応答は9,611バイト。40行のうち38行は型式などが曖昧、2行はUPC要件を満たさず、このページでは識別合格が0件だった。前回の別の5件サンプルでは1件合格しているため、先頭ページの値を全データの合格率には使わない。同一UPCに別の認証モデルIDや登録市場がある場合も、行順に左右されないよう候補を隔離する。 [EPAの公式データ](https://data.energystar.gov/Active-Specifications/ENERGY-STAR-Certified-Residential-Clothes-Washers/bghd-e2wd/data)

### BnFの追加サンプルと書誌項目の区別

2026-11-25 UTCに、公式の例に使われている ISBN `9782413088882` で同じ上限の認証なしGETを1回実行した。HTTP 200、XML 7,187バイト、結果1件。ARK `cb486046398` の書誌では `010$a` のISBNと `073$a` のEANが一致し、フランス語の印刷版と確認できた。`010$d` に `22 EUR` があるが、現在の販売価格、在庫、配送には計上しない。`214$c` は出版社と印刷会社で別々に現れる。隔離用アダプターはBnFの定義どおり `214` の第2指示子 `0` を出版、`3` を製造として扱い、取得済みの応答から出版社を特定した。 `python3 scripts/gpd33_bnf_edition.py <ISBN> --read` は公式ホストへの公開GETを1回実行する。 [UNIMARC仕様](https://www.bnf.fr/sites/default/files/2023-10/UNIMARC_B.pdf) [照会した書誌](https://catalogue.bnf.fr/ark:/12148/cb486046398) · [BnFのISBNフィールド定義](https://api.bnf.fr/fr/node/2688)

BnFが作成する書誌メタデータの Etalab 2.0 は、出典と最終更新時点を明示した商用再利用を許す。照会時刻や出版年と最終更新日は分けて保存する。書影、スキャン、第三者提供コンテンツは、付随する個別条件に従う。 [BnF利用条件](https://api.bnf.fr/fr/conditions-generales-dutilisation-du-site-bnf-api-et-jeux-de-donnees) · [Etalab 2.0](https://www.data.gouv.fr/pages/legal/licences/etalab-2-0)

## 豪州・NZ GEMSの公開データ確認

豪州の気候変動・エネルギー・環境・水省は、家庭用洗濯機、乾燥機、食洗機、冷蔵庫、テレビ、モニターなどの登録機器データを案内する。公開目録では、ブランド、型式、原産国・販売対象国、出力や効率が機器別に記載され、当該データセットの権利欄は CC BY 3.0 Australia。政府サイトの一般条件は CC BY 4.0 で、データごとの表記を優先する。国のロゴやEnergy Rating Label・Iconは一般の再利用条件の対象外。登録範囲や入手可否の欄を、個別販売業者の現在在庫や両国への配送保証に置き換えない。 [GEMSの公式配布案内](https://www.energyrating.gov.au/about-us/gems-regulator/registered-appliance-and-equipment-data) · [登録DBの範囲](https://www.energyrating.gov.au/program-tools/energy-rating-registration-database) · [公開目録のデータセットとライセンス](https://researchdata.edu.au/energy-rating-data-labelled-products/3784840) · [政府サイトの著作権条件](https://www.energyrating.gov.au/copyright)

2026-11-26 UTCに、公式配布元 data.gov.au の `package_show` で `energy-rating-for-household-appliances` の目録メタデータを上限64 KiB・12秒で1回照会した。現在の実行環境ではHTTP 403、HTML 919バイトで、機械可読な目録や商品行は得られなかった。自動取得経路は未確認。公式のCSVを利用可能な経路で取得できた段階で、個別リソースのライセンス、厳密なブランド＋型式、GTIN列の有無、登録の取消と有効期間を小さな隔離サンプルで確認する。 [公式データセット](https://data.gov.au/data/dataset/energy-rating-for-household-appliances)

## 日本の全国書誌の実接続確認

2026-11-26 UTC、NDLサーチの公式SRUに `dpid="iss-ndl-opac-national" AND isbn="9784101010014"` を最大2件、64 KiB、12秒の上限で照会した。HTTP 429のため書誌は取得できず、再試行は行っていない。全国書誌の提供元IDと他機関のメタデータを混同しないよう条件を固定した。定期利用と商品DBへの取込は、提供元ごとの利用条件・取得頻度と識別項目が確認できた場合に限る。 [全国書誌の公式API案内](https://www.ndl.go.jp/data/data_service/jnb) · [提供元ごとの利用条件](https://ndlsearch.ndl.go.jp/en/help/api/provider)

## 電子部品と書籍の追加候補

| 地域・カテゴリー | 候補と取得方法 | 適格性・接続状態 |
|---|---|---|
| 米国事業者・電子部品 | DigiKey Product Information API。公式の標準枠は毎分120、日次1,000リクエスト。 [API製品](https://developer.digikey.com/product-details/product-information) · [枠の公式説明](https://developer.digikey.com/documentation) | 枠の記載だけでは料金、保存・再配布権、販売業者の同意を確認できない。未接続。 |
| 国・地域別の可用性確認が必要・書籍 | Google Books API。Volumesの検索に `isbn:` を指定できる。公式手順にはプロジェクトと認証情報が必要な取得方法がある。 [取得手順](https://developers.google.com/books/docs/v1/using) · [利用規約](https://developers.google.com/books/terms) | 利用枠と商用カタログでの保持・再配布条件の確認が必要。商品識別候補であり、在庫と購入可能性は別途証拠が必要。未接続。 |

追加2件はAPI候補で、無償適格情報源・本番接続には算入していない。新規キー発行、外部登録、取得実行は行っていない。

## 販売業者のEC基盤と北米小売の追加確認

2026-11-26 UTC、販売業者の許諾を得て商品・在庫を取り込める基盤を2件、API契約が前提の小売候補を1件確認した。新規キー発行、販売業者の登録、第三者の実店舗データ取得は行っていない。

| 情報源 | 公式仕様で確認した販売条件 | GPDでの採用条件 |
|---|---|---|
| WooCommerce Store API | 公開商品の取得は認証不要。商品URL、SKU、`global_unique_id`、価格・通貨の最小単位、購入可否・在庫状態の欄を持つ。 | 接続許諾を得た店舗の対象商品だけを、既存の承認済みフィード経路で取得する。SKUは店舗内キー。構造化IDが空ならGTIN証拠なし。対象国への配送は商品ごとに別途確認する。 [Store API](https://developer.woocommerce.com/docs/apis/store-api/) · [商品API](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products) · [識別子の定義](https://developer.woocommerce.com/docs/apis/rest-api/v3/products) |
| PrestaShop 9 Webservice | 商品にEAN-13・UPC・ISBN・MPNなどの欄がある。販売可能数量は商品・組合せ・店舗単位の `stock_availables` で扱う。 | 稼働店舗の運用者が読取対象を承認した場合に接続する。親商品と組合せの識別を分け、通貨・税込価格・仕向け国については販売業者の確認を得る。 [商品属性](https://devdocs.prestashop-project.org/9/webservice/resources/products/) · [在庫属性](https://devdocs.prestashop-project.org/9/webservice/resources/stock_availables/) · [アクセス権限](https://devdocs.prestashop-project.org/9/webservice/tutorials/creating-access/) |
| Best Buy Products API | 米国小売事業者が価格・可用性・仕様を含む過去と現在の製品情報を案内。現行キーが必要で、契約は原則72時間を超えるコンテンツキャッシュおよび無許可の第三者アクセスを制限する。 | GPDの永続カタログや第三者向け再提供の経路として数えない。契約と権限が適合する場合のみ、販売条件の短期表示候補。過去の商品も含むため、API上の商品数を販売中件数に変換しない。 [公式Products API](https://developer.bestbuy.com/apis) · [API利用条件](https://developer.bestbuy.com/legal) |

取得が許されている公式WooCommerce文書の `GET /products/:id` 応答例1件を確認した。SKU、GBP価格、`is_purchasable`、`is_in_stock` を含むが、`global_unique_id` は空欄。これは公式の形式例であり、実店舗の在庫、実取引対応、カタログ登録件数の証拠から外す。今回確認した実店舗の商品行は0件、本番接続は0件。 [公式の単一商品応答例](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products#single-product-by-id)

## 台湾の電鍋モデル登録データ

台湾経済部能源署のデータセット145129は、電鍋の登録会社名、型番、熱効率、等級、承認日を公開する。公開ページ記載の利用料は無料で、Open Government Data License v1.0の出典表示が必要。2026-11-26 UTCに公式CSVリンクから取得したUTF-8 BOM付き74,838バイトを検証した。1,174行、重複なしの登録会社名・型番1,174組、登録会社名109件。SHA-256は `c2a6b2957f889ab7eb3c16e35e67c6ff8cb63e850aa3d6b96442e595d373e1d7`。 [公式データセットとCSV](https://data.gov.tw/en/datasets/145129) · [利用条件](https://data.gov.tw/en/license)

`python3 scripts/gpd33_tw_cooker_audit.py <公式CSVの保存先>` で上限256 KiBの読み取り専用プレビューを再現できる。台湾向け家電の型番照合候補として、公開サンプル確認済み情報源に1件追加する。GTIN、販売者、価格、在庫、配送の列はない。登録会社名は既存200社と名寄せしておらず、販売業者候補や購入可能商品の件数には加算しない。
