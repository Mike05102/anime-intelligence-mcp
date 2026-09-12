// @ts-nocheck
const VERSION="3.6.5";

const YAHOO_ENDPOINT="https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";
const EBAY_TOKEN_ENDPOINT="https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_SEARCH_ENDPOINT="https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_ITEM_ENDPOINT="https://api.ebay.com/buy/browse/v1/item";
const EBAY_MARKETPLACE="EBAY_US";
const ECB_FX_ENDPOINT="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const DEFAULT_X402_FACILITATOR="https://api.cdp.coinbase.com/platform/v2/x402";
const INDEX402_API="https://402index.io/api/v1";
const SOLANA_MAINNET="solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_USDC="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ATELIER_API="https://api.useatelier.ai";
const ATELIER_POLL_EVERY_MINUTES=2;
const ATELIER_MAX_ORDERS_PER_POLL=3;

const PRICES={
  identify:"5000",
  market:"10000",
  rarity:"10000",
  authenticity:"20000",
  buyWait:"20000",
  bestPlace:"30000",
  full:"50000"
};

const ROTATION=["mass","official","yahoo","ebay","mass","backfill","yahoo","ebay"];

const PIPELINE={
  massSeedsCron:20,
  massSeedsStandalone:40,
  officialDetailCron:4,
  officialDetailStandalone:12,
  backfillCron:2,
  backfillStandalone:4,
  yahooCron:2,
  yahooStandalone:3,
  ebayCron:1,
  ebayStandalone:1,
  productPageSize:500,
  productMaxPages:100,
  marketFreshDays:30,
  backfillRetryHours:18,
  marketRetryHours:6,
  marketAutoRefreshHours:24,
  qualityRepairStandalone:40,
  massInspectMultiplier:2,
  selfDiscoveryEnabled:true,
  selfDiscoveryYahooHits:20,
  kpiEventReadLimit:5000,
  archiveSeedsStandalone:40,
  archiveSeedsCron:30,
  officialMassFeedCron:30,
  catalogQueriesTarget:"dynamic_1000_plus",
  selfDiscoveryNoJanEnabled:true
};

const EBAY_DETAIL_LIMIT_PER_PRODUCT=2;

const OFFICIAL_CONNECTORS=[
  {
    slug:"goodsmile",
    name:"Good Smile Company",
    manufacturer:"Good Smile Company",
    listUrls:[
      "https://www.goodsmile.com/ja/releaseinfo",
      "https://www.goodsmile.com/en/releaseinfo"
    ],
    detailRegex:/https?:\/\/(?:www\.)?goodsmile\.com\/(?:ja|en)\/product\/\d+/i
  },
  {
    slug:"tamashii",
    name:"TAMASHII NATIONS / BANDAI SPIRITS",
    manufacturer:"BANDAI SPIRITS",
    listUrls:["https://tamashiiweb.com/item/"],
    detailRegex:/https?:\/\/tamashiiweb\.com\/item\/\d+/i
  },
  {
    slug:"kotobukiya",
    name:"Kotobukiya",
    manufacturer:"Kotobukiya",
    listUrls:["https://www.kotobukiya.co.jp/product/"],
    detailRegex:/https?:\/\/(?:www\.)?kotobukiya\.co\.jp\/product\/detail\/p\d+/i
  },
  {
    slug:"alter",
    name:"ALTER",
    manufacturer:"ALTER",
    listUrls:["https://alter-web.jp/products/"],
    detailRegex:/https?:\/\/alter-web\.jp\/products\/\d+/i
  },
  {
    slug:"megahouse",
    name:"MegaHouse",
    manufacturer:"MegaHouse",
    listUrls:["https://www.megahobby.jp/products/"],
    detailRegex:/https?:\/\/(?:www\.)?megahobby\.jp\/products\/item\/\d+/i
  },
  {
    slug:"kdcolle",
    name:"KDcolle / KADOKAWA",
    manufacturer:"KADOKAWA",
    listUrls:["https://kdcolle.kadokawa.co.jp/product/"],
    detailRegex:/https?:\/\/kdcolle\.kadokawa\.co\.jp\/product\/(?!20(?:1[0-9]|2[0-9])(?:\/|$))[^?#]+/i
  }
];

// High-volume official catalog feeds. These complement detail-page connectors above.
// Failures are isolated; a feed can change without stopping Yahoo catalog growth or paid APIs.
const OFFICIAL_MASS_FEEDS=[
  {slug:"sega-prize",manufacturer:"SEGA FAVE",listUrl:"https://www.sega.jp/prize/",detailRegex:/https?:\/\/segaplaza\.jp\/prize\/[A-Za-z0-9_-]+\/?/i},
  {slug:"bushiroad-creative",manufacturer:"Bushiroad Creative",listUrl:"https://bushiroad-creative.com/products/",detailRegex:/https?:\/\/(?:www\.)?bushiroad-creative\.com\/(?!products\/?(?:\?|$))[^?#]+/i},
  {slug:"taito-prize",manufacturer:"TAITO",listUrl:"https://www.taito.co.jp/taito-prize",detailRegex:/https?:\/\/(?:www\.)?taito\.co\.jp\/(?:taito-prize|prize)\/[^?#]+/i}
];

/* =========================================================
   UTILITIES
========================================================= */

function safeError(e){
  return String(e?.message||e||"unknown_error").slice(0,2000);
}

function corsHeaders(extra={}){
  return {
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"GET,POST,OPTIONS",
    "access-control-allow-headers":"content-type,x-refresh-key,payment-signature",
    ...extra
  };
}

function b64(value){
  const bytes=new TextEncoder().encode(String(value));
  let bin="";
  for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function unb64(value){
  const bin=atob(String(value));
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function json(data,status=200,extra={}){
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:corsHeaders({"content-type":"application/json; charset=utf-8",...extra})
  });
}

function text(data,status=200,extra={}){
  return new Response(String(data),{
    status,
    headers:corsHeaders({"content-type":"text/plain; charset=utf-8",...extra})
  });
}

function htmlResponse(data,status=200,extra={}){
  return new Response(String(data),{
    status,
    headers:corsHeaders({"content-type":"text/html; charset=utf-8",...extra})
  });
}

function decodeHtml(v=""){
  return String(v)
    .replace(/&amp;/g,"&")
    .replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'")
    .replace(/&lt;/g,"<")
    .replace(/&gt;/g,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}

function stripHtml(v=""){
  return decodeHtml(String(v).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
}

function cleanOfficialTitle(v=""){
  return stripHtml(v)
    .replace(/\s*[|\uff5c]\s*(GOOD SMILE COMPANY|\u30b0\u30c3\u30c9\u30b9\u30de\u30a4\u30eb\u30ab\u30f3\u30d1\u30cb\u30fc).*$/i,"")
    .replace(/\s+/g," ")
    .trim();
}

function normalize(v=""){
  return String(v)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g,"-")
    .replace(/[\u201c\u201d\u201e\u201f]/g,'"')
    .replace(/[\u2019\u2018]/g,"'")
    .replace(/[\u30fb\uff0f/_,:;|\uff5c\u3010\u3011\u300c\u300d\u300e\u300f\uff08\uff09()[\]{}<>]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function tokens(v=""){
  return normalize(v).split(/\s+/).filter(Boolean);
}

function clamp(n,min=0,max=100){
  return Math.min(max,Math.max(min,Number(n)||0));
}

function median(values=[]){
  const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!xs.length)return null;
  const m=Math.floor(xs.length/2);
  return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
}

function daysSince(v){
  const t=Date.parse(v||"");
  return Number.isFinite(t)?Math.max(0,(Date.now()-t)/86400000):0;
}

function hoursSince(v){
  const t=Date.parse(v||"");
  return Number.isFinite(t)?Math.max(0,(Date.now()-t)/3600000):Infinity;
}

function cleanJan(v=""){
  const s=String(v||"").replace(/\D/g,"");
  return /^\d{13}$/.test(s)?s:null;
}

function isoDate(v=""){
  const s=String(v||"").trim();
  const m=s.match(/(20\d{2})[\u5e74\/.\-](\d{1,2})[\u6708\/.\-](\d{1,2})/);
  if(!m)return null;
  return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
}

function normalizeStage(stage=""){
  const s=String(stage).toLowerCase().trim();
  return ["mass","official","backfill","yahoo","ebay","metrics"].includes(s)?s:null;
}

function deterministicWindow(items=[],count=1,timeMs=Date.now(),salt=0){
  if(!items.length)return [];
  const start=(Math.floor(Number(timeMs)/3600000)+salt)%items.length;
  return Array.from({length:Math.min(count,items.length)},(_,i)=>items[(start+i)%items.length]);
}

function labelSimilarityScore(a="",b=""){
  const A=[...new Set(tokens(a))];
  const B=[...new Set(tokens(b))];
  if(!A.length||!B.length)return 0;
  const match=A.filter(x=>B.some(y=>y===x||y.includes(x)||x.includes(y))).length;
  const union=new Set([...A,...B]).size;
  return Math.round(clamp((match/Math.max(A.length,1))*70+(match/Math.max(union,1))*30));
}

function sourceEvidence(source,observedAt=new Date().toISOString(),extra={}){
  return {source,observed_at:observedAt,...extra};
}

function latestObservationMap(rows=[]){
  const m=new Map();
  for(const o of rows){
    const k=o.external_listing_id||`${o.source_id}:${o.listing_url||o.id}`;
    const prev=m.get(k);
    if(!prev||Date.parse(o.observed_at||"")>Date.parse(prev.observed_at||""))m.set(k,o);
  }
  return m;
}

/* =========================================================
   LANGUAGE
========================================================= */

const LANGS=["ja","en","zh","ko","es","fr","de","it","pt","id","th","ru","ar","hi","vi","tr","nl","pl"];

function detectLanguage(query="",explicit="",accept=""){
  const e=String(explicit||"").toLowerCase().slice(0,2);
  if(LANGS.includes(e))return e;
  const a=String(accept||"").toLowerCase();
  const found=LANGS.find(x=>a.startsWith(x)||a.includes(`,${x}`)||a.includes(`;${x}`));
  if(found)return found;
  const q=String(query||"");
  if(/[\uac00-\ud7af]/.test(q))return "ko";
  if(/[\u3041-\u3093\u30a1-\u30f6]/.test(q))return "ja";
  if(/[\u0e00-\u0e7f]/.test(q))return "th";
  if(/[\u0600-\u06ff]/.test(q))return "ar";
  if(/[\u0900-\u097f]/.test(q))return "hi";
  if(/[\u0400-\u04ff]/.test(q))return "ru";
  if(/[\u4e00-\u9fff\u3400-\u4dbf]/.test(q))return "zh";
  return "en";
}

function foldLatinForSearch(v=""){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
}

function detectSearchLanguage(query="",explicit="",accept=""){
  const e=String(explicit||"").toLowerCase().slice(0,2);
  if(LANGS.includes(e))return e;
  const q=String(query||"");
  if(/[\uac00-\ud7af]/.test(q))return "ko";
  if(/[\u3041-\u3093\u30a1-\u30f6]/.test(q))return "ja";
  if(/[\u0e00-\u0e7f]/.test(q))return "th";
  if(/[\u0600-\u06ff]/.test(q))return "ar";
  if(/[\u0900-\u097f]/.test(q))return "hi";
  if(/[\u0400-\u04ff]/.test(q))return "ru";
  if(/[\u4e00-\u9fff\u3400-\u4dbf]/.test(q))return "zh";
  const n=foldLatinForSearch(q);
  const lexical=[
    ["fr",/(?:\bfigurines?\b|\bproduits?\b|\bobjets?\b|\bacheter\b|\btrouver\b|\bdoudou\b|\bcollectionner\b|\bcollectionnable\b)/],
    ["es",/(?:\bfiguras?\b|\bproductos?\b|\bcomprar\b|\bmunecos?\b|\bjuguetes?\b)/],
    ["de",/(?:\bfiguren?\b|\bplusch(?:tier|e|en)?\b|\bartikel\b|\bkaufen\b|\bsammel)/],
    ["it",/(?:\bprodotti?\b|\bcomprare\b|\bmorbido\b|\bpupazzo\b|\bgiocattolo\b)/],
    ["pt",/(?:\bprodutos?\b|\bpelucia\b|\bcomprar\b|\bboneco\b)/],
    ["id",/(?:\bboneka\b|\bbarang\b|\bmerch anime indonesia\b)/],
    ["vi",/(?:\bdo choi\b|\bmo hinh\b|\bgau bong\b|\bthu bong\b)/],
    ["tr",/(?:\burunleri\b|\bfiguru\b|\bpelus\b|\boyuncak\b)/],
    ["nl",/(?:\bknuffel\b|\bverzamel\b|\banime merch nederland\b|\bpluche\b)/],
    ["pl",/(?:\bgadzet\b|\bfigurki?\b|\bpluszak\b|\bzabawka\b)/]
  ];
  for(const [lang,re] of lexical)if(re.test(n))return lang;
  const a=String(accept||"").toLowerCase();
  const found=LANGS.find(x=>a.startsWith(x)||a.includes(`,${x}`)||a.includes(`;${x}`));
  return found||"en";
}

const MESSAGES={
  en:{
    avoid:"Authenticity/listing risk is too high.",
    noMarket:"Not enough fresh market evidence. Keep watching.",
    nearMsrp:"Preorder or current price is near MSRP.",
    belowMsrp:"Current best offer is materially below MSRP.",
    belowMedian:"Current best offer is materially below the market median.",
    scarce:"Supply is scarce enough that waiting may increase acquisition risk.",
    watch:"No strong BUY signal yet. Continue watching current offers."
  },
  ja:{
    avoid:"\u771f\u6b63\u6027\u30fb\u51fa\u54c1\u30ea\u30b9\u30af\u304c\u9ad8\u3044\u305f\u3081\u56de\u907f\u5224\u5b9a\u3067\u3059\u3002",
    noMarket:"\u65b0\u9bae\u306a\u5e02\u5834\u30c7\u30fc\u30bf\u304c\u4e0d\u8db3\u3057\u3066\u3044\u308b\u305f\u3081\u76e3\u8996\u7d99\u7d9a\u3067\u3059\u3002",
    nearMsrp:"\u4e88\u7d04\u30fb\u73fe\u5728\u4fa1\u683c\u304c\u5b9a\u4fa1\u8fd1\u8fba\u3067\u3059\u3002",
    belowMsrp:"\u73fe\u5728\u306e\u6700\u5b89\u5024\u304c\u5b9a\u4fa1\u3092\u660e\u78ba\u306b\u4e0b\u56de\u3063\u3066\u3044\u307e\u3059\u3002",
    belowMedian:"\u73fe\u5728\u306e\u6700\u5b89\u5024\u304c\u5e02\u5834\u4e2d\u592e\u5024\u3092\u660e\u78ba\u306b\u4e0b\u56de\u3063\u3066\u3044\u307e\u3059\u3002",
    scarce:"\u4f9b\u7d66\u304c\u5c11\u306a\u304f\u3001\u5f85\u3064\u3053\u3068\u3067\u5165\u624b\u6a5f\u4f1a\u304c\u60aa\u5316\u3057\u3084\u3059\u3044\u72b6\u614b\u3067\u3059\u3002",
    watch:"\u5f37\u3044BUY\u6761\u4ef6\u306b\u306f\u672a\u9054\u3067\u3059\u3002\u73fe\u5728\u306e\u51fa\u54c1\u3092\u76e3\u8996\u3057\u307e\u3059\u3002"
  }
};

function msg(lang,key){
  return (MESSAGES[lang]||MESSAGES.en)[key]||MESSAGES.en[key]||key;
}

/* =========================================================
   SUPABASE
========================================================= */

function sbBase(env){
  if(!env.SUPABASE_URL)throw new Error("SUPABASE_URL is missing");
  return String(env.SUPABASE_URL).replace(/\/$/,"")+"/rest/v1";
}

function sbHeaders(env,extra={}){
  if(!env.SUPABASE_SECRET_KEY)throw new Error("SUPABASE_SECRET_KEY is missing");
  return {
    apikey:env.SUPABASE_SECRET_KEY,
    authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`,
    "content-type":"application/json",
    ...extra
  };
}

async function sb(env,path,options={}){
  const r=await fetch(sbBase(env)+path,{
    method:options.method||"GET",
    headers:sbHeaders(env,options.headers||{}),
    body:options.body
  });
  const raw=await r.text();
  let data=null;
  try{data=raw?JSON.parse(raw):null;}catch{data={raw};}
  if(!r.ok)throw new Error(`Supabase ${r.status}: ${raw.slice(0,1200)}`);
  return data;
}

async function sbOptional(env,path,options={}){
  try{return await sb(env,path,options);}catch(e){console.warn("Supabase optional",safeError(e));return null;}
}

async function sbCount(env,filters=""){
  const url=sbBase(env)+`/products?select=id${filters?`&${filters}`:""}`;
  const r=await fetch(url,{headers:sbHeaders(env,{Prefer:"count=exact",Range:"0-0"})});
  if(!r.ok)throw new Error(`Supabase count ${r.status}`);
  const cr=r.headers.get("content-range")||"";
  const m=cr.match(/\/(\d+)$/);
  return m?Number(m[1]):0;
}

async function loadProductCandidates(env,limit=500){
  const rows=await sbOptional(env,`/products?select=*&order=source_last_checked_at.asc.nullsfirst&limit=${Math.max(1,Math.min(1000,limit))}`);
  return Array.isArray(rows)?rows:[];
}

async function loadBackfillCandidates(env,limit=500){
  const rows=await sbOptional(env,`/products?select=*&jan_code=not.is.null&order=source_last_checked_at.asc.nullsfirst&limit=${Math.max(1,Math.min(1000,limit))}`);
  return Array.isArray(rows)?rows:[];
}

async function loadProductsByJans(env,jans=[]){
  const clean=[...new Set(jans.map(cleanJan).filter(Boolean))];
  if(!clean.length)return [];
  const rows=await sbOptional(env,`/products?select=*&jan_code=in.(${clean.join(",")})&limit=${clean.length*2}`);
  return Array.isArray(rows)?rows:[];
}

async function loadProductsBySourceKeys(env,keys=[]){
  const clean=[...new Set(keys.map(x=>String(x||"").trim()).filter(Boolean))];
  if(!clean.length)return [];
  // v3.0.11: one PostgREST IN query instead of one subrequest per key.
  // This is critical for no-JAN categories such as lottery prizes.
  const quoted=clean.map(x=>`"${x.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}"`).join(",");
  const rows=await sbOptional(env,`/products?select=*&source_product_key=in.(${encodeURIComponent(quoted)})&limit=${Math.max(2,clean.length*2)}`);
  return Array.isArray(rows)?rows:[];
}

function stableHash32(v=""){
  let h=2166136261;
  for(const ch of String(v)){h^=ch.codePointAt(0);h=Math.imul(h,16777619)>>>0;}
  return h.toString(16).padStart(8,"0");
}

function canonicalCollectibleIdentity(name="",productType="other_collectible"){
  const cleaned=normalize(cleanOfficialTitle(name))
    .replace(/^(?:\u9001\u6599\u7121\u6599|\u9001\u6599\u8fbc|\u65b0\u54c1|\u4e2d\u53e4|\u4e88\u7d04|\u5373\u7d0d)\s*/g,"")
    .replace(/(?:\u767a\u58f2\u6e08|\u5728\u5eab\u54c1|\u4e88\u7d04\u53d7\u4ed8\u4e2d|\u4e88\u7d04\u5546\u54c1|\u4e88\u7d04|\u518d\u8ca9|\u65b0\u54c1|\u4e2d\u53e4|\u672a\u958b\u5c01)/g," ")
    .replace(/(?:20\d{2}[\/.-]\d{1,2}(?:[\/.-]\d{1,2})?\u767a\u58f2?)/g," ")
    .replace(/\s+/g," ").trim();
  return `${productType}|${cleaned}`;
}

function apparelBrand(name=""){
  const raw=String(name||"");
  const up=raw.toUpperCase();
  const brands=[
    [["NEW ERA","NEWERA","\u30cb\u30e5\u30fc\u30a8\u30e9"],"NEW ERA"],
    [["NORTON","\u30ce\u30fc\u30c8\u30f3"],"NORTON"],
    [["HUF","\u30cf\u30d5"],"HUF"],
    [["UNIQLO","\u30e6\u30cb\u30af\u30ed"],"UNIQLO"],
    [["GU","\u30b8\u30fc\u30e6\u30fc"],"GU"],
    [["GRANIPH","\u30b0\u30e9\u30cb\u30d5"],"GRANIPH"],
    [["COSPA","\u30b3\u30b9\u30d1"],"COSPA"],
    [["AVIREX","\u30a2\u30f4\u30a3\u30ec\u30c3\u30af\u30b9"],"AVIREX"]
  ];
  for(const [tokens,label] of brands)for(const token of tokens)if(token.charCodeAt(0)>127?raw.includes(token):up.includes(token))return label;
  return null;
}
function apparelCollaboration(name=""){
  const raw=String(name||"");
  const compact=raw.normalize("NFKC").toUpperCase().replace(/[\s\u30fb_\-\/]+/g,"");
  const rules=[
    [/(?:DORAEMON|\u30c9\u30e9\u3048\u3082\u3093|\u30a2\u30a4\u30e0\u30c9\u30e9\u3048\u3082\u3093)/,"DORAEMON"],
    [/(?:TOKYOREVENGERS|\u6771\u4eac\u30ea\u30d9\u30f3\u30b8\u30e3\u30fc\u30ba|\u6771\u4eac\u5350\u6703)/,"TOKYO REVENGERS"],
    [/(?:NARUTO(?:SHIPPUDEN)?|\u30ca\u30eb\u30c8(?:\u75be\u98a8\u4f1d|\u30b7\u30c3\u30d7\u30a6\u30c7\u30f3)?)/,"NARUTO SHIPPUDEN"],
    [/(?:EVANGELION|\u30a8\u30f4\u30a1\u30f3\u30b2\u30ea\u30aa\u30f3|\u30a8\u30f4\u30a1)/,"EVANGELION"],
    [/(?:ONEPIECE|\u30ef\u30f3\u30d4\u30fc\u30b9)/,"ONE PIECE"],
    [/(?:POKEMON|\u30dd\u30b1\u30e2\u30f3)/,"POKEMON"],
    [/(?:HATSUNEMIKU|\u521d\u97f3\u30df\u30af)/,"HATSUNE MIKU"],
    [/(?:AVENGERS|\u30a2\u30d9\u30f3\u30b8\u30e3\u30fc\u30ba)/,"AVENGERS"],
    [/(?:BATMAN|\u30d0\u30c3\u30c8\u30de\u30f3)/,"BATMAN"],
    [/(?:DEMONSLAYER|\u9b3c\u6ec5\u306e\u5203)/,"DEMON SLAYER"],
    [/(?:MYHEROACADEMIA|\u50d5\u306e\u30d2\u30fc\u30ed\u30fc\u30a2\u30ab\u30c7\u30df\u30a2|\u30d2\u30ed\u30a2\u30ab)/,"MY HERO ACADEMIA"],
    [/(?:JUJUTSUKAISEN|\u546a\u8853\u5efb\u6226)/,"JUJUTSU KAISEN"],
    [/(?:DRAGONBALL|\u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30eb)/,"DRAGON BALL"],
    [/(?:SANRIO|\u30b5\u30f3\u30ea\u30aa)/,"SANRIO"],
    [/(?:MICKEY|\u30df\u30c3\u30ad\u30fc)/,"MICKEY"],
    [/(?:HELLOKITTY|\u30ad\u30c6\u30a3)/,"HELLO KITTY"]
  ];
  for(const [re,label] of rules)if(re.test(compact))return label;
  return null;
}
function apparelItemType(name=""){
  const n=String(name||"").normalize("NFKC");
  const rules=[
    [/(?:59FIFTY|\u30ad\u30e3\u30c3\u30d7|\u5e3d\u5b50|\u30d9\u30fc\u30b9\u30dc\u30fc\u30eb\u30ad\u30e3\u30c3\u30d7)/i,"cap"],
    [/(?:T[\s-]?\u30b7\u30e3\u30c4|\u30c6\u30a3\u30fc\u30b7\u30e3\u30c4|\bTEE\b)/i,"t_shirt"],
    [/(?:\u30cb\u30c3\u30c8\u30b7\u30e3\u30c4|\u9577\u8896\u30b7\u30e3\u30c4|\u30b7\u30e3\u30c4)/i,"shirt"],
    [/(?:\u30d1\u30fc\u30ab\u30fc|\u30d5\u30fc\u30c7\u30a3|\bHOODIE\b)/i,"hoodie"],
    [/(?:\u30b9\u30a6\u30a7\u30c3\u30c8|\u30c8\u30ec\u30fc\u30ca\u30fc)/i,"sweatshirt"],
    [/(?:\u30b8\u30e3\u30b1\u30c3\u30c8|\u30d6\u30eb\u30be\u30f3|\u30b3\u30fc\u30c8)/i,"outerwear"],
    [/(?:\u30c4\u30a4\u30eb\u30d1\u30f3\u30c4|\u30ab\u30fc\u30b4\u30d1\u30f3\u30c4|\u30d1\u30f3\u30c4|\u30ba\u30dc\u30f3|\u30b7\u30e7\u30fc\u30c4)/i,"pants"],
    [/(?:\u30cb\u30c3\u30c8|\u30bb\u30fc\u30bf\u30fc|\u30ab\u30fc\u30c7\u30a3\u30ac\u30f3)/i,"knitwear"],
    [/(?:\u30ef\u30f3\u30d4\u30fc\u30b9|\u30b9\u30ab\u30fc\u30c8)/i,"dress_skirt"]
  ];
  for(const [re,label] of rules)if(re.test(n))return label;
  return null;
}
function apparelStyleCode(name=""){
  const raw=String(name||"").normalize("NFKC");
  // Numeric merchandise codes are useful when 7-10 digits, but reject common model/series names.
  const pureNums=[...raw.matchAll(/(?:^|[^\d])(\d{7,10})(?=$|[^\d])/g)].map(m=>m[1]);
  for(const n of pureNums){
    if(/^20\d{6}$/.test(n))continue;
    return n;
  }
  const tokens=raw.match(/\b[A-Z0-9][A-Z0-9_-]{5,15}\b/gi)||[];
  const deny=new Set(["59FIFTY","9FIFTY","39THIRTY","9FORTY"]);
  for(const t0 of tokens){
    const t=t0.toUpperCase().replace(/_/g,"-");
    if(deny.has(t))continue;
    if(!/[A-Z]/.test(t)||!/\d/.test(t))continue;
    if(/^(?:IPHONE|ANDROID)/.test(t))continue;
    return t;
  }
  return null;
}
function apparelObservedSize(name=""){
  let raw=String(name||"").normalize("NFKC").toUpperCase();
  raw=raw.replace(/\bS\/S\b/g," ").replace(/\bL\/S\b/g," ");
  const m=raw.match(/(?:^|[\s\/,(])((?:XXS|XS|S|M|L|XL|XXL|XXXL|3L|4L|5L))(?:$|[\s\/,).])/);
  return m?m[1]:null;
}
function normalizeApparelCanonicalName(name=""){
  return normalize(cleanOfficialTitle(name))
    .replace(/(?:\u7206\u8cb7|\u9001\u6599\u7121\u6599|\u9001\u6599\u8fbc|\u65b0\u54c1|\u4e2d\u53e4|\u672a\u4f7f\u7528|\u6b63\u898f\u53d6\u6271\u5e97|\u6b63\u898f\u54c1|\u4e88\u7d04|\u5373\u7d0d|\u5728\u5eab\u54c1)/g," ")
    .replace(/(?:20\d{2}|\d{2})(?:\u5e74)?(?:\u6625\u590f|\u79cb\u51ac|\u6625|\u590f|\u79cb|\u51ac)(?:\u65b0\u4f5c)?/g," ")
    .replace(/\b(?:SS|AW|FW)\s*2?\d{2}\b/gi," ")
    .replace(/\bS\/S\b/gi," ")
    .replace(/\bL\/S\b/gi," ")
    .replace(/(?:^|[\s\/,(])(?:XXS|XS|S|M|L|XL|XXL|XXXL|3L|4L|5L)(?=$|[\s\/,).])/gi," ")
    .replace(/\s+/g," ").trim();
}
function apparelHasCollabSignal(name=""){
  const raw=String(name||"");
  const collab=apparelCollaboration(raw);
  if(collab)return true;
  if(/(?:\u30b3\u30e9\u30dc|\u30b3\u30e9\u30dc\u30ec\u30fc\u30b7\u30e7\u30f3|\u30a2\u30cb\u30e1\u30ad\u30e3\u30e9\u30af\u30bf\u30fc|\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30b0\u30c3\u30ba|\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30a2\u30d1\u30ec\u30eb|\u30a2\u30cb\u30e1\u30b3\u30e9\u30dc)/i.test(raw))return true;
  return false;
}
function apparelIdentity(name=""){
  const brand=apparelBrand(name);
  const collaboration=apparelCollaboration(name);
  const item_type=apparelItemType(name);
  const style_code=apparelStyleCode(name);
  const observed_size=apparelObservedSize(name);
  const normalized_name=normalizeApparelCanonicalName(name);
  let identity,identity_method;
  if(style_code){
    identity=`apparel|${brand||"unknown"}|${style_code}|${collaboration||"unknown"}`;
    identity_method="apparel_style_code";
  }else if(brand&&collaboration&&item_type){
    identity=`apparel|${brand}|${collaboration}|${item_type}|${normalized_name}`;
    identity_method="apparel_brand_collab_type";
  }else{
    identity=`apparel|${brand||"unknown"}|${collaboration||"unknown"}|${item_type||"unknown"}|${normalized_name}`;
    identity_method="apparel_canonical_name";
  }
  const fingerprint=stableHash32(identity);
  return {brand,collaboration,item_type,style_code,observed_size,normalized_name,identity,identity_method,fingerprint,source_key:`catalog:apparel:v2:${fingerprint}`};
}
function apparelClassifierOverride(name="",classification=null){
  const n=String(name||"");
  // Never turn obvious non-wearable accessories/other goods into apparel.
  if(/(?:\u30dd\u30fc\u30c1|\u30b9\u30de\u30db\u30b1\u30fc\u30b9|iPhone\s*\d*\s*(?:Pro|Plus|Max)?\s*\u30b1\u30fc\u30b9|\u30de\u30eb\u30c1\u30b1\u30fc\u30b9|\u30b3\u30b9\u30e1\u53ce\u7d0d|\u30b8\u30b0\u30bd\u30fc\u30d1\u30ba\u30eb|\u30d1\u30ba\u30eb)/i.test(n))return classification;
  const item=apparelItemType(n);
  if(!item)return classification;
  if(!apparelHasCollabSignal(n))return classification;
  return {type:"apparel",confidence:0.96,reason:`apparel_collab_item:${item}`};
}

function sneakerBrand(name=""){
  const raw=String(name||"");
  const n=raw.toUpperCase();
  const brands=[
    [["CONVERSE","\u30b3\u30f3\u30d0\u30fc\u30b9"],"CONVERSE"],
    [["PUMA","\u30d7\u30fc\u30de"],"PUMA"],
    [["SPINGLE","\u30b9\u30d4\u30f3\u30b0\u30eb"],"SPINGLE"],
    [["NIKE","\u30ca\u30a4\u30ad"],"NIKE"],
    [["ADIDAS","\u30a2\u30c7\u30a3\u30c0\u30b9"],"ADIDAS"],
    [["VANS","\u30f4\u30a1\u30f3\u30ba","\u30d0\u30f3\u30ba"],"VANS"],
    [["NEW BALANCE","\u30cb\u30e5\u30fc\u30d0\u30e9\u30f3\u30b9"],"NEW BALANCE"],
    [["REEBOK","\u30ea\u30fc\u30dc\u30c3\u30af"],"REEBOK"],
    [["ASICS","\u30a2\u30b7\u30c3\u30af\u30b9"],"ASICS"],
    [["ONITSUKA TIGER","\u30aa\u30cb\u30c4\u30ab\u30bf\u30a4\u30ac\u30fc"],"ONITSUKA TIGER"]
  ];
  for(const [tokens,label] of brands)for(const token of tokens)if(token.charCodeAt(0)>127?raw.includes(token):n.includes(token))return label;
  return null;
}
function sneakerStyleCode(name=""){
  const raw=String(name||"");
  const alpha=raw.match(/\b(?:[A-Z]{2,}[A-Z0-9]*[-_][A-Z0-9][A-Z0-9_-]{3,}|[A-Z]{1,5}\d{4,}[A-Z0-9_-]*)\b/i);
  if(alpha)return alpha[0].toUpperCase().replace(/_/g,"-");
  const nums=[...raw.matchAll(/(?:^|[^\d])(\d{8})(?=$|[^\d])/g)].map(m=>m[1]);
  for(const x of nums){if(/^20\d{6}$/.test(x))continue;return x;}
  return null;
}
function sneakerObservedSize(name=""){
  const n=String(name||"");
  let m=n.match(/(\d{2}(?:\.\d)?)-(\d{2}(?:\.\d)?)\s*cm\b/i);
  if(m)return `${m[1]}-${m[2]}cm`;
  m=n.match(/(?:^|[\s\/,(])(\d{2}(?:\.\d)?)\s*cm\b/i);
  if(m)return `${m[1]}cm`;
  m=n.match(/\b(?:US|UK)\s*(\d{1,2}(?:\.\d)?)\b/i);
  return m?m[0].toUpperCase():null;
}
function sneakerCollaboration(name=""){
  const raw=String(name||"");
  const compact=raw.normalize("NFKC").toUpperCase().replace(/[\s\u30fb\u30fb_\-\/]+/g,"");
  const rules=[
    [/(?:NARUTOSHIPPUDEN|\u30ca\u30eb\u30c8(?:\u75be\u98a8\u4f1d|\u30b7\u30c3\u30d7\u30a6\u30c7\u30f3|\u30b7\u30c3\u30d7\u30a6\u30c7\u30f3)?)/,"NARUTO SHIPPUDEN"],
    [/(?:GHOSTINTHESHELL|\u653b\u6bbb\u6a5f\u52d5\u968a)/,"GHOST IN THE SHELL"],
    [/(?:PAWPATROL|\u30d1\u30a6\u30d1\u30c8\u30ed\u30fc\u30eb|\u30d1\u30a6\u30d1\u30c8)/,"PAW PATROL"],
    [/(?:POWERPUFFGIRLS|\u30d1\u30ef\u30fc\u30d1\u30d5\u30ac\u30fc\u30eb\u30ba)/,"POWERPUFF GIRLS"],
    [/(?:SPONGEBOB|\u30b9\u30dd\u30f3\u30b8\u30dc\u30d6)/,"SPONGEBOB"]
  ];
  for(const [re,label] of rules)if(re.test(compact))return label;
  return null;
}
function sneakerModelFamily(name="",brand=null){
  const raw=String(name||"").normalize("NFKC");
  const compact=raw.toUpperCase().replace(/[\s\u30fb_\-\/]+/g,"");
  if(brand==="CONVERSE"){
    if(/(?:ALLSTAR|\u30aa\u30fc\u30eb\u30b9\u30bf\u30fc)/i.test(raw)){
      if(/(?:\bOX\b|\u30ed\u30fc\u30ab\u30c3\u30c8)/i.test(raw))return "ALL STAR OX";
      if(/(?:\bHI\b|\u30cf\u30a4\u30ab\u30c3\u30c8)/i.test(raw))return "ALL STAR HI";
      if(/(?:CHUNKYLINE|\u30c1\u30e3\u30f3\u30ad\u30fc\u30e9\u30a4\u30f3)/i.test(compact))return "ALL STAR CHUNKYLINE";
      return "ALL STAR";
    }
  }
  if(brand==="ADIDAS"&&/(?:SUPERSTAR|\u30b9\u30fc\u30d1\u30fc\u30b9\u30bf\u30fc)/i.test(raw))return "SUPERSTAR";
  return null;
}
function normalizeSneakerCanonicalName(name=""){
  return normalize(cleanOfficialTitle(name))
    .replace(/(?:\u9001\u6599\u7121\u6599|\u9001\u6599\u8fbc|\u65b0\u54c1|\u4e2d\u53e4|\u672a\u4f7f\u7528|\u6b63\u898f\u53d6\u6271\u5e97|\u6b63\u898f\u54c1|\u4e88\u7d04|\u5373\u7d0d|\u767a\u58f2\u6e08|\u5728\u5eab\u54c1)/g," ")
    .replace(/(?:20\d{2}|\d{2})(?:\u5e74)?(?:\u6625\u590f|\u79cb\u51ac|\u6625|\u590f|\u79cb|\u51ac)(?:\u65b0\u4f5c)?/g," ")
    .replace(/(?:\u6625\u590f|\u79cb\u51ac|\u6625|\u590f|\u79cb|\u51ac)(?:20\d{2}|\d{2})(?:\u65b0\u4f5c)?/g," ")
    .replace(/\b(?:SS|AW|FW)\s*2?\d{2}\b/gi," ")
    .replace(/(?:20\d{2}\u5e74)?\d{1,2}\u6708(?:\u4e0a\u65ec|\u4e2d\u65ec|\u4e0b\u65ec|\u672a\u5b9a)?(?:\u767a\u58f2|\u5165\u8377|\u767a\u9001)?(?:\u4e88\u5b9a)?/g," ")
    .replace(/\b\d{2}(?:\.\d)?-\d{2}(?:\.\d)?\s*cm\b/gi," ")
    .replace(/\b\d{2}(?:\.\d)?\s*cm\b/gi," ")
    .replace(/\b(?:US|UK)\s*\d{1,2}(?:\.\d)?\b/gi," ")
    .replace(/\s+/g," ").trim();
}
function sneakerIdentity(name=""){
  const brand=sneakerBrand(name);
  const style_code=sneakerStyleCode(name);
  const collaboration=sneakerCollaboration(name);
  const model=sneakerModelFamily(name,brand);
  const observed_size=sneakerObservedSize(name);
  const normalized_name=normalizeSneakerCanonicalName(name);
  let identity;
  let identity_method;
  if(style_code){
    identity=`sneaker|${brand||"unknown"}|${style_code}|${collaboration||"unknown"}`;
    identity_method="sneaker_style_code";
  }else if(brand&&collaboration&&model){
    identity=`sneaker|${brand}|${collaboration}|${model}`;
    identity_method="sneaker_brand_collab_model";
  }else{
    identity=`sneaker|${brand||"unknown"}|${collaboration||"unknown"}|${model||"unknown"}|${normalized_name}`;
    identity_method="sneaker_canonical_name";
  }
  const fingerprint=stableHash32(identity);
  return {brand,style_code,collaboration,model,observed_size,normalized_name,identity,identity_method,fingerprint,source_key:`catalog:sneaker:v3:${fingerprint}`};
}

/* =========================================================
   SPECIALIST COLLECTIBLES INTELLIGENCE v3.1
   Category-specific identity attributes are stored in metadata
   and reused by market matching, rarity and paid responses.
========================================================= */

function firstMatch(v,re,group=1){const m=String(v||"").normalize("NFKC").match(re);return m?String(m[group]||m[0]).trim():null;}
function upperOrNull(v){return v?String(v).trim().toUpperCase():null;}

function tradingCardGame(name=""){
  const n=String(name||"");
  if(/\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9|pokemon\s*(?:card|tcg)/i.test(n))return "POKEMON";
  if(/ONE\s*PIECE\s*(?:\u30ab\u30fc\u30c9|CARD)|\u30ef\u30f3\u30d4\u30fc\u30b9\u30ab\u30fc\u30c9/i.test(n))return "ONE PIECE CARD GAME";
  if(/\u904a\u622f\u738b|YU-?GI-?OH/i.test(n))return "YU-GI-OH!";
  if(/UNION\s*ARENA|\u30e6\u30cb\u30aa\u30f3\u30a2\u30ea\u30fc\u30ca/i.test(n))return "UNION ARENA";
  if(/\u30f4\u30a1\u30a4\u30b9\u30b7\u30e5\u30f4\u30a1\u30eb\u30c4|WEISS\s*SCHWARZ/i.test(n))return "WEISS SCHWARZ";
  if(/\u30c7\u30e5\u30a8\u30eb.?\u30de\u30b9\u30bf\u30fc\u30ba|DUEL\s*MASTERS/i.test(n))return "DUEL MASTERS";
  if(/\u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30eb.*(?:\u30ab\u30fc\u30c9|FUSION\s*WORLD)|FUSION\s*WORLD/i.test(n))return "DRAGON BALL SUPER CARD GAME";
  return null;
}
function tradingCardSetCode(name=""){
  return upperOrNull(firstMatch(name,/\b((?:OP|EB|ST|PRB|SV|S|SM|XY|BW|DP|PROMO|UA|EX|BT|FB|FS)[-_]?[A-Z0-9]{1,8})\b/i));
}
function tradingCardNumber(name=""){
  const patterns=[
    /\b((?:OP|EB|ST|P|PRB|UA|EX|BT|FB|FS)\d{1,3}[-_]\d{2,4})\b/i,
    /\b(\d{1,3}\/\d{1,3})\b/,
    /(?:\u30ab\u30fc\u30c9\u756a\u53f7|CARD\s*NO\.?)\s*[:\uff1a#]?\s*([A-Z0-9_-]{3,20})/i
  ];
  for(const re of patterns){const x=firstMatch(name,re);if(x)return upperOrNull(x);}
  return null;
}
function tradingCardRarity(name=""){
  const m=firstMatch(name,/(?:^|[\s\u3010[(])((?:SAR|SR|UR|AR|CHR|CSR|HR|RRR|RR|R|SEC|SP|SSP|L|C|UC|PR|P|\u30d1\u30e9\u30ec\u30eb|\u30b7\u30fc\u30af\u30ec\u30c3\u30c8))(?:[\s\u3011)\]]|$)/i);
  return m?upperOrNull(m):null;
}
function tradingCardGrade(name=""){
  const company=firstMatch(name,/(?:^|[^A-Z0-9])(PSA|BGS|CGC|ARS)(?=\s*\d|[^A-Z0-9]|$)/i);
  const grade=firstMatch(name,/\b(?:PSA|BGS|CGC|ARS)\s*(10(?:\.0)?|9\.5|9|8\.5|8|7\.5|7)\b/i);
  return {grading_company:upperOrNull(company),grade:grade?Number(grade):null};
}
function tradingCardLanguage(name=""){
  const n=String(name||"");
  if(/\u65e5\u672c\u8a9e\u7248|JAPANESE\b/i.test(n))return "ja";
  if(/\u82f1\u8a9e\u7248|ENGLISH\b/i.test(n))return "en";
  if(/\u4e2d\u56fd\u8a9e\u7248|CHINESE\b/i.test(n))return "zh";
  if(/\u97d3\u56fd\u8a9e\u7248|KOREAN\b/i.test(n))return "ko";
  return null;
}
function tradingCardCondition(name=""){
  const n=String(name||"");
  if(/\u672a\u958b\u5c01|SEALED/i.test(n))return "sealed";
  if(/\u7f8e\u54c1|NEAR\s*MINT|\bNM\b/i.test(n))return "near_mint";
  if(/\u65b0\u54c1|MINT\b/i.test(n))return "mint_or_new";
  if(/\u4e2d\u53e4|USED|PLAYED/i.test(n))return "used";
  return null;
}
function tradingCardProfile(name=""){
  const grade=tradingCardGrade(name);
  return {
    card_game:tradingCardGame(name),
    form:tradingCardForm(name),
    set_code:tradingCardSetCode(name),
    card_number:tradingCardNumber(name),
    rarity:tradingCardRarity(name),
    language:tradingCardLanguage(name),
    foil_parallel:/\u30d1\u30e9\u30ec\u30eb|PARALLEL|FOIL|HOLO|\u30db\u30ed/i.test(String(name||""))?true:null,
    condition:tradingCardCondition(name),
    grading_company:grade.grading_company,
    grade:grade.grade
  };
}
function lotteryPrizeProfile(name=""){
  // Keep Japanese matcher tokens ASCII-only in source so deployment/editor transcoding cannot corrupt them.
  const rank=firstMatch(name,new RegExp("(?:^|[\\s\u3010[(])((?:\u30e9\u30b9\u30c8\u30ef\u30f3|LAST\\s*ONE|[A-H])\u8cde)(?:[\\s\u3011)\\]]|$)","i"));
  const lotterySeries=firstMatch(name,new RegExp("(\u4e00\u756a\u304f\u3058[^\u3010\\[(]{0,80})","i"));
  return {prize_rank:rank?upperOrNull(rank.replace(/\s+/g," ")):null,lottery_series:lotterySeries};
}
function modelKitProfile(name=""){
  const n=String(name||"");
  const grade=firstMatch(n,/\b(PG|MGEX|MGSD|MG|RG|HGUC|HG|EG|SDCS|SD|RE\/100)\b/i);
  const scale=firstMatch(n,/\b(1\/(?:24|32|35|48|60|72|100|144|350))\b/i);
  return {grade:upperOrNull(grade),scale:scale||null,limited:/\u9650\u5b9a|PREMIUM\s*BANDAI|\u30d7\u30ec\u30df\u30a2\u30e0\u30d0\u30f3\u30c0\u30a4|EXCLUSIVE/i.test(n)?true:null};
}
function plushProfile(name=""){
  const size=firstMatch(name,/(\d{1,3}(?:\.\d+)?)\s*cm\b/i);
  return {size_cm:size?Number(size):null,prize:/\u30d7\u30e9\u30a4\u30ba|\u666f\u54c1|AMUSEMENT|SEGA|TAITO|BANPRESTO/i.test(String(name||""))?true:null};
}
function acrylicProfile(name=""){
  const size=firstMatch(name,/(\d{1,3}(?:\.\d+)?)\s*cm\b/i);
  return {size_cm:size?Number(size):null,event_limited:/\u9650\u5b9a|\u4f1a\u5834|\u30a4\u30d9\u30f3\u30c8|\u30b3\u30df\u30b1|C\d{2,3}|EXCLUSIVE/i.test(String(name||""))?true:null};
}
function smallGoodsProfile(name=""){
  const n=String(name||"");
  return {event_limited:/\u9650\u5b9a|\u4f1a\u5834|\u30a4\u30d9\u30f3\u30c8|\u30b3\u30df\u30b1|EXCLUSIVE/i.test(n)?true:null,blind_random:/\u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0|\u30e9\u30f3\u30c0\u30e0|BLIND|RANDOM/i.test(n)?true:null};
}
function figureProfile(name=""){
  const n=String(name||"");
  const scale=firstMatch(n,/\b(1\/(?:4|6|7|8|10|12))\b/i);
  const edition=firstMatch(n,/(?:ver\.?|version|\u7248)\s*([A-Za-z0-9\u3041-\u3093\u30a1-\u30f6\u4e00-\u9fa0\u30fb _-]{1,40})/i);
  return {scale:scale||null,edition:edition||null,rerelease:/\u518d\u8ca9|\u518d\u751f\u7523|RERELEASE|REISSUE/i.test(n)?true:null,limited:/\u9650\u5b9a|EXCLUSIVE/i.test(n)?true:null};
}
function apparelProfile(name=""){
  const x=apparelIdentity(name);
  const color=firstMatch(name,/(?:\u30ab\u30e9\u30fc|COLOR)\s*[:\uff1a]?\s*([A-Za-z\u3041-\u3093\u30a1-\u30f6\u4e00-\u9fa0]{2,20})/i);
  return {brand:x.brand,item_type:x.item_type,style_code:x.style_code,collaboration:x.collaboration,size:x.observed_size,color:color||null};
}
function sneakerProfile(name=""){
  const x=sneakerIdentity(name);
  const colorway=firstMatch(name,/(?:COLORWAY|\u30ab\u30e9\u30fc)\s*[:\uff1a]?\s*([A-Za-z0-9\u3041-\u3093\u30a1-\u30f6\u4e00-\u9fa0 /_-]{2,50})/i);
  return {brand:x.brand,model:x.model,style_code:x.style_code,collaboration:x.collaboration,size:x.observed_size,colorway:colorway||null};
}
function specialistProfile(name="",productType="other"){
  const t=String(productType||"other");
  if(t==="trading_card")return tradingCardProfile(name);
  if(t==="sneaker")return sneakerProfile(name);
  if(t==="apparel")return apparelProfile(name);
  if(t==="lottery_prize")return lotteryPrizeProfile(name);
  if(t==="model_kit")return modelKitProfile(name);
  if(t==="plush")return plushProfile(name);
  if(t==="acrylic_goods")return acrylicProfile(name);
  if(t==="keychain"||t==="badge")return smallGoodsProfile(name);
  if(t==="figure"||t==="nendoroid"||t==="figma")return figureProfile(name);
  return {};
}
function productSpecialistProfile(product){
  const stored=product?.metadata?.specialist||{};
  const parsed=specialistProfile(`${product?.canonical_name_ja||""} ${product?.canonical_name_en||""}`,product?.product_type);
  return {...parsed,...Object.fromEntries(Object.entries(stored).filter(([,v])=>v!==null&&v!==""&&v!==undefined))};
}
function specialistIdentityAnalysis(product,title=""){
  const type=String(product?.product_type||"other"),expected=productSpecialistProfile(product),candidate=specialistProfile(title,type);
  let score=0,conflict=false;const matched=[],conflicts=[];
  const exact=(key,weight)=>{
    const a=expected?.[key],b=candidate?.[key];
    if(a==null||a===""||b==null||b==="")return;
    if(String(a).toUpperCase()===String(b).toUpperCase()){score+=weight;matched.push(key);}
    else{conflict=true;conflicts.push(key);}
  };
  if(type==="trading_card"){exact("card_game",12);exact("card_number",35);exact("set_code",18);exact("rarity",12);exact("grading_company",18);exact("grade",18);exact("language",8);exact("form",18);}
  else if(type==="sneaker"){exact("brand",15);exact("style_code",35);exact("model",15);exact("collaboration",18);exact("size",12);}
  else if(type==="apparel"){exact("brand",15);exact("style_code",35);exact("item_type",18);exact("collaboration",18);exact("size",10);}
  else if(type==="lottery_prize"){exact("prize_rank",30);}
  else if(type==="model_kit"){exact("grade",20);exact("scale",18);}
  else if(type==="plush"||type==="acrylic_goods"){exact("size_cm",12);}
  else if(type==="figure"||type==="nendoroid"||type==="figma"){exact("scale",18);exact("edition",18);}
  return {score,conflict,matched,conflicts,expected,candidate};
}
function categoryMarketThreshold(product){
  const t=String(product?.product_type||"");
  if(["trading_card","sneaker","apparel","lottery_prize"].includes(t))return 34;
  return 40;
}


function specialistIntelligenceSelfTest(){
  const cases=[
    {type:"trading_card",name:"\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 SV8a 205/187 SAR PSA10 \u65e5\u672c\u8a9e\u7248",expect:{card_game:"POKEMON",set_code:"SV8A",card_number:"205/187",rarity:"SAR",grading_company:"PSA",grade:10}},
    {type:"sneaker",name:"CONVERSE NARUTO SHIPPUDEN 31317140 27.5cm",expect:{brand:"CONVERSE",style_code:"31317140",collaboration:"NARUTO SHIPPUDEN",size:"27.5cm"}},
    {type:"apparel",name:"NEW ERA NARUTO 59FIFTY 14312345",expect:{brand:"NEW ERA",item_type:"cap",style_code:"14312345",collaboration:"NARUTO SHIPPUDEN"}},
    {type:"lottery_prize",name:"\u4e00\u756a\u304f\u3058 ONE PIECE \u30e9\u30b9\u30c8\u30ef\u30f3\u8cde \u30eb\u30d5\u30a3",expect:{prize_rank:"\u30e9\u30b9\u30c8\u30ef\u30f3\u8cde"}},
    {type:"model_kit",name:"MG 1/100 \u30ac\u30f3\u30c0\u30e0 \u9650\u5b9a",expect:{grade:"MG",scale:"1/100",limited:true}},
    {type:"plush",name:"\u521d\u97f3\u30df\u30af \u306c\u3044\u3050\u308b\u307f 30cm",expect:{size_cm:30}},
    {type:"acrylic_goods",name:"\u521d\u97f3\u30df\u30af \u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 15cm \u30a4\u30d9\u30f3\u30c8\u9650\u5b9a",expect:{size_cm:15,event_limited:true}},
    {type:"keychain",name:"ONE PIECE \u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0 \u30ad\u30fc\u30db\u30eb\u30c0\u30fc",expect:{blind_random:true}},
    {type:"figure",name:"\u521d\u97f3\u30df\u30af 1/7 \u30b9\u30b1\u30fc\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2 \u9650\u5b9a\u7248",expect:{scale:"1/7",limited:true}}
  ];
  const results=cases.map(c=>{const got=specialistProfile(c.name,c.type),ok=Object.entries(c.expect).every(([k,v])=>String(got?.[k])===String(v));return {...c,got,ok};});
  return {ok:results.every(x=>x.ok),passed:results.filter(x=>x.ok).length,total:results.length,results};
}
function collectibleIdentityKey(name,productType,jan=null){
  if(productType==="sneaker"){
    const x=sneakerIdentity(name);
    return x;
  }
  if(productType==="apparel"){
    const x=apparelIdentity(name);
    return x;
  }
  if(jan)return {identity:`jan|${jan}`,fingerprint:null,source_key:`catalog:yahoo:jan:${jan}`,identity_method:"jan"};
  const x=noJanCanonicalKey(name,productType);
  return {...x,identity_method:"canonical_fingerprint"};
}

function noJanCanonicalKey(name,productType){
  const identity=canonicalCollectibleIdentity(name,productType);
  return {identity,fingerprint:stableHash32(identity),source_key:`catalog:canonical:v1:${stableHash32(identity)}`};
}

async function getObservations(env,productId){
  const rows=await sbOptional(env,`/market_observations?select=*&product_id=eq.${encodeURIComponent(productId)}&order=observed_at.desc&limit=1000`);
  return Array.isArray(rows)?rows:[];
}

/* =========================================================
   SOURCES
========================================================= */

async function loadSources(env){
  const rows=await sbOptional(env,"/sources?select=*");
  return Array.isArray(rows)?rows:[];
}

function sourceIdBySlugOrName(sources=[],slug,names=[]){
  const wanted=[slug,...names].map(normalize);
  const x=sources.find(s=>wanted.includes(normalize(s.slug||""))||wanted.includes(normalize(s.name||"")));
  return x?.id||null;
}

async function ensureSource(env,{slug,name,type="marketplace",base_url=null}){
  const sources=await loadSources(env);
  const existing=sourceIdBySlugOrName(sources,slug,[name]);
  if(existing)return {source_id:existing,created:false};
  const rows=await sb(env,"/sources",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      slug,
      name,
      source_type:type,
      base_url,
      access_method:"api",
      priority:100,
      enabled:true,
      metadata:{created_by:"anime-intelligence",version:VERSION}
    })
  });
  return {source_id:Array.isArray(rows)?rows[0]?.id:null,created:true};
}

async function ensureYahooSource(env){
  return ensureSource(env,{slug:"yahoo-shopping",name:"Yahoo! Shopping",base_url:"https://shopping.yahoo.co.jp/"});
}

/* =========================================================
   PRODUCT CLASSIFICATION / QUALITY
========================================================= */

function classifyProduct(v=""){
  const s=normalize(v);
  // Product-head precedence: classify the item actually being sold before incidental theme/style words.
  if(/happy\s*bag|\u798f\u888b|\u8a70\u3081\u5408\u308f\u305b|\u8a70\u5408\u305b|\u30d0\u30e9\u30a8\u30c6\u30a3\u30bb\u30c3\u30c8/i.test(v)){
    return {type:"other",confidence:.99,reason:"mixed_bundle"};
  }
  if(/head\s*cover|\u30d8\u30c3\u30c9\u30ab\u30d0\u30fc/i.test(v)){
    return {type:"accessory",confidence:.99,reason:"golf_head_cover"};
  }
  // Strong merchandise nouns win over words such as uniform, clothes or figure used descriptively.
  if(/acrylic stand|acrylic figure|\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9|\u30a2\u30af\u30b9\u30bf|\u30a2\u30af\u30ea\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2/i.test(s))return {type:"acrylic_goods",confidence:.995,reason:"explicit_acrylic_merchandise"};
  if(/key ?chain|keyholder|\u30ad\u30fc\u30db\u30eb\u30c0\u30fc|\u30ad\u30fc\u30c1\u30a7\u30fc\u30f3/i.test(s))return {type:"keychain",confidence:.995,reason:"explicit_keychain"};
  if(/badge|button badge|\u7f36\u30d0\u30c3\u30b8|\u30d4\u30f3\u30d0\u30c3\u30b8/i.test(s))return {type:"badge",confidence:.995,reason:"explicit_badge"};
  if(/trading card|collectible card|tcg|pokemon card|one piece card|union arena|weiss schwarz|duel masters|\u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9|\u30c8\u30ec\u30ab|\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9|\u30ef\u30f3\u30d4\u30fc\u30b9\u30ab\u30fc\u30c9|\u30e6\u30cb\u30aa\u30f3\u30a2\u30ea\u30fc\u30ca|\u30f4\u30a1\u30a4\u30b9\u30b7\u30e5\u30f4\u30a1\u30eb\u30c4/i.test(s))return {type:"trading_card",confidence:.99,reason:"explicit_trading_card"};
  if(/ichiban kuji|lottery prize|kuji prize|\u4e00\u756a\u304f\u3058|\u304f\u3058\u666f\u54c1|[A-H]\u8cde/i.test(s))return {type:"lottery_prize",confidence:.99,reason:"explicit_lottery_prize"};
  if(/plush|stuffed|\u306c\u3044\u3050\u308b\u307f|\u306c\u3044/i.test(s))return {type:"plush",confidence:.99,reason:"explicit_plush"};
  if(/moderoid|plastic model|model kit|\u30d7\u30e9\u30e2\u30c7\u30eb|\u7d44\u307f\u7acb\u3066\u30ad\u30c3\u30c8|\u30ac\u30f3\u30d7\u30e9/i.test(s))return {type:"model_kit",confidence:.99,reason:"explicit_model_kit"};
  // Cosplay listings may contain shoes as part of a set; do not misclassify the whole listing as sneakers.
  if(/cosplay|\u30b3\u30b9\u30d7\u30ec|\u4eee\u88c5|\u8863\u88c5|\u30a6\u30a3\u30c3\u30b0/i.test(s))return {type:"apparel",confidence:.97,reason:"cosplay_apparel"};
  if(/s\.h\.figuarts|figuarts|pop up parade|scale figure|\u30b9\u30b1\u30fc\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2|\u5857\u88c5\u6e08\u307f(?:\u53ef\u52d5)?\u30d5\u30a3\u30ae\u30e5\u30a2|\u30d5\u30a3\u30ae\u30e5\u30a2|statue|g\.e\.m\.|look up|\u308b\u304b\u3063\u3077|portrait\.of\.pirates|p\.o\.p/i.test(s)){
    return {type:"figure",confidence:.99,reason:"explicit_figure_product"};
  }
  const rules=[
    ["replacement_part",/replacement|option care parts|spare parts|\u4ea4\u63db\u7528|\u30aa\u30d7\u30b7\u30e7\u30f3\u30d1\u30fc\u30c4|\u4ed8\u3051\u66ff\u3048|\u4ea4\u63db\u30d1\u30fc\u30c4|care parts|root \(feet\)|hand parts|face parts/,0.99,"replacement_or_option_part"],
    ["trading_card",/trading card|collectible card|tcg|pokemon card|one piece card|union arena|weiss schwarz|duel masters|\u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9|\u30c8\u30ec\u30ab|\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9|\u30ef\u30f3\u30d4\u30fc\u30b9\u30ab\u30fc\u30c9|\u30e6\u30cb\u30aa\u30f3\u30a2\u30ea\u30fc\u30ca|\u30f4\u30a1\u30a4\u30b9\u30b7\u30e5\u30f4\u30a1\u30eb\u30c4/,0.98,"trading_card"],
    ["sneaker",/sneaker|shoe|footwear|air jordan|dunk low|air force 1|adidas|puma|converse|vans|asics|\u30b9\u30cb\u30fc\u30ab\u30fc|\u30b7\u30e5\u30fc\u30ba|\u9774/,0.94,"footwear_or_collaboration_sneaker"],
    ["lottery_prize",/ichiban kuji|lottery prize|kuji prize|\u4e00\u756a\u304f\u3058|\u304f\u3058\u666f\u54c1|[A-H]\u8cde/,0.97,"lottery_prize"],
    ["apparel",/t-?shirt|hoodie|sweat|jacket|cap\b|hat\b|shirt\b|apparel|clothing|\u30a2\u30d1\u30ec\u30eb|\u30a6\u30a7\u30a2|\u30b8\u30e3\u30b1\u30c3\u30c8|\u30d1\u30fc\u30ab\u30fc|\u30b7\u30e3\u30c4|\u5e3d\u5b50|\u8863\u88c5|\u304a\u3088\u3046\u3075\u304f|clothes|costume|wear\b/,0.98,"apparel_or_doll_clothes"],
    ["acrylic_goods",/acrylic stand|acrylic figure|\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9|\u30a2\u30af\u30b9\u30bf|\u30a2\u30af\u30ea\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2/,0.99,"acrylic_goods"],
    ["keychain",/key ?chain|keyholder|\u30ad\u30fc\u30db\u30eb\u30c0\u30fc|\u30ad\u30fc\u30c1\u30a7\u30fc\u30f3/,0.99,"keychain"],
    ["badge",/badge|button badge|\u7f36\u30d0\u30c3\u30b8|\u30d4\u30f3\u30d0\u30c3\u30b8/,0.99,"badge"],
    ["plush",/plush|stuffed|\u306c\u3044\u3050\u308b\u307f|\u306c\u3044/,0.98,"plush"],
    ["accessory",/decal|\u30c7\u30ab\u30fc\u30eb|clear file|\u30af\u30ea\u30a2\u30d5\u30a1\u30a4\u30eb|poster|\u30dd\u30b9\u30bf\u30fc|stand base|\u53f0\u5ea7|display case|\u30b1\u30fc\u30b9|sticker|\u30b7\u30fc\u30eb/,0.97,"accessory"],
    ["model_kit",/moderoid|plastic model|model kit|\u30d7\u30e9\u30e2\u30c7\u30eb|\u7d44\u307f\u7acb\u3066\u30ad\u30c3\u30c8|\u30ac\u30f3\u30d7\u30e9/,0.98,"model_kit"],
    ["figma",/\bfigma\b/,0.99,"figma_brand"],
    ["nendoroid",/nendoroid|\u306d\u3093\u3069\u308d\u3044\u3069(?!\u3077\u3089\u3059)/,0.99,"nendoroid_brand"],
    ["figure",/s\.h\.figuarts|figuarts|pop up parade|scale figure|\u30b9\u30b1\u30fc\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2|\u30d5\u30a3\u30ae\u30e5\u30a2|statue|g\.e\.m\.|look up|\u308b\u304b\u3063\u3077|portrait\.of\.pirates|p\.o\.p/,0.96,"physical_figure"],
    ["other",/.*/,0.50,"fallback"]
  ];
  for(const [type,re,confidence,reason] of rules){if(re.test(s))return {type,confidence,reason};}
  return {type:"other",confidence:.5,reason:"fallback"};
}

function catalogClassificationRegressionSelfTest(){
  const cases=[
    ["S.H.Figuarts \u300e\u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30ebZ\u300f \u30c8\u30e9\u30f3\u30af\u30b9\u3008Z\u6226\u58eb\u3009(\u521d\u56de\u9650\u5b9a\u3008Z\u6226\u58eb\u3009\u96c6\u7d50\u53f0\u5ea7B\u4ed8\u5c5e\u7248) (\u5857\u88c5\u6e08\u307f\u53ef\u52d5\u30d5\u30a3\u30ae\u30e5\u30a2)","figure"],
    ["(\u671f\u9593\u9650\u5b9a) \u3061\u3044\u304b\u308f\u30b4\u30eb\u30d5 \u30d8\u30c3\u30c9\u30ab\u30d0\u30fc DR \u30cb\u30c3\u30c8","accessory"],
    ["HANSA \u30b4\u30eb\u30d5 \u30d8\u30c3\u30c9\u30ab\u30d0\u30fc \u30ea\u30a2\u30eb\u306a\u52d5\u7269\u306c\u3044\u3050\u308b\u307f","accessory"],
    ["\u3059\u307f\u3063\u30b3\u3050\u3089\u3057 \u798f\u888b 2026 Happy Bag \u96d1\u8ca8 \u306c\u3044\u3050\u308b\u307f \u6587\u623f\u5177","other"],
    ["\u30ef\u30f3\u30d4\u30fc\u30b9 ONE PIECE \u7f36\u30d0\u30c3\u30b8\u30b3\u30ec\u30af\u30b7\u30e7\u30f3","badge"],
    ["\u521d\u97f3\u30df\u30af \u30a2\u30af\u30ea\u30eb\u30ad\u30fc\u30db\u30eb\u30c0\u30fc","keychain"],
    ["\u30dd\u30b1\u30e2\u30f3 \u30b3\u30e9\u30dc \u30b9\u30cb\u30fc\u30ab\u30fc","sneaker"],
    ["\u30ad\u30e3\u30e9\u30af\u30bf\u30fc \u30b3\u30e9\u30dc hoodie","apparel"],
    ["\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 \u30d6\u30fc\u30b9\u30bf\u30fc\u30d1\u30c3\u30af","trading_card"],
    ["\u521d\u97f3\u30df\u30af \u306c\u3044\u3050\u308b\u307f","plush"],
    ["\u30ac\u30f3\u30c0\u30e0 \u30ac\u30f3\u30d7\u30e9 \u30d7\u30e9\u30e2\u30c7\u30eb","model_kit"],
    ["\u521d\u97f3\u30df\u30af \u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9","acrylic_goods"],
    ["\u4e00\u756a\u304f\u3058 ONE PIECE A\u8cde","lottery_prize"],
    ["EVANGELION \u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 \u5f0f\u6ce2\u30fb\u30a2\u30b9\u30ab \u5236\u670dVer.","acrylic_goods"],
    ["\u9b3c\u6ec5\u306e\u5203 \u3053\u3053\u307f\u3048\u30a2\u30af\u30ea\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2","acrylic_goods"],
    ["\u521d\u97f3\u30df\u30af \u30b3\u30b9\u30d7\u30ec\u8863\u88c5 \u30a6\u30a3\u30c3\u30b0 \u9774 cosplay","apparel"],
    ["\u30e9\u30d6\u30e9\u30a4\u30d6 \u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30a2\u30af\u30ea\u30eb\u30ad\u30fc\u30db\u30eb\u30c0\u30fc \u5236\u670dver.","keychain"]
  ];
  const results=cases.map(([name,expected])=>{const got=classifyProduct(name).type;return {name,expected,got,ok:got===expected};});
  return {ok:results.every(x=>x.ok),passed:results.filter(x=>x.ok).length,total:results.length,results};
}

function normalizedManufacturer(v=""){
  const s=normalize(v);
  if(/good smile|\u30b0\u30c3\u30c9\u30b9\u30de\u30a4\u30eb/.test(s))return "good smile company";
  if(/bandai spirits|tamashii|\u30d0\u30f3\u30c0\u30a4\u30b9\u30d4\u30ea\u30c3\u30c4/.test(s))return "bandai spirits";
  if(/kotobukiya|\u58fd\u5c4b|\u30b3\u30c8\u30d6\u30ad\u30e4/.test(s))return "kotobukiya";
  if(/megahouse|\u30e1\u30ac\u30cf\u30a6\u30b9/.test(s))return "megahouse";
  if(/kadokawa|kdcolle|\u30ab\u30c9\u30ab\u30ef/.test(s))return "kadokawa";
  if(/alter|\u30a2\u30eb\u30bf\u30fc/.test(s))return "alter";
  return s;
}

function identityQualityReasons(p){
  let score=0;const reasons=[];
  const add=(n,k)=>{score+=n;reasons.push(k);};
  if(cleanJan(p.jan_code)){add(45,"jan");}
  if(p.official_url)add(15,"official_url");
  if(p.manufacturer)add(10,"manufacturer");
  if(p.model_number)add(10,"model_number");
  if(p.canonical_name_en)add(8,"english_name");
  if(p.source_product_key)add(5,"source_key");
  if(p.official_image_url)add(3,"image");
  if(Number(p.msrp_jpy)>0)add(2,"msrp");
  if(p.original_release_date)add(2,"release_date");
  const specialist=productSpecialistProfile(p),specialCount=Object.values(specialist||{}).filter(v=>v!==null&&v!==""&&v!==false&&v!==undefined).length;
  if(specialCount>=3)add(15,"specialist_identity");
  else if(specialCount>=2)add(10,"specialist_identity");
  else if(specialCount>=1)add(5,"specialist_identity");
  return {score:Math.min(100,score),reasons};
}

function marketIdentityQuality(p){return identityQualityReasons(p).score;}

function identificationConfidenceFor(p){
  const q=identityQualityReasons(p).score;
  if(cleanJan(p.jan_code)&&p.official_url)return .99;
  if(cleanJan(p.jan_code)&&p.manufacturer)return .97;
  if(cleanJan(p.jan_code))return .93;
  if(p.official_url&&p.manufacturer)return .90;
  if(q>=40)return .80;
  return .60;
}

function productTypeConflict(product,title=""){
  const candidate=classifyProduct(title);
  const current=String(product.product_type||"other");
  const collectibleTypes=new Set(["figure","nendoroid","figma","model_kit","plush","acrylic_goods","keychain","badge","lottery_prize","trading_card","sneaker","apparel","accessory"]);
  if(candidate.type==="replacement_part"&&candidate.confidence>=.95)return true;
  if(current==="other"||candidate.type==="other")return false;
  if(collectibleTypes.has(current)&&collectibleTypes.has(candidate.type)&&current!==candidate.type&&candidate.confidence>=.98){
    const figureFamily=new Set(["figure","nendoroid","figma"]);
    if(figureFamily.has(current)&&figureFamily.has(candidate.type))return false;
    return true;
  }
  return false;
}

function janNameCompatible(a,b){return labelSimilarityScore(a,b)>=30;}

function detectRerelease(v=""){
  return /\u518d\u8ca9|\u518d\u53d7\u6ce8|re-?release|rerelease|second production|\u518d\u751f\u7523/i.test(String(v));
}

/* =========================================================
   OFFICIAL PARSING / GOOD SMILE MASS DISCOVERY
========================================================= */

function htmlMeta(html,key){
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const regs=[
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,`i`),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,`i`)
  ];
  for(const r of regs){const m=html.match(r);if(m)return decodeHtml(m[1]).trim();}
  return null;
}

function htmlTitle(html){
  return htmlMeta(html,"og:title")||cleanOfficialTitle((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"");
}

function parsePriceJpy(html){
  const text=stripHtml(html);
  const m=text.match(/(?:\u4fa1\u683c|\u8ca9\u58f2\u4fa1\u683c|\u5b9a\u4fa1|price)[^\d\u00a5\uffe5]{0,20}[\u00a5\uffe5]?\s*([\d,]{3,})/i)||text.match(/[\u00a5\uffe5]\s*([\d,]{3,})/);
  return m?Number(m[1].replace(/,/g,"")):null;
}

function parseJanFromText(v=""){
  const all=[...String(v).matchAll(/\b(45\d{11}|49\d{11})\b/g)].map(x=>x[1]);
  return all.find(cleanJan)||null;
}

function parseReleaseDate(html){
  const text=stripHtml(html);
  const m=text.match(/(?:\u767a\u58f2(?:\u6642\u671f|\u65e5)?|release(?: date)?)[^\d]{0,30}((?:20\d{2})[\u5e74\/.\-]\d{1,2}[\u6708\/.\-]\d{1,2})/i);
  return m?isoDate(m[1]):null;
}

async function fetchOfficial(url){
  const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 ANIME-INTELLIGENCE/2.9","accept-language":"ja,en;q=0.8"},redirect:"follow"});
  if(!r.ok)throw new Error(`Official fetch ${r.status}: ${url}`);
  return {html:await r.text(),url:r.url};
}

function canonicalOfficialUrl(url){
  try{const u=new URL(url);u.hash="";u.search="";return u.toString().replace(/\/$/,"");}catch{return url;}
}

function sourceKeyFromOfficial(connector,url,jan=null){
  return jan?`${connector.slug}:jan:${jan}`:`${connector.slug}:url:${canonicalOfficialUrl(url)}`;
}

function discoverOfficialLinks(html,baseUrl,regex){
  const out=[];
  for(const m of html.matchAll(/href=["']([^"'#]+)["']/gi)){
    try{
      const u=new URL(decodeHtml(m[1]),baseUrl).toString();
      if(regex.test(u))out.push(canonicalOfficialUrl(u));
    }catch{}
  }
  return [...new Set(out)];
}

function goodSmileEnglishUrl(url){
  if(!/goodsmile\.com\/ja\//.test(url))return null;
  return url.replace("/ja/","/en/");
}

function parseOfficial(connector,url,html){
  const title=htmlTitle(html);
  const text=stripHtml(html);
  const jan=parseJanFromText(text);
  const classification=classifyProduct(title);
  return {
    canonical_name_ja:title,
    canonical_name_en:/\/en\//.test(url)?title:null,
    manufacturer:connector.manufacturer,
    jan_code:jan,
    msrp_jpy:parsePriceJpy(html),
    original_release_date:parseReleaseDate(html),
    official_url:canonicalOfficialUrl(url),
    official_image_url:htmlMeta(html,"og:image"),
    source_product_key:sourceKeyFromOfficial(connector,url,jan),
    product_type:classification.type,
    product_status:/\u4e88\u7d04|pre-?order/i.test(text)?"preorder":"active",
    metadata:{rerelease:detectRerelease(text),classification:{...classification,version:VERSION}}
  };
}

function parseGoodSmileCalendar(html,lang="ja"){
  const text=decodeHtml(html)
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<\/p>|<\/li>|<\/tr>|<\/div>/gi,"\n")
    .replace(/<[^>]+>/g," ")
    .replace(/\r/g,"");
  const lines=text.split("\n").map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const out=[];
  let currentDate=null;
  for(const line of lines){
    const d=isoDate(line);
    if(d)currentDate=d;
    const jan=parseJanFromText(line);
    if(!jan||/box|carton|\u30b1\u30fc\u30b9|\u30dc\u30c3\u30af\u30b9/i.test(line))continue;
    let name=line.replace(jan,"").replace(/^[-\u2013\u2014\u30fb\u25cf\u25a0\u25c6\s]+/,"").replace(/(?:JAN|JAN\u30b3\u30fc\u30c9|JAN Code)[:\uff1a]?\s*/i,"").trim();
    name=name.replace(/\s{2,}/g," ");
    if(name.length<2)continue;
    out.push({jan_code:jan,name,date:currentDate,lang,rerelease:detectRerelease(line),raw:line});
  }
  const byJan=new Map();
  for(const x of out){if(!byJan.has(x.jan_code))byJan.set(x.jan_code,x);}
  return [...byJan.values()];
}

function mergeBilingualCalendar(ja=[],en=[]){
  const map=new Map();
  for(const x of ja)map.set(x.jan_code,{jan_code:x.jan_code,name_ja:x.name,name_en:null,date:x.date,rerelease:x.rerelease,ja:x,en:null});
  for(const x of en){
    const prev=map.get(x.jan_code)||{jan_code:x.jan_code,name_ja:null,name_en:null,date:null,rerelease:false,ja:null,en:null};
    prev.name_en=x.name;prev.en=x;prev.date=prev.date||x.date;prev.rerelease=prev.rerelease||x.rerelease;map.set(x.jan_code,prev);
  }
  return [...map.values()];
}

async function fetchGoodSmileCalendars(){
  const [jaR,enR]=await Promise.allSettled([
    fetchOfficial("https://www.goodsmile.com/ja/releaseinfo"),
    fetchOfficial("https://www.goodsmile.com/en/releaseinfo")
  ]);
  const ja=jaR.status==="fulfilled"?parseGoodSmileCalendar(jaR.value.html,"ja"):[];
  const en=enR.status==="fulfilled"?parseGoodSmileCalendar(enR.value.html,"en"):[];
  return {ja,en,merged:mergeBilingualCalendar(ja,en),errors:[jaR,enR].filter(x=>x.status==="rejected").map(x=>safeError(x.reason))};
}

function goodSmileReleaseSeedPayload(rec,now=new Date().toISOString()){
  const c=classifyProduct(`${rec.name_ja||""} ${rec.name_en||""}`);
  return {
    canonical_name_ja:rec.name_ja||rec.name_en,canonical_name_en:rec.name_en||null,manufacturer:"Good Smile Company",
    brand:null,series:null,franchise:null,character_names:[],jan_code:rec.jan_code,model_number:null,product_type:c.type,scale:null,edition:null,limited_type:null,
    msrp_jpy:null,original_release_date:rec.date||null,official_url:null,official_image_url:null,image_source_url:null,image_status:"pending",
    source_product_key:`goodsmile:jan:${rec.jan_code}`,product_status:"active",identification_confidence:.97,source_last_checked_at:now,
    metadata:{created_by:"v2.9.7_mass_discovery",calendar:{date:rec.date||null,date_type:"official_release_schedule",rerelease_generation:rec.rerelease?"rerelease":"unknown"},latest_official_schedule_date:rec.date||null,release_date_type:"official_release_schedule",rerelease:!!rec.rerelease,classification:{...c,version:VERSION},identity_quality_score:68,field_provenance:{jan_code:sourceEvidence("goodsmile_release_calendar",now),canonical_name_ja:sourceEvidence("goodsmile_release_calendar",now)},ingestion_version:VERSION}
  };
}

async function saveGoodSmileReleaseSeed(env,rec){
  const existing=await loadProductsByJans(env,[rec.jan_code]);
  if(existing.length)return {status:"existing",product:existing[0]};
  const rows=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(goodSmileReleaseSeedPayload(rec))});
  return {status:"inserted",product:Array.isArray(rows)?rows[0]:null};
}

async function massDiscoverGoodSmile(env,limit=20,options={}){
  const cal=await fetchGoodSmileCalendars();
  const existing=await loadProductsByJans(env,cal.merged.map(x=>x.jan_code));
  const existingJans=new Set(existing.map(x=>cleanJan(x.jan_code)).filter(Boolean));
  const missing=cal.merged.filter(x=>!existingJans.has(x.jan_code));
  const inspect=Math.min(missing.length,Math.max(limit,limit*PIPELINE.massInspectMultiplier));
  const candidates=deterministicWindow(missing,inspect,options.timeMs||Date.now(),17);
  const selected=candidates.slice(0,Math.max(1,Math.min(50,Number(limit)||40)));
  let inserted=0,updated=0,deduplicatedByJan=0,sameJanNameConflicts=0;
  const errors=[];
  if(selected.length){
    try{
      const now=new Date().toISOString();
      const payloads=selected.map(rec=>goodSmileReleaseSeedPayload(rec,now));
      const rows=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation,resolution=ignore-duplicates"},body:JSON.stringify(payloads)});
      inserted=Array.isArray(rows)?rows.length:selected.length;
    }catch(e){
      errors.push({batch:true,selected:selected.length,error:safeError(e)});
    }
  }
  return {
    discovered:cal.merged.length,
    inspected:candidates.length,
    japanese_calendar_records:cal.ja.length,
    english_calendar_records:cal.en.length,
    bilingual_jan_matches:cal.merged.filter(x=>x.name_ja&&x.name_en).length,
    already_in_database:existing.length,
    missing_from_database:missing.length,
    deduplicated_by_jan:deduplicatedByJan,
    deduplicated_by_source_key:0,
    same_jan_name_conflicts:sameJanNameConflicts,
    selected:selected.length,
    inserted,updated,
    errors:[...cal.errors.map(error=>({error})),...errors]
  };
}



function officialFeedAnchorCandidates(html,feed){
  const out=[],seen=new Set();
  for(const m of String(html||"").matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{
      const url=canonicalOfficialUrl(new URL(decodeHtml(m[1]),feed.listUrl).toString());
      const name=htmlTextCompact(m[2]);
      if(!name||name.length<4||name.length>180)continue;
      const c=classifyProduct(name);if(!COLLECTIBLE_CATALOG_TYPES.has(c.type))continue;
      if(/(?:\u30c8\u30c3\u30d7|HOME|\u4e00\u89a7|\u691c\u7d22|\u5e97\u8217|\u30cb\u30e5\u30fc\u30b9|MORE|\u8a73\u7d30\u3092\u898b\u308b)$/i.test(name))continue;
      if(feed.detailRegex&&!feed.detailRegex.test(url)&&new URL(url).pathname!==new URL(feed.listUrl).pathname)continue;
      const key=`${name}|${url}`;if(seen.has(key))continue;seen.add(key);out.push({name,url,classification:c});
    }catch{}
  }
  // Some JS-backed official lists expose titles as text but not crawlable product anchors.
  // Keep strong product-like lines as feed evidence; they still dedupe by deterministic identity.
  if(out.length<5){
    const text=decodeHtml(String(html||"")).replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/li>|<\/article>|<\/section>|<\/div>/gi,"\n").replace(/<[^>]+>/g," ");
    for(const raw of text.split("\n")){
      const name=raw.replace(/\s+/g," ").trim();if(name.length<8||name.length>160)continue;
      const c=classifyProduct(name);if(!COLLECTIBLE_CATALOG_TYPES.has(c.type))continue;
      const key=`${name}|text`;if(seen.has(key))continue;seen.add(key);out.push({name,url:null,classification:c});if(out.length>=80)break;
    }
  }
  return out;
}
function officialFeedSeedPayload(feed,x,now=new Date().toISOString()){
  const sp=specialistProfile(x.name,x.classification.type),ident=collectibleIdentityKey(x.name,x.classification.type,null);
  return {canonical_name_ja:x.name,canonical_name_en:null,manufacturer:feed.manufacturer,brand:sp.brand||null,series:sp.set_code||sp.lottery_series||null,franchise:sp.card_game||sp.collaboration||null,character_names:[],jan_code:null,model_number:sp.style_code||sp.card_number||null,product_type:x.classification.type,scale:sp.scale||null,edition:sp.edition||sp.rarity||null,limited_type:(sp.limited||sp.event_limited)?"limited":null,msrp_jpy:null,original_release_date:null,official_url:x.url||null,official_image_url:null,image_source_url:x.url||feed.listUrl,image_status:"pending",source_product_key:`officialfeed:${feed.slug}:${ident.fingerprint||simpleHash(x.name)}`,product_status:"active",identification_confidence:x.url?.74:.68,source_last_checked_at:now,metadata:{connector:"official_mass_feed",official_feed:true,official_feed_slug:feed.slug,official_feed_url:feed.listUrl,specialist_intelligence:true,specialist:sp,classification:{...x.classification,version:VERSION},canonical_identity_method:ident.identity_method,canonical_identity:ident.identity||null,canonical_fingerprint:ident.fingerprint||null,field_provenance:{canonical_name_ja:sourceEvidence(feed.slug,now),manufacturer:sourceEvidence(feed.slug,now)},quality_version:VERSION,ingestion_version:VERSION}};
}
async function patrolOfficialMassFeeds(env,limit=PIPELINE.officialMassFeedCron,options={}){
  const feed=deterministicWindow(OFFICIAL_MASS_FEEDS,1,options.timeMs||Date.now(),29)[0];
  if(!feed)return {status:"no_feeds"};
  const report={feed:feed.slug,manufacturer:feed.manufacturer,list_url:feed.listUrl,discovered:0,selected:0,inserted:0,existing:0,errors:[]};
  try{
    const page=await fetchOfficial(feed.listUrl),all=officialFeedAnchorCandidates(page.html,feed);report.discovered=all.length;
    const selected=deterministicWindow(all,Math.min(Math.max(1,Number(limit)||30),50),options.timeMs||Date.now(),31);report.selected=selected.length;
    if(!selected.length)return report;
    const payloads=selected.map(x=>officialFeedSeedPayload(feed,x));
    const existing=await loadProductsBySourceKeys(env,payloads.map(x=>x.source_product_key));const keys=new Set(existing.map(x=>String(x.source_product_key||"")));
    const missing=payloads.filter(x=>!keys.has(x.source_product_key));report.existing=payloads.length-missing.length;
    if(missing.length){const rows=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation,resolution=ignore-duplicates"},body:JSON.stringify(missing)});report.inserted=Array.isArray(rows)?rows.length:missing.length;}
  }catch(e){report.errors.push({error:safeError(e)});}
  return report;
}

const GOODSMILE_ARCHIVE_CATEGORIES=[
  {id:6,slug:"nendoroid",priority:100},
  {id:2,slug:"figma",priority:95},
  {id:1,slug:"scale",priority:100},
  {id:12,slug:"pop-up-parade",priority:98}
];

function htmlTextCompact(x){return decodeHtml(String(x||"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();}

function discoverGoodSmileArchiveCards(html,baseUrl){
  const out=[],seen=new Set();
  const re=/<a\b[^>]*href=["']([^"']*\/ja\/product\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const m of html.matchAll(re)){
    try{
      const url=canonicalOfficialUrl(new URL(decodeHtml(m[1]),baseUrl).toString());
      if(seen.has(url))continue;
      let name=htmlTextCompact(m[2]);
      if(!name||name.length<2)continue;
      name=name.replace(/\s+[\uffe5\u00a5]\s*[\d,]+.*$/," ").trim();
      if(!name||/^(?:\u8a73\u7d30|more|image)$/i.test(name))continue;
      seen.add(url);out.push({url,name});
    }catch{}
  }
  return out;
}

function archiveSeedPayload(card,category,page,now=new Date().toISOString()){
  const c=classifyProduct(card.name);
  return {canonical_name_ja:card.name,canonical_name_en:null,manufacturer:null,brand:null,series:null,franchise:null,character_names:[],jan_code:null,model_number:null,product_type:c.type,scale:null,edition:null,limited_type:null,msrp_jpy:null,original_release_date:null,official_url:card.url,official_image_url:null,image_source_url:null,image_status:"pending",source_product_key:`goodsmile:archive:${canonicalOfficialUrl(card.url)}`,product_status:"active",identification_confidence:.72,source_last_checked_at:now,metadata:{created_by:"v2.9.8_archive_discovery",archive_category:category.slug,archive_category_id:category.id,archive_page:page,archive_priority:category.priority,classification:{...c,version:VERSION},identity_quality_score:32,field_provenance:{canonical_name_ja:sourceEvidence("goodsmile_archive",now),official_url:sourceEvidence("goodsmile_archive",now)},ingestion_version:VERSION}};
}

async function archiveDiscoverGoodSmile(env,categoryId=6,page=1,limit=40){
  const category=GOODSMILE_ARCHIVE_CATEGORIES.find(x=>x.id===Number(categoryId))||GOODSMILE_ARCHIVE_CATEGORIES[0];
  const pg=Math.max(1,Math.min(999,Number(page)||1));
  const listUrl=`https://www.goodsmile.com/ja/search?search_category=${category.id}&page=${pg}`;
  const listing=await fetchOfficial(listUrl);
  const cards=discoverGoodSmileArchiveCards(listing.html,listing.url);
  const selected=cards.slice(0,Math.max(1,Math.min(50,Number(limit)||40)));
  if(!selected.length)return {category:category.slug,category_id:category.id,page:pg,list_url:listUrl,discovered:0,selected:0,inserted:0,existing:0,exhausted:true,errors:[]};
  const urls=selected.map(x=>canonicalOfficialUrl(x.url));
  const existingRows=await sbOptional(env,`/products?select=id,official_url&official_url=in.(${urls.map(x=>'"'+x.replace(/"/g,'')+'"').join(',')})&limit=100`)||[];
  const existing=new Set(existingRows.map(x=>canonicalOfficialUrl(x.official_url||"")));
  const missing=selected.filter(x=>!existing.has(canonicalOfficialUrl(x.url)));
  let inserted=0;const errors=[];
  if(missing.length){
    try{
      const now=new Date().toISOString(),payloads=missing.map(x=>archiveSeedPayload(x,category,pg,now));
      const rows=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation,resolution=ignore-duplicates"},body:JSON.stringify(payloads)});
      inserted=Array.isArray(rows)?rows.length:missing.length;
    }catch(e){errors.push({batch:true,error:safeError(e)});}
  }
  return {category:category.slug,category_id:category.id,page:pg,list_url:listUrl,discovered:cards.length,selected:selected.length,inserted,existing:selected.length-missing.length,exhausted:false,errors};
}

function invalidOfficialProductPage(connector,url,parsed){
  const u=canonicalOfficialUrl(url);
  const title=String(parsed?.canonical_name_ja||parsed?.canonical_name_en||"");
  if(connector?.slug==="kdcolle"&&(/\/product\/20\d{2}(?:\/\d{1,2})?$/.test(new URL(u).pathname.replace(/\/$/,""))||/\u691c\u7d22\u7d50\u679c/.test(title)))return "kdcolle_listing_or_archive";
  if(/(?:search|category|archive|products?)$/i.test(new URL(u).pathname.replace(/\/$/,"")))return "listing_or_archive";
  return null;
}

async function saveOfficialProduct(env,connector,url,parsed){
  const invalid=invalidOfficialProductPage(connector,url,parsed);
  if(invalid)throw new Error(`Rejected non-product official page: ${invalid}`);
  const jan=cleanJan(parsed.jan_code);
  let existing=[];
  if(jan)existing=await loadProductsByJans(env,[jan]);
  if(!existing.length){
    existing=await sbOptional(env,`/products?select=*&official_url=eq.${encodeURIComponent(canonicalOfficialUrl(url))}&limit=1`)||[];
  }
  const now=new Date().toISOString();
  const base=existing[0]||{};
  if(base.jan_code&&jan&&cleanJan(base.jan_code)!==jan&&base.canonical_name_ja&&!janNameCompatible(base.canonical_name_ja,parsed.canonical_name_ja))throw new Error("JAN/name conflict guard");
  const merged={...base,...parsed};
  const quality=identityQualityReasons(merged);
  const metadata={...(base.metadata||{}),...(parsed.metadata||{}),official_connector:connector.slug,quality_version:VERSION,identity_quality_score:quality.score,official_english_url:connector.slug==="goodsmile"?goodSmileEnglishUrl(url):base.metadata?.official_english_url||null,field_provenance:{...(base.metadata?.field_provenance||{}),official_url:sourceEvidence(connector.slug,now),jan_code:jan?sourceEvidence(connector.slug,now):base.metadata?.field_provenance?.jan_code}};
  const patch={
    canonical_name_ja:parsed.canonical_name_ja||base.canonical_name_ja,
    canonical_name_en:parsed.canonical_name_en||base.canonical_name_en,
    manufacturer:parsed.manufacturer||base.manufacturer,
    jan_code:jan||base.jan_code,
    msrp_jpy:parsed.msrp_jpy||base.msrp_jpy,
    original_release_date:parsed.original_release_date||base.original_release_date,
    official_url:parsed.official_url||base.official_url,
    official_image_url:parsed.official_image_url||base.official_image_url,
    source_product_key:parsed.source_product_key||base.source_product_key,
    product_type:parsed.product_type||base.product_type,
    product_status:parsed.product_status||base.product_status,
    identification_confidence:identificationConfidenceFor(merged),
    source_last_checked_at:now,
    metadata
  };
  if(base.id){
    await sb(env,`/products?id=eq.${encodeURIComponent(base.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(patch)});
    return {status:"updated",id:base.id};
  }
  const rows=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({...patch,brand:null,series:null,franchise:null,character_names:[],model_number:null,scale:null,edition:null,limited_type:null,image_source_url:parsed.official_image_url||null,image_status:parsed.official_image_url?"found":"pending"})});
  return {status:"inserted",id:rows?.[0]?.id||null};
}

async function refreshOfficialBatch(env,limit=2,options={}){
  const connectors=deterministicWindow(OFFICIAL_CONNECTORS,OFFICIAL_CONNECTORS.length,options.timeMs||Date.now(),3);
  const max=Math.max(1,Math.min(12,Number(limit)||4));
  const report=[];
  let processed=0;
  for(const connector of connectors){
    if(processed>=max)break;
    for(const listUrl of connector.listUrls){
      if(processed>=max)break;
      try{
        const listing=await fetchOfficial(listUrl);
        const links=discoverOfficialLinks(listing.html,listing.url,connector.detailRegex);
        const chosen=deterministicWindow(links,Math.min(3,max-processed),options.timeMs||Date.now(),processed+1);
        for(const url of chosen){
          if(processed>=max)break;
          try{
            const page=await fetchOfficial(url);
            const parsed=parseOfficial(connector,page.url,page.html);
            const saved=await saveOfficialProduct(env,connector,page.url,parsed);
            report.push({connector:connector.slug,url:page.url,...saved,jan_code:parsed.jan_code,name:parsed.canonical_name_ja});
          }catch(e){report.push({connector:connector.slug,url,error:safeError(e)});}
          processed++;
        }
      }catch(e){
        report.push({connector:connector.slug,list_url:listUrl,error:safeError(e),non_fatal:connector.slug==="kotobukiya"});
      }
    }
  }
  return report;
}

async function cleanupKnownBadOfficialRows(env){
  const rows=await sbOptional(env,"/products?select=id,canonical_name_ja,official_url,source_product_key&limit=1000");
  if(!Array.isArray(rows))return {scanned:0,deleted:0};
  const bad=rows.filter(p=>{
    const u=String(p.official_url||"");
    const n=String(p.canonical_name_ja||"");
    return /kdcolle\.kadokawa\.co\.jp\/product\/20\d{2}(?:\/\d{1,2})?\/?$/i.test(u)||(/\u691c\u7d22\u7d50\u679c/.test(n)&&/KDcolle|KADOKAWA/i.test(n));
  });
  let deleted=0;
  for(const p of bad){
    try{await sb(env,`/products?id=eq.${encodeURIComponent(p.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});deleted++;}catch{}
  }
  return {scanned:rows.length,found:bad.length,deleted};
}

function recentBackfillFailure(p){
  const t=p.metadata?.backfill_last_attempt_at;
  return t&&hoursSince(t)<PIPELINE.backfillRetryHours&&p.metadata?.backfill_last_error;
}

async function backfillOfficialDetails(env,limit=1){
  const candidates=await loadBackfillCandidates(env,500);
  const selected=candidates.filter(p=>!recentBackfillFailure(p)).slice(0,Math.max(1,Math.min(PIPELINE.backfillStandalone,Number(limit)||1)));
  const results=[];
  for(const p of selected){
    const now=new Date().toISOString();
    try{
      if(p.official_url){
        const connector=OFFICIAL_CONNECTORS.find(c=>c.detailRegex.test(p.official_url))||OFFICIAL_CONNECTORS[0];
        const page=await fetchOfficial(p.official_url);
        const parsed=parseOfficial(connector,page.url,page.html);
        if(parsed.jan_code&&cleanJan(parsed.jan_code)!==cleanJan(p.jan_code))throw new Error("Backfill JAN mismatch");
        await saveOfficialProduct(env,connector,page.url,{...parsed,jan_code:p.jan_code});
        results.push({id:p.id,status:"updated_from_official_url"});
        continue;
      }
      if(normalizedManufacturer(p.manufacturer)==="good smile company"||String(p.source_product_key||"").startsWith("goodsmile:")){
        const cal=await fetchGoodSmileCalendars();
        const rec=cal.merged.find(x=>x.jan_code===cleanJan(p.jan_code));
        if(rec){
          const patch={canonical_name_en:p.canonical_name_en||rec.name_en||null,original_release_date:p.original_release_date||rec.date||null,source_last_checked_at:now,metadata:{...(p.metadata||{}),backfill_last_attempt_at:now,backfill_last_error:null,calendar:{...(p.metadata?.calendar||{}),date:rec.date||p.metadata?.calendar?.date||null,rerelease_generation:rec.rerelease?"rerelease":p.metadata?.calendar?.rerelease_generation||"unknown"}}};
          await sb(env,`/products?id=eq.${encodeURIComponent(p.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(patch)});
          results.push({id:p.id,status:"calendar_backfilled"});
          continue;
        }
      }
      throw new Error("No safe official backfill match");
    }catch(e){
      await sbOptional(env,`/products?id=eq.${encodeURIComponent(p.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({metadata:{...(p.metadata||{}),backfill_last_attempt_at:now,backfill_last_error:safeError(e)}})});
      results.push({id:p.id,error:safeError(e)});
    }
  }
  return {selected:selected.length,results};
}

const MULTILINGUAL_PRODUCT_TYPE_ALIASES={
  "figure":["figure","figures","figurine","figurines","figura","figuras","figur","figuren","statuette","statue","\u30d5\u30a3\u30ae\u30e5\u30a2","\u624b\u529e","\u624b\u8fa6","\u516c\u4ed4","\ud53c\uaddc\uc5b4","figurka","\u0444\u0438\u0433\u0443\u0440\u043a\u0430","\u0444\u0438\u0433\u0443\u0440\u043a\u0438","\u0645\u062c\u0633\u0645","\u0645\u062c\u0633\u0645\u0627\u062a","\u062a\u0645\u062b\u0627\u0644","\u0641\u093f\u0917\u0930","\u092b\u093f\u0917\u0930","\u092e\u0942\u0930\u094d\u0924\u093f","figure anime","m\u00f4 h\u00ecnh","mo hinh","\u0e1f\u0e34\u0e01\u0e40\u0e01\u0e2d\u0e23\u0e4c","fig\u00fcr","figur","figuur"],
  "plush":["plush","plushie","plushies","stuffed toy","stuffed animal","soft toy","peluche","peluches","plushtier","plueschtier","pl\u00fcschtier","plush toy","stofftier","\u306c\u3044\u3050\u308b\u307f","\u30cc\u30a4\u30b0\u30eb\u30df","\u6bdb\u7ed2\u73a9\u5177","\u6bdb\u7d68\u73a9\u5177","\u7d68\u6bdb\u73a9\u5177","\ubd09\uc81c\uc778\ud615","\uc778\ud615","pelucia","pel\u00facia","\u043c\u044f\u0433\u043a\u0430\u044f \u0438\u0433\u0440\u0443\u0448\u043a\u0430","\u043c\u044f\u0433\u043a\u0438\u0435 \u0438\u0433\u0440\u0443\u0448\u043a\u0438","boneka","boneka plush","boneka lembut","\u0e15\u0e38\u0e4a\u0e01\u0e15\u0e32","\u0e15\u0e38\u0e4a\u0e01\u0e15\u0e32\u0e19\u0e38\u0e48\u0e21","\u0e15\u0e38\u0e4a\u0e01\u0e15\u0e32\u0e42\u0e1b\u0e40\u0e01\u0e21\u0e2d\u0e19","th\u00fa b\u00f4ng","thu bong","g\u1ea5u b\u00f4ng","gau bong","pelu\u015f","pelus","oyuncak pelu\u015f","knuffel","pluche","pluszak","pluszowa zabawka","\u062f\u0645\u064a\u0629 \u0645\u062d\u0634\u0648\u0629","\u0644\u0639\u0628\u0629 \u0645\u062d\u0634\u0648\u0629","\u062f\u0645\u064a\u0629","\u0938\u0949\u092b\u094d\u091f \u091f\u0949\u092f","\u092a\u094d\u0932\u0936","\u0916\u093f\u0932\u094c\u0928\u093e","\u092d\u0930\u0935\u093e\u0902 \u0916\u093f\u0932\u094c\u0928\u093e"],
  "trading_card":["trading card","trading cards","card game","tcg","carta","cartas","carte","cartes","sammelkarte","sammelkarten","\u30c8\u30ec\u30ab","\u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9","\u30ab\u30fc\u30c9","\u96c6\u6362\u5f0f\u5361\u724c","\u96c6\u63db\u5f0f\u5361\u724c","\u5361\u724c","\ud2b8\ub808\uc774\ub529 \uce74\ub4dc","\u043a\u043e\u043b\u043b\u0435\u043a\u0446\u0438\u043e\u043d\u043d\u044b\u0435 \u043a\u0430\u0440\u0442\u044b","\u0628\u0637\u0627\u0642\u0627\u062a \u062a\u062f\u0627\u0648\u0644","\u091f\u094d\u0930\u0947\u0921\u093f\u0902\u0917 \u0915\u093e\u0930\u094d\u0921"],
  "model_kit":["model kit","model kits","gunpla","plastic model","maquette","kit maquette","maqueta","bausatz","modellbausatz","\u30d7\u30e9\u30e2\u30c7\u30eb","\u30ac\u30f3\u30d7\u30e9","\u6a21\u578b\u5957\u4ef6","\u6a21\u578b","\ud504\ub77c\ubaa8\ub378","\uac74\ud504\ub77c","\u043c\u043e\u0434\u0435\u043b\u044c \u0434\u043b\u044f \u0441\u0431\u043e\u0440\u043a\u0438","\u0645\u062c\u0633\u0645 \u062a\u0631\u0643\u064a\u0628","\u092e\u0949\u0921\u0932 \u0915\u093f\u091f"],
  "acrylic_goods":["acrylic stand","acrylic stands","acrylic figure","acrylic goods","acrylic","standee","standees","acrilico","acr\u00edlico","acrylique","acryl","\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9","\u30a2\u30af\u30b9\u30bf","\u4e9a\u514b\u529b\u7acb\u724c","\u4e9e\u514b\u529b\u7acb\u724c","\uc544\ud06c\ub9b4 \uc2a4\ud0e0\ub4dc","acrylic standee"],
  "keychain":["keychain","keychains","key ring","keyring","llavero","llaveros","porte-cles","porte-cl\u00e9s","schluesselanhaenger","schl\u00fcsselanh\u00e4nger","\u30ad\u30fc\u30db\u30eb\u30c0\u30fc","\u94a5\u5319\u6263","\u9470\u5319\u6263","\ud0a4\ub9c1","\u0431\u0440\u0435\u043b\u043e\u043a","\u0645\u064a\u062f\u0627\u0644\u064a\u0629 \u0645\u0641\u0627\u062a\u064a\u062d","\u0915\u0940\u091a\u0947\u0928"],
  "badge":["badge","badges","pin badge","button badge","pin","pins","chapa","chapas","badge anime","anstecker","\u7f36\u30d0\u30c3\u30b8","\u5fbd\u7ae0","\u80f8\u7ae0","\uce94\ubc43\uc9c0","\u0437\u043d\u0430\u0447\u043e\u043a","\u0634\u0627\u0631\u0629","\u092c\u0948\u091c"],
  "lottery_prize":["lottery prize","prize figure","ichiban kuji","ichibankuji","kuji","prize","lottery","\u4e00\u756a\u304f\u3058","\u304f\u3058","\u30d7\u30e9\u30a4\u30ba","\u666f\u54c1","\u4e00\u756a\u8d4f","\u4e00\u756a\u8cde","\u62bd\u5956\u5956\u54c1","\u62bd\u734e\u734e\u54c1","\uc81c\uc77c\ubcf5\uad8c","\ubcf5\uad8c \uacbd\ud488"],
  "sneaker":["sneaker","sneakers","shoe","shoes","zapatilla","zapatillas","basket","baskets","sneaker anime","\u30b9\u30cb\u30fc\u30ab\u30fc","\u9774","\u8fd0\u52a8\u978b","\u904b\u52d5\u978b","\uc6b4\ub3d9\ud654","\u043a\u0440\u043e\u0441\u0441\u043e\u0432\u043a\u0438"],
  "apparel":["apparel","clothing","shirt","t-shirt","hoodie","jacket","ropa","camiseta","sweat","vetement","v\u00eatement","kleidung","\u30a2\u30d1\u30ec\u30eb","T\u30b7\u30e3\u30c4","\u30d1\u30fc\u30ab\u30fc","\u8863\u670d","\u670d\u88c5","\uc758\ub958","\u043e\u0434\u0435\u0436\u0434\u0430"]
}
const MULTILINGUAL_FRANCHISE_ALIASES={"Pokemon":["Pokemon","Pok\u00e9mon","\u30dd\u30b1\u30e2\u30f3","\u30dd\u30b1\u30c3\u30c8\u30e2\u30f3\u30b9\u30bf\u30fc","\u5b9d\u53ef\u68a6","\u5bf6\u53ef\u5922","\u795e\u5947\u5b9d\u8d1d","\u795e\u5947\u5bf6\u8c9d","\ud3ec\ucf13\ubaac","\u0e42\u0e1b\u0e40\u0e01\u0e21\u0e2d\u0e19","\u0628\u0648\u0643\u064a\u0645\u0648\u0646","\u092a\u094b\u0915\u0947\u092e\u094b\u0928"],"ONE PIECE":["ONE PIECE","One Piece","\u30ef\u30f3\u30d4\u30fc\u30b9","\u6d77\u8d3c\u738b","\u6d77\u8cca\u738b","\u822a\u6d77\u738b","\uc6d0\ud53c\uc2a4"],"Hatsune Miku":["Hatsune Miku","\u521d\u97f3\u30df\u30af","\u521d\u97f3\u672a\u6765","\u521d\u97f3\u672a\u4f86","\ud558\uce20\ub124 \ubbf8\ucfe0"],"Gundam":["Gundam","\u30ac\u30f3\u30c0\u30e0","\u9ad8\u8fbe","\u9ad8\u9054","\uac74\ub2f4"],"Dragon Ball":["Dragon Ball","\u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30eb","\u9f99\u73e0","\u9f8d\u73e0","\ub4dc\ub798\uace4\ubcfc"],"Demon Slayer":["Demon Slayer","Kimetsu no Yaiba","\u9b3c\u6ec5\u306e\u5203","\u9b3c\u706d\u4e4b\u5203","\uadc0\uba78\uc758 \uce7c\ub0a0"],"Jujutsu Kaisen":["Jujutsu Kaisen","\u546a\u8853\u5efb\u6226","\u5492\u672f\u56de\u6218","\u5492\u8853\u8ff4\u6230","\uc8fc\uc220\ud68c\uc804"],"NARUTO":["NARUTO","Naruto","\u30ca\u30eb\u30c8","\u706b\u5f71\u5fcd\u8005","\ub098\ub8e8\ud1a0"],"BLEACH":["BLEACH","Bleach","\u30d6\u30ea\u30fc\u30c1","\u6b7b\u795e","\ube14\ub9ac\uce58"],"My Hero Academia":["My Hero Academia","Boku no Hero Academia","\u50d5\u306e\u30d2\u30fc\u30ed\u30fc\u30a2\u30ab\u30c7\u30df\u30a2","\u6211\u7684\u82f1\u96c4\u5b66\u9662","\u6211\u7684\u82f1\u96c4\u5b78\u9662","\ub098\uc758 \ud788\uc5b4\ub85c \uc544\uce74\ub370\ubbf8\uc544"],"Attack on Titan":["Attack on Titan","Shingeki no Kyojin","\u9032\u6483\u306e\u5de8\u4eba","\u8fdb\u51fb\u7684\u5de8\u4eba","\u9032\u64ca\u7684\u5de8\u4eba","\uc9c4\uaca9\uc758 \uac70\uc778"],"Evangelion":["Evangelion","\u30a8\u30f4\u30a1\u30f3\u30b2\u30ea\u30aa\u30f3","EVA","\u65b0\u4e16\u7eaa\u798f\u97f3\u6218\u58eb","\u65b0\u4e16\u7d00\u798f\u97f3\u6230\u58eb","\uc5d0\ubc18\uac8c\ub9ac\uc628"],"Fate":["Fate","\u30d5\u30a7\u30a4\u30c8"],"Hololive":["Hololive","\u30db\u30ed\u30e9\u30a4\u30d6","\ud640\ub85c\ub77c\uc774\ube0c"],"Genshin Impact":["Genshin Impact","\u539f\u795e","\uc6d0\uc2e0"],"Honkai Star Rail":["Honkai Star Rail","Honkai: Star Rail","\u5d29\u58ca\u30b9\u30bf\u30fc\u30ec\u30a4\u30eb","\u5d29\u574f\u661f\u7a79\u94c1\u9053","\u5d29\u58de\u661f\u7a79\u9435\u9053","\ubd95\uad34 \uc2a4\ud0c0\ub808\uc77c"],"Blue Archive":["Blue Archive","\u30d6\u30eb\u30fc\u30a2\u30fc\u30ab\u30a4\u30d6","\u78a7\u84dd\u6863\u6848","\u851a\u85cd\u6a94\u6848","\ube14\ub8e8 \uc544\uce74\uc774\ube0c"],"Uma Musume":["Uma Musume","\u30a6\u30de\u5a18","\u8d5b\u9a6c\u5a18","\u8cfd\u99ac\u5a18","\uc6b0\ub9c8\ubb34\uc2a4\uba54"],"Love Live":["Love Live","\u30e9\u30d6\u30e9\u30a4\u30d6","\ub7ec\ube0c\ub77c\uc774\ube0c"],"Haikyu":["Haikyu","Haikyuu","\u30cf\u30a4\u30ad\u30e5\u30fc","\u6392\u7403\u5c11\u5e74","\ud558\uc774\ud050"],"Detective Conan":["Detective Conan","Case Closed","\u540d\u63a2\u5075\u30b3\u30ca\u30f3","\u540d\u4fa6\u63a2\u67ef\u5357","\u540d\u5075\u63a2\u67ef\u5357","\uba85\ud0d0\uc815 \ucf54\ub09c"],"Frieren":["Frieren","\u846c\u9001\u306e\u30d5\u30ea\u30fc\u30ec\u30f3","\u846c\u9001\u7684\u8299\u8389\u83b2","\u846c\u9001\u7684\u8299\u8389\u84ee","\uc7a5\uc1a1\uc758 \ud504\ub9ac\ub80c"]};
const MULTILINGUAL_GENERIC_TERMS=["anime","animation","manga","collectible","collectibles","merch","merchandise","goods","stuff","toys","toy","character goods","character merchandise","japanese","japan","recommend","recommendation","best","buy","find","search","looking for","want","please","gift","gifts","cool","popular","cheap","rare","\u30a2\u30cb\u30e1","\u30b0\u30c3\u30ba","\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30b0\u30c3\u30ba","\u304a\u3059\u3059\u3081","\u63a2\u3057\u3066","\u6b32\u3057\u3044","\u30c8\u30a4","\u304a\u3082\u3061\u3083","\u52d5\u6f2b","\u52a8\u6f2b","\u5468\u8fb9","\u5468\u908a","\u5468\u8fb9\u5546\u54c1","\u5468\u908a\u5546\u54c1","\u73a9\u5177","\u63a8\u8350","\u63a8\u85a6","\ucc3e\uc544","\ucd94\ucc9c","\uc560\ub2c8","\uad7f\uc988","\uc7a5\ub09c\uac10","figurine anime","figura anime","figura de anime","anime figur","anime figurine","anime figure","anime merch","merch anime","produits anime","produits derives anime","objets anime","merchandising anime","productos anime","merch de anime","productos de anime","anime artikel","anime merch artikel","anime waren","anime merchandise","prodotti anime","prodotti manga","produtos anime","merch de anime","\u0430\u043d\u0438\u043c\u0435","\u0430\u043d\u0438\u043c\u0435 \u043c\u0435\u0440\u0447","coleccionable","coleccionables","objet de collection","sammlerstueck","sammlerst\u00fcck","merch anime indonesia","barang anime","merch anime thailand","\u0e02\u0e2d\u0e07\u0e2a\u0e30\u0e2a\u0e21\u0e2d\u0e19\u0e34\u0e40\u0e21\u0e30","\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e2d\u0e19\u0e34\u0e40\u0e21\u0e30","\u0111\u1ed3 ch\u01a1i anime","do choi anime","h\u00e0ng anime","anime \u00fcr\u00fcnleri","anime urunleri","anime merch nederland","anime spullen","gad\u017cet anime","gadzet anime","produkty anime","\u0645\u0646\u062a\u062c\u0627\u062a \u0627\u0644\u0623\u0646\u0645\u064a","\u0628\u0636\u0627\u0626\u0639 \u0627\u0644\u0623\u0646\u0645\u064a","\u0627\u0646\u0645\u064a","\u090f\u0928\u0940\u092e\u0947 \u092e\u0930\u094d\u091a","\u090f\u0928\u0940\u092e\u0947 \u0938\u093e\u092e\u093e\u0928","\u090f\u0928\u0940\u092e\u0947 \u0916\u093f\u0932\u094c\u0928\u0947"];
const GLOBAL_VAGUE_INTENT_TERMS=["anime","anime merch","anime merchandise","anime goods","anime stuff","anime toys","manga merch","character goods","Japanese collectibles","Pokemon","Pokemon merch","Pokemon stuff","Pokemon toys","ONE PIECE","One Piece merch","Nendoroid","Gunpla","\u30a2\u30cb\u30e1","\u30a2\u30cb\u30e1 \u30b0\u30c3\u30ba","\u30dd\u30b1\u30e2\u30f3 \u30b0\u30c3\u30ba","\u30ef\u30f3\u30d4\u30fc\u30b9 \u30b0\u30c3\u30ba","figurine manga","produits anime","merch anime","peluche Pokemon","figuras anime","merch de anime","productos anime","Anime Figuren","Anime Merch","Pokemon Pluesch","prodotti anime","produtos anime","merch de anime","\u52a8\u6f2b\u5468\u8fb9","\u52a8\u6f2b\u624b\u529e","\u5b9d\u53ef\u68a6\u5468\u8fb9","\u52d5\u6f2b\u5468\u908a","\u5bf6\u53ef\u5922\u5468\u908a","\uc560\ub2c8 \uad7f\uc988","\ud3ec\ucf13\ubaac \uad7f\uc988","\u0430\u043d\u0438\u043c\u0435 \u043c\u0435\u0440\u0447","\u0645\u0646\u062a\u062c\u0627\u062a \u0627\u0644\u0623\u0646\u0645\u064a","\u090f\u0928\u0940\u092e\u0947 \u092e\u0930\u094d\u091a","merch anime indonesia","merch anime thailand","do choi anime","anime urunleri","anime merch nederland","gadzet anime"];

const PRODUCT_TYPE_SEARCH_EQUIVALENTS={figure:["figure","nendoroid","figma"],plush:["plush"],trading_card:["trading_card"],model_kit:["model_kit"],acrylic_goods:["acrylic_goods"],keychain:["keychain"],badge:["badge"],lottery_prize:["lottery_prize"],sneaker:["sneaker"],apparel:["apparel"]};

function normalizedSearchPhrase(v){return foldLatinForSearch(String(v||"").normalize("NFKC")).replace(/[\u2010-\u2015_\/\|,.;:!?()[\]{}\'"`~@#$%^&*+=<>]/g," ").replace(/\s+/g," ").trim();}
function phraseIncludes(haystack,needle){const h=normalizedSearchPhrase(haystack),n=normalizedSearchPhrase(needle);return !!n&&h.includes(n);}
function multilingualQueryHints(query=""){
  const raw=String(query||"").trim(),normalized=normalizedSearchPhrase(raw),productTypes=[],franchiseGroups=[];
  for(const [type,aliases] of Object.entries(MULTILINGUAL_PRODUCT_TYPE_ALIASES))if(aliases.some(a=>phraseIncludes(normalized,a)))productTypes.push(type);
  for(const [canonical,aliases] of Object.entries(MULTILINGUAL_FRANCHISE_ALIASES))if(aliases.some(a=>phraseIncludes(normalized,a)))franchiseGroups.push({canonical,aliases});
  let residual=` ${normalized} `;
  const removable=[...MULTILINGUAL_GENERIC_TERMS,...Object.values(MULTILINGUAL_PRODUCT_TYPE_ALIASES).flat()];
  for(const term of removable){const n=normalizedSearchPhrase(term);if(n)residual=residual.split(n).join(" ");}
  for(const g of franchiseGroups)for(const term of g.aliases){const n=normalizedSearchPhrase(term);if(n)residual=residual.split(n).join(" ");}
  const residualTerms=[...new Set(residual.replace(/\s+/g," ").trim().split(" ").filter(x=>x.length>=2))].slice(0,4);
  const generic_intent=GLOBAL_VAGUE_INTENT_TERMS.some(t=>phraseIncludes(normalized,t))||MULTILINGUAL_GENERIC_TERMS.some(t=>normalizedSearchPhrase(t)===normalized); return {language:detectSearchLanguage(raw),product_types:[...new Set(productTypes)],franchises:franchiseGroups.map(g=>g.canonical),franchise_aliases:[...new Set(franchiseGroups.flatMap(g=>g.aliases))].slice(0,12),residual_terms:residualTerms,ambiguous_category_search:productTypes.length>0&&franchiseGroups.length===0&&residualTerms.length===0,generic_intent};
}
function safeSearchTerm(v){return String(v||"").replace(/[,%()]/g," ").replace(/\s+/g," ").trim().slice(0,80);}
function mergeUniqueProducts(groups=[],limit=10){const out=[],seen=new Set();for(const rows of groups){for(const p of (Array.isArray(rows)?rows:[])){if(!p?.id||seen.has(p.id))continue;seen.add(p.id);out.push(p);if(out.length>=limit)return out;}}return out;}

function cleanNullishValue(v){const s=String(v??"").trim();return !s||s.toLowerCase()==="null"||s.toLowerCase()==="undefined"?null:v;}
function cleanNullableTitle(v){const x=cleanNullishValue(v);return x===null?null:cleanOfficialTitle(x);}
function discoveryTitle(p){return `${cleanNullishValue(p?.canonical_name_ja)||""} ${cleanNullishValue(p?.canonical_name_en)||""}`.trim();}
function discoveryClassifier(p){return classifyProduct(discoveryTitle(p));}
const DISCOVERY_FRANCHISE_HINTS=[
  ["JoJo's Bizarre Adventure",["\u30b8\u30e7\u30b8\u30e7\u306e\u5947\u5999\u306a\u5192\u967a","jojo","steel ball run","\u30b9\u30c6\u30a3\u30fc\u30eb\u30fb\u30dc\u30fc\u30eb\u30fb\u30e9\u30f3"]],
  ["Rurouni Kenshin",["\u308b\u308d\u3046\u306b\u5263\u5fc3","rurouni kenshin"]],
  ["Monster Hunter",["monster hunter","\u30e2\u30f3\u30b9\u30bf\u30fc\u30cf\u30f3\u30bf\u30fc","\u602a\u7269\u730e\u4eba","\u602a\u7269\u7375\u4eba"]],
  ["Sword Art Online",["sword art online","\u30bd\u30fc\u30c9\u30a2\u30fc\u30c8\u30fb\u30aa\u30f3\u30e9\u30a4\u30f3","sao"]],
  ["Chainsaw Man",["chainsaw man","\u30c1\u30a7\u30f3\u30bd\u30fc\u30de\u30f3","\u94fe\u952f\u4eba","\u93c8\u92f8\u4eba"]],
  ["Blue Lock",["blue lock","\u30d6\u30eb\u30fc\u30ed\u30c3\u30af"]],
  ["Spy x Family",["spy x family","spy\u00d7family","\u30b9\u30d1\u30a4\u30d5\u30a1\u30df\u30ea\u30fc"]],
  ["Oshi no Ko",["oshi no ko","\u3010\u63a8\u3057\u306e\u5b50\u3011","\u63a8\u3057\u306e\u5b50"]],
  ["Re:ZERO",["re:zero","re zero","\u30ea\u30bc\u30ed"]],
  ["Puella Magi Madoka Magica",["madoka magica","\u9b54\u6cd5\u5c11\u5973\u307e\u3069\u304b\u2606\u30de\u30ae\u30ab","\u307e\u3069\u30de\u30ae"]],
  ["Pretty Cure",["pretty cure","precure","\u30d7\u30ea\u30ad\u30e5\u30a2"]]
];
function titleInferredDiscoveryFranchise(p){
  const title=normalizedSearchPhrase(discoveryTitle(p));
  for(const [canonical,aliases] of Object.entries(MULTILINGUAL_FRANCHISE_ALIASES))if(aliases.some(a=>phraseIncludes(title,a)))return canonical;
  for(const [canonical,aliases] of DISCOVERY_FRANCHISE_HINTS)if(aliases.some(a=>phraseIncludes(title,a)))return canonical;
  return null;
}
function storedDiscoveryFranchiseIsFalsePositive(p,stored){
  const f=String(stored||"").trim(),title=String(cleanNullishValue(p?.canonical_name_ja)||"");
  if(f.toUpperCase()==="ONE PIECE"){
    const explicit=/one\s*piece/i.test(title)||/(?:\u6d77\u8cca\u738b|\u822a\u6d77\u738b|\u30eb\u30d5\u30a3|\u9ea6\u308f\u3089)/i.test(title);
    const garment=/(?:\u304a\u3067\u304b\u3051|\u30b5\u30de\u30fc|\u30c9\u30ec\u30b9|ver\.?|\u8863\u88c5|\u6d0b\u670d|\u30ef\u30f3\u30d4\u30fc\u30b9\s*(?:\u30b9\u30da\u30b7\u30e3\u30eb|\u30bb\u30c3\u30c8|\u670d))/i.test(title);
    if(!explicit&&garment)return true;
  }
  return false;
}
function inferredDiscoveryFranchise(p){
  const stored=cleanNullishValue(p?.franchise);
  if(stored&&!storedDiscoveryFranchiseIsFalsePositive(p,stored))return stored;
  return titleInferredDiscoveryFranchise(p);
}
function broadDiscoveryEligible(p){
  if(!p?.id)return false;
  const quality=Number(marketIdentityQuality(p)||0),stored=String(p.product_type||""),cls=discoveryClassifier(p),franchise=discoverySafeFranchise(p),title=normalizedSearchPhrase(discoveryTitle(p));
  if(quality<30)return false;
  if(/(?:\bcd\b|dvd|blu[ -]?ray|soundtrack|\u30b5\u30f3\u30c8\u30e9|\u521d\u56de\u751f\u7523\u9650\u5b9a\u76e4)/i.test(title)&&!franchise)return false;
  // Apparel and sneakers are noisy marketplace categories. Broad discovery only keeps them when a recognizable character/IP is present.
  if((stored==="apparel"||stored==="sneaker")&&!franchise)return false;
  if((stored==="apparel"||stored==="sneaker")&&/(?:cosplay|\u30b3\u30b9\u30d7\u30ec|\u4eee\u88c5|\u8863\u88c5\s*(?:\u30a6\u30a3\u30c3\u30b0|\u9774)|halloween)/i.test(title))return false;
  if((stored==="apparel"||stored==="sneaker")&&cls.type==="other"&&!franchise)return false;
  if(cls.confidence>=.94&&cls.type!=="other"&&stored&&cls.type!==stored&&!["figure","nendoroid","figma"].includes(stored))return false;
  return true;
}
function broadDiscoveryScore(p){
  let score=Number(marketIdentityQuality(p)||0);const cls=discoveryClassifier(p),stored=String(p?.product_type||"");
  if(cleanNullishValue(p?.franchise))score+=12;
  if(cleanNullishValue(p?.canonical_name_en))score+=8;
  if(p?.official_url)score+=6;
  if(p?.official_image_url)score+=6;
  if(p?.jan_code)score+=4;
  if(p?.original_release_date)score+=3;
  if(p?.msrp_jpy)score+=2;
  if(cls.type===stored&&cls.confidence>=.94)score+=10;
  if(cls.confidence>=.94&&cls.type!=="other"&&stored&&cls.type!==stored)score-=25;
  return score;
}
function discoveryEffectiveType(p){const cls=discoveryClassifier(p),stored=String(p?.product_type||"other");return cls.confidence>=.94&&cls.type!=="other"?cls.type:stored;}
function discoverySafeFranchise(p){
  const f=cleanNullishValue(p?.franchise);
  if(f&&!storedDiscoveryFranchiseIsFalsePositive(p,f))return f;
  return titleInferredDiscoveryFranchise(p);
}
function diversifyBroadDiscoveryProducts(rows=[],limit=10){
  const ranked=[...(Array.isArray(rows)?rows:[])].filter(broadDiscoveryEligible).sort((a,b)=>broadDiscoveryScore(b)-broadDiscoveryScore(a));
  const out=[],seenIds=new Set(),seenTypes=new Set(),seenFranchises=new Set(),franchiseCounts=new Map();
  const add=p=>{if(!p?.id||seenIds.has(p.id))return false;const t=discoveryEffectiveType(p),f=discoverySafeFranchise(p),fk=normalizedSearchPhrase(f||"");seenIds.add(p.id);seenTypes.add(t);if(fk){seenFranchises.add(fk);franchiseCounts.set(fk,(franchiseCounts.get(fk)||0)+1);}out.push(p);return true;};
  // Pass 1: maximize both category and IP diversity. Do not spend several category slots on one franchise.
  for(const p of ranked){const t=discoveryEffectiveType(p),f=discoverySafeFranchise(p),fk=normalizedSearchPhrase(f||"");if(seenTypes.has(t))continue;if(fk&&seenFranchises.has(fk))continue;add(p);if(out.length>=limit)return out;}
  // Pass 2: add unseen franchises even when the product category repeats.
  for(const p of ranked){if(seenIds.has(p.id))continue;const fk=normalizedSearchPhrase(discoverySafeFranchise(p)||"");if(!fk||seenFranchises.has(fk))continue;add(p);if(out.length>=limit)return out;}
  // Pass 3: fill missing product categories, but cap any one franchise at two results.
  for(const p of ranked){if(seenIds.has(p.id))continue;const t=discoveryEffectiveType(p),fk=normalizedSearchPhrase(discoverySafeFranchise(p)||"");if(seenTypes.has(t))continue;if(fk&&(franchiseCounts.get(fk)||0)>=2)continue;add(p);if(out.length>=limit)return out;}
  // Pass 4: quality fill with a hard two-result cap per franchise to prevent JoJo/Pokemon/etc. domination.
  for(const p of ranked){if(seenIds.has(p.id))continue;const fk=normalizedSearchPhrase(discoverySafeFranchise(p)||"");if(fk&&(franchiseCounts.get(fk)||0)>=2)continue;add(p);if(out.length>=limit)return out;}
  // Last resort only if the catalog slice is unusually narrow.
  for(const p of ranked){if(seenIds.has(p.id))continue;add(p);if(out.length>=limit)return out;}
  return out;
}
async function broadCatalogDiscovery(env,limit=10){
  const clusters=[
    "figure,nendoroid,figma,model_kit",
    "plush,trading_card",
    "acrylic_goods,keychain,badge,lottery_prize",
    "sneaker,apparel"
  ];
  const groups=[];
  for(const cluster of clusters){
    const rows=await sbOptional(env,`/products?select=*&product_type=in.(${cluster})&official_image_url=not.is.null&limit=160`);
    groups.push(Array.isArray(rows)?rows:[]);
  }
  return diversifyBroadDiscoveryProducts(groups.flat(),limit);
}

/* =========================================================
   PRODUCT SEARCH
========================================================= */


function canonicalizeDiscoveryFranchise(v){
  const n=normalizedSearchPhrase(v);
  if(!n)return null;
  for(const [canonical,aliases] of Object.entries(MULTILINGUAL_FRANCHISE_ALIASES)){
    if(normalizedSearchPhrase(canonical)===n||aliases.some(a=>normalizedSearchPhrase(a)===n))return canonical;
  }
  return String(v||"").trim()||null;
}
function discoveryTypeMatchesHint(actual,hint){
  const a=String(actual||"").toLowerCase(),h=String(hint||"").toLowerCase();
  if(!a||!h)return false;
  if(a===h)return true;
  const equivalents=new Set((PRODUCT_TYPE_SEARCH_EQUIVALENTS[h]||[h]).map(x=>String(x).toLowerCase()));
  return equivalents.has(a);
}
function discoveryProductFitScore(p,hints,query=""){
  let score=broadDiscoveryScore(p);
  const actualType=discoveryEffectiveType(p),actualFranchise=canonicalizeDiscoveryFranchise(discoverySafeFranchise(p));
  const wantedTypes=hints?.product_types||[],wantedFranchises=(hints?.franchises||[]).map(canonicalizeDiscoveryFranchise);
  if(wantedTypes.length)score+=wantedTypes.some(t=>discoveryTypeMatchesHint(actualType,t))?140:-220;
  if(wantedFranchises.length)score+=wantedFranchises.some(f=>String(f||"").toLowerCase()===String(actualFranchise||"").toLowerCase())?160:-260;
  const title=normalizedSearchPhrase(discoveryTitle(p));
  for(const term of (hints?.residual_terms||[]))if(phraseIncludes(title,term))score+=24;
  const qn=normalizedSearchPhrase(query);
  if(qn&&phraseIncludes(title,qn))score+=80;
  return score;
}
function rankAndFilterDiscoveryProducts(rows=[],hints={},query="",limit=10){
  const structured=(hints.product_types?.length||0)+(hints.franchises?.length||0)>0;
  const scored=(Array.isArray(rows)?rows:[]).filter(p=>p?.id).map(p=>({
    p,
    score:discoveryProductFitScore(p,hints,query),
    type_ok:!hints.product_types?.length||hints.product_types.some(t=>discoveryTypeMatchesHint(discoveryEffectiveType(p),t)),
    franchise_ok:!hints.franchises?.length||hints.franchises.map(canonicalizeDiscoveryFranchise).some(f=>String(f||"").toLowerCase()===String(canonicalizeDiscoveryFranchise(discoverySafeFranchise(p))||"").toLowerCase())
  }));
  const filtered=structured?scored.filter(x=>x.type_ok&&x.franchise_ok):scored;
  return (filtered.length?filtered:scored).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.p);
}

async function findProducts(env,q="",limit=10){
  const query=String(q||"").trim();
  if(!query)return [];
  const jan=cleanJan(query);
  if(jan){const exact=await loadProductsByJans(env,[jan]);if(exact.length)return exact.slice(0,limit);}
  const hints=multilingualQueryHints(query),groups=[];
  const dbTypes=[...new Set(hints.product_types.flatMap(t=>PRODUCT_TYPE_SEARCH_EQUIVALENTS[t]||[t]))];
  const semanticTerms=[...new Set([...hints.franchise_aliases,...hints.residual_terms].map(safeSearchTerm).filter(Boolean))].slice(0,12);
  const structured=dbTypes.length||hints.franchises.length;

  // For recognized multilingual category/franchise intents, query canonical DB fields directly.
  // This avoids wasting one Supabase request on the untranslated raw phrase and keeps WORLD AUDIT under subrequest limits.
  if(dbTypes.length||semanticTerms.length){
    let path="/products?select=*";
    if(dbTypes.length)path+=`&product_type=in.(${dbTypes.map(x=>encodeURIComponent(x)).join(",")})`;
    if(semanticTerms.length){
      const fields=["canonical_name_ja","canonical_name_en","franchise","manufacturer","brand","series"];
      const clauses=[];
      for(const term of semanticTerms.slice(0,8))for(const field of fields)clauses.push(`${field}.ilike.*${term}*`);
      path+=`&or=(${encodeURIComponent(clauses.join(","))})`;
    }
    path+=`&limit=${Math.max(20,Math.min(50,limit*4))}`;
    groups.push(await sbOptional(env,path));
  }

  // Raw text fallback remains for exact names, model numbers and queries that could not be semantically normalized.
  if(!structured||hints.residual_terms.length){
    const escaped=safeSearchTerm(query);
    if(escaped){
      const directOr=["canonical_name_ja","canonical_name_en","franchise","manufacturer","brand","series","model_number"].map(k=>`${k}.ilike.*${escaped}*`).join(",");
      groups.push(await sbOptional(env,`/products?select=*&or=(${encodeURIComponent(directOr)})&limit=${Math.max(10,Math.min(30,limit*3))}`));
    }
  }

  if(hints.generic_intent&&!dbTypes.length&&!semanticTerms.length){
    groups.unshift(await broadCatalogDiscovery(env,Math.max(10,Math.min(20,limit))));
  }
  const merged=mergeUniqueProducts(groups,Math.max(30,limit*4));
  return rankAndFilterDiscoveryProducts(merged,hints,query,limit);
}

async function resolveProduct(env,url){
  const id=url.searchParams.get("id");
  if(id){
    const rows=await sbOptional(env,`/products?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    if(Array.isArray(rows)&&rows.length)return rows[0];
  }
  const q=url.searchParams.get("query")||"";
  const rows=await findProducts(env,q,5);
  return rows[0]||null;
}

/* =========================================================
   MARKET SELECTION
========================================================= */

function marketEligible(p){
  const q=marketIdentityQuality(p),special=productSpecialistProfile(p);
  const hasSpecial=Object.values(special||{}).some(v=>v!==null&&v!==""&&v!==false&&v!==undefined);
  return q>=categoryMarketThreshold(p)||(hasSpecial&&q>=30);
}

function marketPriority(p,history=[],source="yahoo"){
  const relevant=history.filter(o=>o.product_id===p.id&&o.metadata?.market_source===source);
  const newest=relevant[0]?.observed_at||null;
  let score=0;
  if(!relevant.length)score+=100;
  if(hoursSince(newest)>PIPELINE.marketAutoRefreshHours)score+=50;
  if(p.product_status==="preorder")score+=15;
  if(p.jan_code)score+=12;
  if(p.canonical_name_en)score+=6;
  if(p.official_url)score+=6;
  if(p.model_number)score+=8;
  score+=marketIdentityQuality(p)/10;
  if(hoursSince(p.metadata?.market_attempts?.[source]?.at)>PIPELINE.marketRetryHours)score+=5;
  return score;
}

async function selectMarketProducts(env,history=[],limit=2,products=null,source="yahoo"){
  const pool=Array.isArray(products)&&products.length?products:await loadProductCandidates(env,500);
  return pool.filter(marketEligible).sort((a,b)=>marketPriority(b,history,source)-marketPriority(a,history,source)).slice(0,limit);
}

async function markMarketAttempt(env,p,source,detail={}){
  const metadata={...(p.metadata||{}),market_attempts:{...(p.metadata?.market_attempts||{}),[source]:{at:new Date().toISOString(),...detail}}};
  await sbOptional(env,`/products?id=eq.${encodeURIComponent(p.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({metadata})});
}

/* =========================================================
   YAHOO SHOPPING
========================================================= */

function isYahoo403Error(error){return /(?:^|\b)Yahoo\s+403\b/i.test(safeError(error));}
const YAHOO_CATALOG_COOLDOWN_MINUTES=30;
async function yahooCatalogCooldownState(env){
  const rows=await sbOptional(env,"/api_events?select=occurred_at,metadata&event_type=eq.yahoo_catalog_cooldown&order=occurred_at.desc&limit=1");
  const row=Array.isArray(rows)&&rows.length?rows[0]:null,m=row?.metadata||null;
  if(!m?.until)return {active:false,until:null,reason:null,last_error:null};
  const untilMs=Date.parse(m.until)||0;
  return {active:untilMs>Date.now(),until:m.until,reason:m.reason||null,last_error:m.last_error||null,occurred_at:row?.occurred_at||null};
}
async function setYahooCatalogCooldown(env,error,minutes=YAHOO_CATALOG_COOLDOWN_MINUTES){
  const now=Date.now(),until=new Date(now+Math.max(5,Number(minutes)||30)*60000).toISOString(),last_error=safeError(error);
  const metadata={until,reason:"yahoo_403",last_error,cooldown_minutes:Math.max(5,Number(minutes)||30),version:VERSION};
  await logEvent(env,"yahoo_catalog_cooldown",{endpoint:"scheduled",metadata});
  return {active:true,...metadata};
}

async function yahooRequest(env,params={},results=20){
  if(!env.YAHOO_CLIENT_ID)throw new Error("YAHOO_CLIENT_ID is missing");
  const start=params.start?Math.max(1,Math.min(999,Number(params.start)||1)):1;
  const requested=Math.max(1,Math.min(50,Number(results)||20));
  const safeResults=params.start?Math.max(1,Math.min(requested,1000-start)):requested;
  const u=new URL(YAHOO_ENDPOINT);
  u.searchParams.set("appid",env.YAHOO_CLIENT_ID);
  u.searchParams.set("results",String(safeResults));
  if(params.jan_code)u.searchParams.set("jan_code",params.jan_code);
  if(params.query)u.searchParams.set("query",params.query);
  if(params.start)u.searchParams.set("start",String(start));
  if(params.condition)u.searchParams.set("condition",String(params.condition));
  if(params.genre_category_id)u.searchParams.set("genre_category_id",String(params.genre_category_id));
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    const r=await fetch(u.toString(),{headers:{accept:"application/json"}});
    let data=null;try{data=await r.json();}catch{data={};}
    if(r.ok)return {hits:Array.isArray(data.hits)?data.hits:[],total:Number(data.totalResultsAvailable||0),requested_results:safeResults};
    lastError=new Error(`Yahoo ${r.status}: ${JSON.stringify(data).slice(0,1200)}`);
    if(!(r.status===429||r.status>=500)||attempt===3)break;
    await new Promise(x=>setTimeout(x,1100*attempt));
  }
  throw lastError||new Error("Yahoo request failed");
}

function yahooIdentityAnalysis(product,item){
  const title=String(item?.name||"");
  const itemJan=cleanJan(item?.janCode);
  const canonicalJan=cleanJan(product.jan_code);
  if(canonicalJan&&itemJan&&canonicalJan!==itemJan)return {accepted:false,score:0,basis:"jan_conflict",reason:"jan_conflict"};
  if(productTypeConflict(product,title))return {accepted:false,score:0,basis:"type_conflict",reason:"product_type_conflict"};
  const names=[product.canonical_name_ja,product.canonical_name_en].filter(Boolean);
  const similarity=Math.max(0,...names.map(n=>labelSimilarityScore(n,title)));
  const anchors=identityAnchors(names.join(" "));
  const anchorMatched=anchors.length===0||anchors.some(a=>identityAnchorMatched(a,title));
  const maker=normalizedManufacturer(product.manufacturer||"");
  const makerMatch=maker&&normalize(title).includes(maker.split(" ")[0]);
  if(canonicalJan&&itemJan===canonicalJan)return {accepted:true,score:100,basis:"jan_exact",reason:"jan_exact",anchorMatched,makerMatch};
  const specialist=specialistIdentityAnalysis(product,title);
  if(specialist.conflict)return {accepted:false,score:0,basis:"specialist_conflict",reason:`specialist_conflict:${specialist.conflicts.join(",")}`,anchorMatched,makerMatch,specialist};
  const score=Math.round(clamp(similarity+(anchorMatched&&anchors.length?8:0)+(makerMatch?5:0)+Math.min(30,specialist.score)));
  const threshold=categoryMarketThreshold(product)+12;
  return {accepted:score>=threshold&&anchorMatched,score,basis:specialist.matched.length?"specialist_name_identity":"name_identity",reason:score>=threshold?"name_identity":"score_below_threshold",anchorMatched,makerMatch,specialist};
}

async function yahooSearch(env,product,limit=30){
  const attempts=[];let returned=0;
  if(product.jan_code){
    try{
      const r=await yahooRequest(env,{jan_code:product.jan_code},Math.min(30,limit));
      returned+=r.hits.length;
      const hits=r.hits.map(item=>({item,a:yahooIdentityAnalysis(product,item)})).filter(x=>x.a.accepted).map(x=>({item:x.item,score:x.a.score,match_basis:x.a.basis,specialist_match:x.a.specialist||null}));
      attempts.push({method:"jan",query:product.jan_code,returned:r.hits.length,accepted:hits.length});
      if(hits.length)return {hits:hits.slice(0,12),returned,attempts,method:"jan",query:product.jan_code};
    }catch(e){attempts.push({method:"jan",query:product.jan_code,error:safeError(e)});}
  }
  const queries=[product.canonical_name_ja,product.canonical_name_en].filter(Boolean).map(x=>cleanOfficialTitle(x)).filter(Boolean);
  for(const q of [...new Set(queries)].slice(0,2)){
    try{
      const r=await yahooRequest(env,{query:q},Math.min(30,limit));
      returned+=r.hits.length;
      const analyses=r.hits.map(item=>({item,a:yahooIdentityAnalysis(product,item)}));
      const hits=analyses.filter(x=>x.a.accepted).map(x=>({item:x.item,score:x.a.score,match_basis:x.a.basis,specialist_match:x.a.specialist||null}));
      attempts.push({method:"name",query:q,returned:r.hits.length,accepted:hits.length,rejected_candidates:analyses.filter(x=>!x.a.accepted).slice(0,5).map(x=>({title:x.item?.name,reason:x.a.reason,score:x.a.score}))});
      if(hits.length)return {hits:hits.slice(0,12),returned,attempts,method:"name",query:q};
    }catch(e){attempts.push({method:"name",query:q,error:safeError(e)});}
  }
  return {hits:[],returned,attempts,method:null,query:null};
}

async function recentYahooObservations(env){
  const rows=await sbOptional(env,"/market_observations?select=*&metadata->>market_source=eq.yahoo_shopping&order=observed_at.desc&limit=1000");
  return Array.isArray(rows)?rows:[];
}

async function saveYahooObservations(env,product,hits,recent=[],sourceId=null){
  if(!Array.isArray(hits)||!hits.length)return 0;
  let sid=sourceId;
  if(!sid)sid=(await ensureYahooSource(env)).source_id;
  if(!sid)throw new Error("Yahoo source_id missing");
  const prev=latestObservationMap(recent.filter(o=>o.product_id===product.id));
  const now=new Date().toISOString();const rows=[];
  for(const hit of hits){
    const item=hit.item;const price=Number(item?.price);
    if(!item?.url||!Number.isFinite(price)||price<=0)continue;
    const id=item.code||item.url;
    const row={
      product_id:product.id,source_id:sid,external_listing_id:`yahoo:${id}`,
      seller_name:item.seller?.name||null,listing_title:item.name||product.canonical_name_ja,listing_url:item.url,item_condition:null,
      price_jpy:Math.round(price),shipping_jpy:null,price_original:price,currency:"JPY",shipping_original:null,in_stock:true,stock_text:"available",observed_at:now,
      metadata:{market_source:"yahoo_shopping",price_type:"asking",asking_price_jpy:Math.round(price),total_price_jpy:Math.round(price),sold_transaction:false,match_score:hit.score,match_basis:hit.match_basis,specialist_match:hit.specialist_match||null,identity_guard_version:VERSION,canonical_jan:product.jan_code||null,image_url:item.exImage?.url||item.image?.medium||null}
    };
    const old=prev.get(row.external_listing_id);
    if(!old||Number(old.price_jpy)!==row.price_jpy)rows.push(row);
  }
  if(rows.length)await sb(env,"/market_observations",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)});
  return rows.length;
}

async function refreshYahooBatch(env,limit=2,options={}){
  if(!env.YAHOO_CLIENT_ID)throw new Error("YAHOO_CLIENT_ID is missing");
  const history=await recentYahooObservations(env);
  const safeLimit=Math.max(1,Math.min(PIPELINE.yahooStandalone,Number(limit)||1));
  const selected=await selectMarketProducts(env,history,safeLimit,options.products||null,"yahoo_shopping");
  const sourceId=options.yahooSourceId||(await ensureYahooSource(env)).source_id;
  const report=[];
  for(const p of selected){
    try{
      const search=await yahooSearch(env,p,30);
      const inserted=await saveYahooObservations(env,p,search.hits,history,sourceId);
      await markMarketAttempt(env,p,"yahoo_shopping",{returned:search.returned,matches:search.hits.length,inserted});
      report.push({id:p.id,product:cleanOfficialTitle(p.canonical_name_ja),product_type:p.product_type||null,identity_quality:marketIdentityQuality(p),jan_code:p.jan_code||null,yahoo_returned:search.returned,matches:search.hits.length,inserted,queries_tried:search.attempts});
    }catch(e){
      try{await markMarketAttempt(env,p,"yahoo_shopping",{error:safeError(e)});}catch{}
      report.push({id:p.id,product:cleanOfficialTitle(p.canonical_name_ja),error:safeError(e)});
    }
  }
  return report;
}

/* =========================================================
   EBAY
========================================================= */

let ebayTokenCache=null;
let ebayTokenExpiresAt=0;
let fxCache=null;
let fxCacheExpiresAt=0;

function ebayBasicAuth(clientId,clientSecret){
  const bytes=new TextEncoder().encode(`${clientId}:${clientSecret}`);let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);
}

async function ebayAccessToken(env){
  if(ebayTokenCache&&Date.now()<ebayTokenExpiresAt-60000)return ebayTokenCache;
  if(!env.EBAY_CLIENT_ID||!env.EBAY_CLIENT_SECRET)throw new Error("eBay credentials are missing");
  const body=new URLSearchParams();body.set("grant_type","client_credentials");body.set("scope","https://api.ebay.com/oauth/api_scope");
  const r=await fetch(EBAY_TOKEN_ENDPOINT,{method:"POST",headers:{authorization:`Basic ${ebayBasicAuth(env.EBAY_CLIENT_ID,env.EBAY_CLIENT_SECRET)}`,"content-type":"application/x-www-form-urlencoded",accept:"application/json"},body:body.toString()});
  const data=await r.json();if(!r.ok||!data.access_token)throw new Error(`eBay OAuth ${r.status}`);
  ebayTokenCache=data.access_token;ebayTokenExpiresAt=Date.now()+Number(data.expires_in||7200)*1000;return ebayTokenCache;
}

function ebaySafeQuery(v=""){
  return (cleanOfficialTitle(v)||String(v||"")).replace(/[\u201c\u201d"'`]/g," ").replace(/[\u3010\u3011\u300c\u300d\u300e\u300f\uff08\uff09()[\]{}]/g," ").replace(/[\u30fb\uff0f/]+/g," ").replace(/\s+/g," ").trim().slice(0,100);
}

const EBAY_GENERIC_IDENTITY_TOKENS=new Set(["figure","figures","scale","size","ver","version","edition","good","smile","company","official","japan","new","used","preorder","limited","collection","series","set","mini","plastic","model","action","toy","toys"]);
const EBAY_NON_FIGURE_TERMS=["k-pop","kpop","album","photocard","photo card","postcard","photobook","penlight","lightstick","acrylic stand","keychain","key chain","t-shirt","shirt only","poster","clear file","pinback","button badge"];
const EBAY_SUSPICIOUS_TERMS=/\b(custom|recast|bootleg|unbranded|replica|copy|fake|china version)\b/i;

function ebayIdentityTokens(v=""){return [...new Set(tokens(v).filter(t=>!EBAY_GENERIC_IDENTITY_TOKENS.has(t)&&!/^\d+$/.test(t)))];}
function identityAnchors(v=""){
  const s=normalize(v),out=[];
  if(s.includes("pop up parade"))out.push("pop up parade");
  if(s.includes("nendoroid")||s.includes("\u306d\u3093\u3069\u308d\u3044\u3069"))out.push("nendoroid");
  if(/\bfigma\b/.test(s))out.push("figma");
  if(s.includes("harmonia bloom"))out.push("harmonia bloom");
  if(s.includes("moderoid"))out.push("moderoid");
  if(s.includes("scale figure")||s.includes("\u30b9\u30b1\u30fc\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2"))out.push("scale figure");
  return out;
}
function identityAnchorMatched(anchor,text=""){
  const h=normalize(text);
  if(anchor==="nendoroid")return h.includes("nendoroid")||h.includes("\u306d\u3093\u3069\u308d\u3044\u3069");
  if(anchor==="scale figure")return h.includes("scale figure")||h.includes("\u30b9\u30b1\u30fc\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2")||h.includes("\u30b9\u30b1\u30fc\u30eb");
  return h.includes(normalize(anchor));
}

function ebayStrongIdentityAnalysis(product,item){
  const title=String(item?.title||""),hay=normalize(title);
  const identity=[...new Set([...ebayIdentityTokens(product.canonical_name_en||""),...ebayIdentityTokens(product.canonical_name_ja||"")])];
  const matched=identity.filter(t=>hay.includes(t));
  const anchors=identityAnchors(`${product.canonical_name_en||""} ${product.canonical_name_ja||""}`);
  const anchorMatched=anchors.length===0||anchors.some(a=>identityAnchorMatched(a,title));
  const figureFamily=new Set(["figure","nendoroid","figma"]);
  const legacyNonFigure=figureFamily.has(String(product.product_type||""))&&EBAY_NON_FIGURE_TERMS.some(x=>hay.includes(normalize(x)));
  const nonFigure=legacyNonFigure||productTypeConflict(product,title);
  const specialist=specialistIdentityAnalysis(product,title);
  const model=normalize(product.model_number||"");const modelMatched=!!model&&hay.includes(model);
  const tokenEnough=matched.length>=(identity.length>=2?2:1);
  const specialistEnough=specialist.score>=18;
  const accepted=!nonFigure&&!specialist.conflict&&anchorMatched&&(modelMatched||tokenEnough||specialistEnough)&&!EBAY_SUSPICIOUS_TERMS.test(title);
  return {accepted,matched_identity_tokens:matched,required_anchors:anchors,anchor_matched:anchorMatched,non_figure_conflict:nonFigure,model_matched:modelMatched,specialist};
}

function ebaySearchCandidates(product){
  const out=[];const add=(value,method)=>{const q=ebaySafeQuery(value);if(!q||q.length<2||out.some(x=>x.query.toLowerCase()===q.toLowerCase()))return;out.push({query:q,method});};
  const sp=productSpecialistProfile(product),t=String(product.product_type||"");
  if(product.model_number)add(product.model_number,"model_number");
  if(t==="trading_card"){if(sp.card_number)add(`${sp.card_game||""} ${sp.card_number} ${sp.rarity||""} ${sp.grading_company||""} ${sp.grade||""}`,"card_exact_variant");if(sp.set_code)add(`${sp.card_game||""} ${sp.set_code}`,"card_set");}
  if(t==="sneaker"){if(sp.style_code)add(`${sp.brand||""} ${sp.style_code} ${sp.collaboration||""}`,"sneaker_style_code");else add(`${sp.brand||""} ${sp.model||""} ${sp.collaboration||""}`,"sneaker_variant");}
  if(t==="apparel"){if(sp.style_code)add(`${sp.brand||""} ${sp.style_code} ${sp.collaboration||""}`,"apparel_style_code");else add(`${sp.brand||""} ${sp.item_type||""} ${sp.collaboration||""}`,"apparel_variant");}
  if(t==="lottery_prize"&&sp.prize_rank)add(`${product.canonical_name_en||product.canonical_name_ja||""} ${sp.prize_rank}`,"lottery_rank");
  if(product.canonical_name_en)add(`${product.canonical_name_en} ${product.manufacturer||product.brand||""}`,"official_english_name_plus_maker");
  if(product.canonical_name_ja)add(product.canonical_name_ja,"japanese_name");
  return out.slice(0,4);
}

async function ebayBrowseRequest(env,params){
  const token=await ebayAccessToken(env);const u=new URL(EBAY_SEARCH_ENDPOINT);
  for(const [k,v] of Object.entries(params)){if(v!=null&&v!=="")u.searchParams.set(k,String(v));}
  const r=await fetch(u.toString(),{headers:{authorization:`Bearer ${token}`,"X-EBAY-C-MARKETPLACE-ID":EBAY_MARKETPLACE,accept:"application/json"}});
  const data=await r.json();if(!r.ok)throw new Error(`eBay Browse ${r.status}: ${JSON.stringify(data)}`);return data;
}

async function ebayItemDetail(env,itemId){
  const token=await ebayAccessToken(env);const r=await fetch(`${EBAY_ITEM_ENDPOINT}/${encodeURIComponent(itemId)}`,{headers:{authorization:`Bearer ${token}`,"X-EBAY-C-MARKETPLACE-ID":EBAY_MARKETPLACE,accept:"application/json"}});const data=await r.json();if(!r.ok)throw new Error(`eBay Item ${r.status}`);return data;
}

function ebayDetailText(detail){
  const aspects=(Array.isArray(detail?.localizedAspects)?detail.localizedAspects:[]).map(a=>`${a?.name||""} ${a?.value||""}`).join(" ");
  return [detail?.title,detail?.shortDescription,detail?.brand,detail?.mpn,detail?.gtin,detail?.product?.title,aspects].filter(Boolean).join(" ");
}
function ebayDetailGtins(detail){return [...new Set([...String(ebayDetailText(detail)).matchAll(/\b(\d{13})\b/g)].map(x=>x[1]))];}

async function ebaySearch(env,product,limit=20){
  const attempts=[];let returned=0;
  if(product.jan_code){
    try{
      const data=await ebayBrowseRequest(env,{gtin:product.jan_code,limit:Math.min(20,limit)});const items=Array.isArray(data.itemSummaries)?data.itemSummaries:[];returned+=items.length;
      attempts.push({method:"gtin",query:`GTIN:${product.jan_code}`,returned:items.length,accepted:items.length});
      if(items.length)return {hits:items.slice(0,12).map(item=>({item,score:100,match_basis:"gtin",verification:{detail_gtin_match:true}})),query:`GTIN:${product.jan_code}`,method:"gtin",ebay_returned:returned,queries_tried:attempts};
    }catch(e){attempts.push({method:"gtin",query:`GTIN:${product.jan_code}`,error:safeError(e)});}
  }
  let detailBudget=EBAY_DETAIL_LIMIT_PER_PRODUCT;
  for(const candidate of ebaySearchCandidates(product)){
    try{
      const data=await ebayBrowseRequest(env,{q:candidate.query,limit:Math.min(20,limit)});const items=Array.isArray(data.itemSummaries)?data.itemSummaries:[];returned+=items.length;
      const analyses=items.map(item=>({item,a:ebayStrongIdentityAnalysis(product,item)}));
      const accepted=analyses.filter(x=>x.a.accepted).map(x=>({item:x.item,score:80,match_basis:"strict_product_identity",verification:{anchor_matched:x.a.anchor_matched,matched_identity_tokens:x.a.matched_identity_tokens,specialist_match:x.a.specialist||null}}));
      attempts.push({method:candidate.method,query:candidate.query,returned:items.length,accepted:accepted.length,rejected_non_figure:analyses.filter(x=>x.a.non_figure_conflict).length,rejected_anchor:analyses.filter(x=>!x.a.anchor_matched).length,rejected_identity:analyses.filter(x=>!x.a.accepted&&!x.a.non_figure_conflict&&x.a.anchor_matched).length});
      if(accepted.length)return {hits:accepted.slice(0,12),query:candidate.query,method:candidate.method,ebay_returned:returned,queries_tried:attempts};
      if(detailBudget>0){
        const plausible=analyses.filter(x=>x.a.matched_identity_tokens.length>=1&&x.a.anchor_matched&&!x.a.non_figure_conflict).slice(0,detailBudget);const rescued=[];
        for(const x of plausible){if(detailBudget<=0)break;detailBudget--;try{const detail=await ebayItemDetail(env,x.item.itemId);const jan=cleanJan(product.jan_code);const gtinMatch=jan&&ebayDetailGtins(detail).includes(jan);const structured=ebayStrongIdentityAnalysis(product,{title:ebayDetailText(detail)});if(gtinMatch||structured.accepted)rescued.push({item:x.item,score:gtinMatch?100:85,match_basis:gtinMatch?"detail_gtin":"structured_item_specifics",verification:{detail_gtin_match:!!gtinMatch,structured_identity_verified:structured.accepted,specialist_match:structured.specialist||null}});}catch{}}
        if(rescued.length)return {hits:rescued,query:candidate.query,method:`${candidate.method}+detail`,ebay_returned:returned,queries_tried:attempts};
      }
    }catch(e){attempts.push({method:candidate.method,query:candidate.query,error:safeError(e)});}
  }
  return {hits:[],query:null,method:null,ebay_returned:returned,queries_tried:attempts};
}

async function recentEbayObservations(env){const rows=await sbOptional(env,"/market_observations?select=*&metadata->>market_source=eq.ebay&order=observed_at.desc&limit=1000");return Array.isArray(rows)?rows:[];}

function ebayShipping(item){
  let best=null;for(const o of(Array.isArray(item.shippingOptions)?item.shippingOptions:[])){const c=o?.shippingCost;if(c?.value==null||!c?.currency)continue;const value=Number(c.value);if(!Number.isFinite(value))continue;if(!best||value<best.value)best={value,currency:String(c.currency)};}return best||{value:null,currency:null};
}

function envUsdJpyRate(env){const n=Number(env.EBAY_USDJPY||env.USDJPY||0);return Number.isFinite(n)&&n>50&&n<300?n:null;}

async function resolveUsdJpy(env){
  const configured=envUsdJpyRate(env);if(configured)return {rate:configured,source:"environment"};if(fxCache&&Date.now()<fxCacheExpiresAt)return fxCache;
  try{const r=await fetch(ECB_FX_ENDPOINT,{headers:{accept:"application/xml,text/xml"}});if(!r.ok)throw new Error(`ECB FX ${r.status}`);const xml=await r.text();const usd=Number((xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/i)||[])[1]);const jpy=Number((xml.match(/currency=['"]JPY['"]\s+rate=['"]([0-9.]+)['"]/i)||[])[1]);if(!Number.isFinite(usd)||!Number.isFinite(jpy)||usd<=0||jpy<=0)throw new Error("ECB FX parse failed");fxCache={rate:jpy/usd,source:"ecb_reference"};fxCacheExpiresAt=Date.now()+6*3600000;return fxCache;}catch(e){return {rate:null,source:"unavailable",error:safeError(e)};}
}

function originalToJpy(value,currency,fxRate=null){const n=Number(value);if(!Number.isFinite(n))return null;if(currency==="JPY")return Math.round(n);if(currency==="USD"&&fxRate)return Math.round(n*fxRate);return null;}

async function saveEbayObservations(env,product,hits,recent=[],sourceId=null,fxInfo={rate:null,source:"unavailable"}){
  if(!Array.isArray(hits)||!hits.length)return 0;let sid=sourceId;
  if(!sid){const sources=await loadSources(env);sid=sourceIdBySlugOrName(sources,"ebay",["eBay"]);}if(!sid)throw new Error("eBay source_id missing");
  const prev=latestObservationMap(recent.filter(o=>o.product_id===product.id)),now=new Date().toISOString(),rows=[];
  for(const hit of hits){
    const item=hit.item;if(!item?.itemId||!item?.itemWebUrl||item?.price?.value==null||!item?.price?.currency)continue;
    const exact=["gtin","detail_gtin"].includes(hit.match_basis);if(!exact&&!['structured_item_specifics','strict_product_identity'].includes(hit.match_basis))continue;
    const shipping=ebayShipping(item),currency=String(item.price.currency),convertedPrice=originalToJpy(item.price.value,currency,fxInfo.rate),convertedShipping=shipping.currency?originalToJpy(shipping.value,shipping.currency,fxInfo.rate):null;if(convertedPrice==null)continue;
    const row={product_id:product.id,source_id:sid,external_listing_id:`ebay:${item.itemId}`,seller_name:null,listing_title:item.title||product.canonical_name_ja,listing_url:item.itemWebUrl,item_condition:String(item.condition||"").trim().toLowerCase()||null,price_jpy:convertedPrice,shipping_jpy:convertedShipping,price_original:Number(item.price.value),currency,shipping_original:shipping.value,in_stock:true,stock_text:"available",observed_at:now,metadata:{market_source:"ebay",marketplace:EBAY_MARKETPLACE,price_type:"asking",asking_price_jpy:convertedPrice,shipping_jpy:convertedShipping,total_price_jpy:convertedPrice+(convertedShipping||0),sold_transaction:false,match_score:hit.score,match_basis:hit.match_basis,identity_guard_version:VERSION,detail_verified:!!hit.verification,detail_gtin_match:hit.verification?.detail_gtin_match||false,structured_identity_verified:hit.verification?.structured_identity_verified||false,specialist_match:hit.verification?.specialist_match||null,canonical_jan:product.jan_code||null,canonical_name_en:product.canonical_name_en||null,image_url:item.image?.imageUrl||null,fx_rate_usdjpy:currency==="USD"?fxInfo.rate:null,fx_source:currency==="USD"?fxInfo.source:"native_jpy",jpy_conversion:currency==="JPY"?"native":"fx_reference",privacy_mode:"seller_identifier_not_stored"}};
    const old=prev.get(row.external_listing_id);if(!old||Number(old.price_original)!==row.price_original||String(old.currency||"")!==currency||Number(old.shipping_original??-1)!==Number(row.shipping_original??-1))rows.push(row);
  }
  if(rows.length)await sb(env,"/market_observations",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)});return rows.length;
}

async function refreshEbayBatch(env,limit=1,options={}){
  if(!env.EBAY_CLIENT_ID||!env.EBAY_CLIENT_SECRET)throw new Error("eBay credentials are missing");const history=await recentEbayObservations(env);const safeLimit=Math.max(1,Math.min(PIPELINE.ebayStandalone,Number(limit)||1));const selected=await selectMarketProducts(env,history,safeLimit,options.products||null,"ebay");let sourceId=options.ebaySourceId||null;if(!sourceId){const sources=options.sources||await loadSources(env);sourceId=sourceIdBySlugOrName(sources,"ebay",["eBay"]);}const fxInfo=await resolveUsdJpy(env);const report=[];
  for(const p of selected){try{const result=await ebaySearch(env,p,20);const inserted=await saveEbayObservations(env,p,result.hits,history,sourceId,fxInfo);await markMarketAttempt(env,p,"ebay",{returned:result.ebay_returned,matches:result.hits.length,inserted});report.push({id:p.id,product:cleanOfficialTitle(p.canonical_name_ja),canonical_name_en:p.canonical_name_en,jan_code:p.jan_code,product_type:p.product_type||null,identity_quality:marketIdentityQuality(p),identity_guard_version:VERSION,query:result.query,search_method:result.method,ebay_returned:result.ebay_returned,matches:result.hits.length,inserted,queries_tried:result.queries_tried});}catch(e){try{await markMarketAttempt(env,p,"ebay",{error:safeError(e)});}catch{}report.push({id:p.id,product:cleanOfficialTitle(p.canonical_name_ja),error:safeError(e)});}}
  return {identity_guard_version:VERSION,selected:selected.length,usd_jpy_conversion:fxInfo.rate,usd_jpy_source:fxInfo.source,products:report};
}

/* =========================================================
   KPI / REVENUE
========================================================= */

async function sha256Hex(value=""){
  const data=new TextEncoder().encode(String(value));const digest=await crypto.subtle.digest("SHA-256",data);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function logEvent(env,eventType,detail={}){
  if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)return false;
  try{await sb(env,"/api_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({occurred_at:new Date().toISOString(),event_type:eventType,endpoint:detail.endpoint||null,product_id:detail.product_id?String(detail.product_id):null,payer_hash:detail.payer_hash||null,amount_atomic:detail.amount_atomic!=null?Number(detail.amount_atomic):null,amount_usdc:detail.amount_usdc!=null?Number(detail.amount_usdc):null,payment_network:detail.payment_network||null,transaction_hash:detail.transaction_hash||null,metadata:detail.metadata||{}})});return true;}catch(e){console.warn("KPI event logging failed",safeError(e));return false;}
}

function getNested(obj,path=[]){let cur=obj;for(const key of path){if(cur==null||typeof cur!=="object")return null;cur=cur[key];}return cur??null;}
function extractPaymentPayer(payload,settlement=null){const candidates=[["payload","authorization","from"],["payload","authorization","payer"],["payload","from"],["authorization","from"],["authorization","payer"],["payer"],["from"],["paymentPayload","payload","authorization","from"],["transaction","payer"],["transaction","from"]];for(const p of candidates){const v=getNested(payload,p)||getNested(settlement,p);if(typeof v==="string"&&v.length>=20)return v;}return null;}
function extractSettlementTx(settlement){for(const p of [["transaction"],["transactionHash"],["txHash"],["tx"],["signature"],["receipt","transactionHash"],["receipt","signature"]]){const v=getNested(settlement,p);if(typeof v==="string"&&v)return v;}return null;}
async function payerHashFromPayment(payload,settlement){const payer=extractPaymentPayer(payload,settlement);return payer?sha256Hex(`anime-intelligence:${payer}`):null;}

async function revenueMetrics(env){
  const funnelTypes=["api_call","payment_required","payment_attempt","payment_invalid_header","payment_verify_failed","payment_verified","paid_call","payment_settlement_failed","x402_failed","product_intent","product_requested","product_not_found","service_execution_failed"];
  const filter=encodeURIComponent(`(${funnelTypes.join(",")})`);
  const rows=await sbOptional(env,`/api_events?select=*&event_type=in.${filter}&order=occurred_at.desc&limit=${PIPELINE.kpiEventReadLimit}`);
  const events=Array.isArray(rows)?rows:[];
  const byType={};for(const x of events)byType[x.event_type]=(byType[x.event_type]||0)+1;
  const calls=events.filter(x=>x.event_type==="api_call"),paid=events.filter(x=>x.event_type==="paid_call"),products=events.filter(x=>x.event_type==="product_requested");
  const paymentRequired=events.filter(x=>x.event_type==="payment_required"),attempts=events.filter(x=>x.event_type==="payment_attempt"),verified=events.filter(x=>x.event_type==="payment_verified");
  const queryCalls=calls.filter(x=>x.metadata?.query_present||x.metadata?.id_present),crawlerCalls=calls.filter(x=>["bot_or_monitor","x402scan","402_index","402_ad"].includes(String(x.metadata?.source_class||""))),unclassifiedCalls=calls.filter(x=>String(x.metadata?.source_class||"")==="unclassified_client");
  const payerCounts=new Map();for(const x of paid){if(x.payer_hash)payerCounts.set(x.payer_hash,(payerCounts.get(x.payer_hash)||0)+1);}
  const callsByEndpoint={},paidByEndpoint={},queryByEndpoint={};
  for(const x of calls){const k=x.endpoint||"unknown";callsByEndpoint[k]=(callsByEndpoint[k]||0)+1;if(x.metadata?.query_present||x.metadata?.id_present)queryByEndpoint[k]=(queryByEndpoint[k]||0)+1;}
  for(const x of paid){const k=x.endpoint||"unknown";paidByEndpoint[k]=(paidByEndpoint[k]||0)+1;}
  const identifyPayers=new Set(paid.filter(x=>x.endpoint==="/v1/identify"&&x.payer_hash).map(x=>x.payer_hash)),higherPayers=new Set(paid.filter(x=>x.endpoint!=="/v1/identify"&&x.payer_hash).map(x=>x.payer_hash));let converted=0;for(const p of identifyPayers)if(higherPayers.has(p))converted++;
  const revenue=paid.reduce((n,x)=>n+Number(x.amount_usdc||0),0),latestPaid=paid.length?paid[0]:null,firstPaid=paid.length?paid[paid.length-1]:null;
  const paymentView=x=>x?{occurred_at:x.occurred_at||null,endpoint:x.endpoint||null,amount_usdc:Number(x.amount_usdc||0),amount_atomic:x.amount_atomic!=null?Number(x.amount_atomic):null,network:x.payment_network||null,transaction_hash:x.transaction_hash||null,payer_hash:x.payer_hash||null}:null;
  const stage=(calls.length===0)?"no_external_api_traffic":(queryCalls.length===0)?"discovered_or_probed_but_no_product_intent":(attempts.length===0)?"product_intent_reached_402_but_no_payment_retry":(verified.length===0)?"payment_retry_received_but_not_verified":(paid.length===0)?"payment_verified_but_not_settled":"revenue_confirmed";
  return {event_window:`latest_${PIPELINE.kpiEventReadLimit}_x402_funnel_events`,funnel_stage:stage,first_revenue_confirmed:paid.length>0,total_api_calls:calls.length,query_bearing_calls:queryCalls.length,crawler_or_monitor_calls:crawlerCalls.length,unclassified_client_calls:unclassifiedCalls.length,payment_required_responses:paymentRequired.length,payment_attempts:attempts.length,payment_verified:verified.length,paid_calls:paid.length,unique_payers:payerCounts.size,repeat_payers:[...payerCounts.values()].filter(n=>n>=2).length,revenue_usdc:Number(revenue.toFixed(6)),first_payment:paymentView(firstPaid),latest_payment:paymentView(latestPaid),calls_by_endpoint:callsByEndpoint,query_calls_by_endpoint:queryByEndpoint,paid_calls_by_endpoint:paidByEndpoint,event_counts:byType,conversion_query_to_payment_attempt:queryCalls.length?Number((attempts.length/queryCalls.length).toFixed(4)):0,conversion_payment_attempt_to_paid:attempts.length?Number((paid.length/attempts.length).toFixed(4)):0,conversion_identify_to_paid:identifyPayers.size?Number((converted/identifyPayers.size).toFixed(4)):0,conversion_identify_to_paid_percent:identifyPayers.size?Number((converted/identifyPayers.size*100).toFixed(1)):0,products_requested:products.length,unique_products_requested:new Set(products.map(x=>x.product_id).filter(Boolean)).size,generated_at:new Date().toISOString()};
}

async function monetizationStatus(env,origin,{checkBazaar=false}={}){
  const kpi=await revenueMetrics(env);
  let bazaar={checked:false,status:null,indexed_count:null,expected_count:INDEX402_SERVICES.length,all_indexed:false,errors:[]};
  if(checkBazaar||kpi.first_revenue_confirmed){
    try{const b=await bazaarCheck(env,origin);bazaar={checked:true,status:b.status,indexed_count:b.indexed_count,expected_count:b.expected_count,all_indexed:b.all_indexed,missing_paths:b.missing_paths,errors:b.errors||[],checked_at:b.checked_at};}
    catch(e){bazaar={checked:true,status:"CHECK_FAILED",indexed_count:null,expected_count:INDEX402_SERVICES.length,all_indexed:false,errors:[safeError(e)]};}
  }
  return {service:"ANIME INTELLIGENCE",version:VERSION,status:kpi.first_revenue_confirmed?"REVENUE_CONFIRMED":"WAITING_FOR_FIRST_PAYMENT",revenue_usdc:kpi.revenue_usdc,paid_calls:kpi.paid_calls,unique_payers:kpi.unique_payers,repeat_payers:kpi.repeat_payers,first_payment:kpi.first_payment,latest_payment:kpi.latest_payment,paid_calls_by_endpoint:kpi.paid_calls_by_endpoint,bazaar,next_action:kpi.first_revenue_confirmed?(bazaar.all_indexed?"optimize_discovery_and_conversion":"wait_for_or_verify_bazaar_indexing"):"wait_for_first_external_x402_settlement",generated_at:new Date().toISOString()};
}

/* =========================================================
   RAKUTEN AFFILIATE \u2014 AFFILIATE-ID-ONLY MODE
   No Rakuten Web Service Application ID / Access Key.
   Live market pricing continues to come from Yahoo/eBay.
   Only official pre-generated Rakuten affiliate URLs are routed.
========================================================= */

function rakutenConfigured(env){return !!String(env.RAKUTEN_AFFILIATE_ID||"").trim();}

function rakutenSearchQuery(product){
  return [product?.jan_code,product?.canonical_name_ja,product?.canonical_name_en].map(x=>String(x||"").trim()).find(Boolean)||"anime figure";
}

function rakutenPublicSearchUrl(product){
  const q=rakutenSearchQuery(product);
  return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(q)}/`;
}

function isOfficialRakutenAffiliateUrl(v){
  try{const u=new URL(v);return u.protocol==="https:"&&u.hostname.toLowerCase()==="hb.afl.rakuten.co.jp";}catch{return false;}
}

function normalizeRakutenAffiliateOffer(raw,product){
  if(!raw)return null;const obj=typeof raw==="string"?{affiliate_url:raw}:raw;if(!obj||typeof obj!=="object")return null;const affiliateUrl=String(obj.affiliate_url||obj.url||"").trim();if(!isOfficialRakutenAffiliateUrl(affiliateUrl))return null;const price=Number(obj.price_jpy??obj.total_price_jpy??0);const total=Number(obj.total_price_jpy??obj.price_jpy??0);return {source:"rakuten",seller:obj.seller||obj.shop_name||"Rakuten Ichiba",title:obj.title||product?.canonical_name_ja||product?.canonical_name_en||null,item_code:obj.item_code||null,price_jpy:Number.isFinite(price)&&price>0?price:null,shipping_jpy:Number.isFinite(Number(obj.shipping_jpy))?Number(obj.shipping_jpy):null,total_price_jpy:Number.isFinite(total)&&total>0?total:null,affiliate_url:affiliateUrl,image_url:obj.image_url||null,match_score:Number.isFinite(Number(obj.match_score))?Number(obj.match_score):100,link_source:"official_pre_generated_affiliate_link"};
}

function registeredRakutenAffiliateOffers(product){
  const m=product?.metadata||{},raw=[];
  for(const key of ["rakuten_affiliate_url","rakuten_affiliate_link"]){if(m[key])raw.push(m[key]);}
  for(const key of ["rakuten_affiliate_urls","rakuten_affiliate_links","rakuten_offers"]){if(Array.isArray(m[key]))raw.push(...m[key]);}
  if(m.affiliate?.rakuten){if(Array.isArray(m.affiliate.rakuten))raw.push(...m.affiliate.rakuten);else raw.push(m.affiliate.rakuten);}
  const seen=new Set(),offers=[];for(const x of raw){const o=normalizeRakutenAffiliateOffer(x,product);if(!o||seen.has(o.affiliate_url))continue;seen.add(o.affiliate_url);offers.push(o);}
  return offers.sort((a,b)=>(a.total_price_jpy||Infinity)-(b.total_price_jpy||Infinity)).slice(0,5);
}

async function rakutenSearch(env,product){
  const configured=rakutenConfigured(env),offers=configured?registeredRakutenAffiliateOffers(product):[];return {configured,mode:"affiliate_link_only",web_service_api:false,affiliate_id_present:configured,offers,best:offers[0]||null,search_url:rakutenPublicSearchUrl(product),affiliate_ready:offers.length>0,pricing_source:"Yahoo Shopping + eBay + stored market observations",note:offers.length?"Official pre-generated Rakuten affiliate link available for this product.":"No official pre-generated Rakuten affiliate link is registered for this product yet; search_url is a normal Rakuten search URL and is not counted as an affiliate offer."};
}

function base64UrlEncode(v=""){const bytes=new TextEncoder().encode(String(v));let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function base64UrlDecode(v=""){const normalized=String(v).replace(/-/g,"+").replace(/_/g,"/");const padded=normalized+"=".repeat((4-normalized.length%4)%4);const bin=atob(padded);return new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0)));}
function affiliateRedirectUrl(origin,offer,productId){if(!offer?.affiliate_url||!isOfficialRakutenAffiliateUrl(offer.affiliate_url))return null;const u=new URL(`${origin}/r/rakuten`);u.searchParams.set("u",base64UrlEncode(offer.affiliate_url));if(productId)u.searchParams.set("pid",String(productId));return u.toString();}
function isAllowedAffiliateUrl(v){return isOfficialRakutenAffiliateUrl(v);}
async function handleRakutenRedirect(request,env,url){const encoded=url.searchParams.get("u")||"";let target;try{target=base64UrlDecode(encoded);}catch{return json({error:"invalid_affiliate_url"},400);}if(!isAllowedAffiliateUrl(target))return json({error:"affiliate_destination_not_allowed"},400);await logEvent(env,"affiliate_click",{endpoint:"/r/rakuten",product_id:url.searchParams.get("pid")||null,metadata:{source:"rakuten",mode:"affiliate_link_only"}});return new Response(null,{status:302,headers:corsHeaders({location:target,"cache-control":"no-store"})});}


/* =========================================================
   YAHOO COLLECTIBLES CATALOG SEEDING v3.0.0
   Search result pages are used only as discovery evidence.
   JAN is preferred. JAN-less collectibles use a deterministic canonical fingerprint.
   Existing figure ingestion continues while adjacent collectible categories expand in parallel.
========================================================= */

const BASE_COLLECTIBLE_CATALOG_QUERIES=[
  // Figures remain a core category.
  "\u306d\u3093\u3069\u308d\u3044\u3069","figma","POP UP PARADE","\u30b9\u30b1\u30fc\u30eb\u30d5\u30a3\u30ae\u30e5\u30a2","S.H.Figuarts",
  "\u30d5\u30a3\u30ae\u30e5\u30a2 \u521d\u97f3\u30df\u30af","\u30d5\u30a3\u30ae\u30e5\u30a2 ONE PIECE","\u30d5\u30a3\u30ae\u30e5\u30a2 \u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30eb","\u30d5\u30a3\u30ae\u30e5\u30a2 \u9b3c\u6ec5\u306e\u5203","\u30d5\u30a3\u30ae\u30e5\u30a2 \u546a\u8853\u5efb\u6226",
  "\u30d5\u30a3\u30ae\u30e5\u30a2 \u30a8\u30f4\u30a1\u30f3\u30b2\u30ea\u30aa\u30f3","\u30d5\u30a3\u30ae\u30e5\u30a2 Fate","\u30d5\u30a3\u30ae\u30e5\u30a2 \u30db\u30ed\u30e9\u30a4\u30d6","\u30d5\u30a3\u30ae\u30e5\u30a2 \u539f\u795e","\u30d5\u30a3\u30ae\u30e5\u30a2 NARUTO",
  // First-wave adjacent collectibles: same canonical identity + JAN model works well.
  "\u306c\u3044\u3050\u308b\u307f \u521d\u97f3\u30df\u30af","\u306c\u3044\u3050\u308b\u307f ONE PIECE","\u306c\u3044\u3050\u308b\u307f \u30dd\u30b1\u30e2\u30f3","\u306c\u3044\u3050\u308b\u307f \u3061\u3044\u304b\u308f","\u306c\u3044\u3050\u308b\u307f \u30b5\u30f3\u30ea\u30aa",
  "\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 \u521d\u97f3\u30df\u30af","\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 ONE PIECE","\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 \u9b3c\u6ec5\u306e\u5203","\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 \u546a\u8853\u5efb\u6226","\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 \u30db\u30ed\u30e9\u30a4\u30d6",
  "\u4e00\u756a\u304f\u3058 ONE PIECE","\u4e00\u756a\u304f\u3058 \u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30eb","\u4e00\u756a\u304f\u3058 \u9b3c\u6ec5\u306e\u5203","\u4e00\u756a\u304f\u3058 \u546a\u8853\u5efb\u6226","\u4e00\u756a\u304f\u3058 \u30a8\u30f4\u30a1\u30f3\u30b2\u30ea\u30aa\u30f3",
  "\u30d7\u30e9\u30e2\u30c7\u30eb \u30ac\u30f3\u30c0\u30e0","MODEROID","\u30ad\u30e3\u30e9\u30af\u30bf\u30fc \u30d7\u30e9\u30e2\u30c7\u30eb",
  "\u30ad\u30fc\u30db\u30eb\u30c0\u30fc \u521d\u97f3\u30df\u30af","\u7f36\u30d0\u30c3\u30b8 ONE PIECE","\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30b0\u30c3\u30ba \u9650\u5b9a",
  // Specialist categories are discoverable now; metadata keeps category-specific attributes extensible.
  "\u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9 \u30a2\u30cb\u30e1","ONE PIECE \u30ab\u30fc\u30c9","\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9",
  "\u30a2\u30cb\u30e1 \u30b3\u30e9\u30dc \u30b9\u30cb\u30fc\u30ab\u30fc","\u30ad\u30e3\u30e9\u30af\u30bf\u30fc \u30b3\u30e9\u30dc \u30b9\u30cb\u30fc\u30ab\u30fc","\u30a2\u30cb\u30e1 \u30b3\u30e9\u30dc \u30a2\u30d1\u30ec\u30eb",
  // v3.1 specialist expansion: broaden demand capture while specialist guards prevent cross-category contamination.
  "\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 SAR","\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 PSA10","ONE PIECE \u30ab\u30fc\u30c9 \u30d1\u30e9\u30ec\u30eb","ONE PIECE \u30ab\u30fc\u30c9 PSA10","UNION ARENA \u30d6\u30fc\u30b9\u30bf\u30fc","\u30f4\u30a1\u30a4\u30b9\u30b7\u30e5\u30f4\u30a1\u30eb\u30c4 \u30d6\u30fc\u30b9\u30bf\u30fc",
  "\u30ac\u30f3\u30d7\u30e9 MG","\u30ac\u30f3\u30d7\u30e9 RG","\u30ac\u30f3\u30d7\u30e9 HG","\u30d7\u30ec\u30df\u30a2\u30e0\u30d0\u30f3\u30c0\u30a4 \u30ac\u30f3\u30d7\u30e9",
  "\u4e00\u756a\u304f\u3058 ONE PIECE \u30e9\u30b9\u30c8\u30ef\u30f3","\u4e00\u756a\u304f\u3058 \u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30eb \u30e9\u30b9\u30c8\u30ef\u30f3","\u4e00\u756a\u304f\u3058 \u30d2\u30ed\u30a2\u30ab","\u4e00\u756a\u304f\u3058 NARUTO",
  "\u306c\u3044\u3050\u308b\u307f \u9b3c\u6ec5\u306e\u5203","\u306c\u3044\u3050\u308b\u307f \u546a\u8853\u5efb\u6226","\u306c\u3044\u3050\u308b\u307f \u30db\u30ed\u30e9\u30a4\u30d6","\u306c\u3044\u3050\u308b\u307f NARUTO",
  "\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 \u30d6\u30eb\u30fc\u30ed\u30c3\u30af","\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 \u63a8\u3057\u306e\u5b50","\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 NARUTO",
  "\u7f36\u30d0\u30c3\u30b8 \u9b3c\u6ec5\u306e\u5203","\u7f36\u30d0\u30c3\u30b8 \u546a\u8853\u5efb\u6226","\u7f36\u30d0\u30c3\u30b8 \u30db\u30ed\u30e9\u30a4\u30d6","\u30ad\u30fc\u30db\u30eb\u30c0\u30fc ONE PIECE","\u30ad\u30fc\u30db\u30eb\u30c0\u30fc \u9b3c\u6ec5\u306e\u5203",
  "CONVERSE NARUTO \u30b9\u30cb\u30fc\u30ab\u30fc","PUMA \u30dd\u30b1\u30e2\u30f3 \u30b9\u30cb\u30fc\u30ab\u30fc","VANS \u30a2\u30cb\u30e1 \u30b3\u30e9\u30dc","SPINGLE \u30a2\u30cb\u30e1 \u30b3\u30e9\u30dc",
  "NEW ERA \u30a2\u30cb\u30e1 \u30b3\u30e9\u30dc","graniph \u30a2\u30cb\u30e1 \u30b3\u30e9\u30dc","COSPA \u30a2\u30cb\u30e1 T\u30b7\u30e3\u30c4","UNIQLO \u30a2\u30cb\u30e1 UT"
];

// v3.2 query universe is generated deterministically at runtime rather than hand-writing
// thousands of phrases. The original 76 queries remain first so old category-test indices stay valid.
const CATALOG_IP_UNIVERSE=[
  "ONE PIECE","\u30dd\u30b1\u30e2\u30f3","\u521d\u97f3\u30df\u30af","\u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30eb","\u9b3c\u6ec5\u306e\u5203","\u546a\u8853\u5efb\u6226","NARUTO","BLEACH","\u50d5\u306e\u30d2\u30fc\u30ed\u30fc\u30a2\u30ab\u30c7\u30df\u30a2","\u9032\u6483\u306e\u5de8\u4eba",
  "\u30a8\u30f4\u30a1\u30f3\u30b2\u30ea\u30aa\u30f3","\u30ac\u30f3\u30c0\u30e0","Fate","\u30db\u30ed\u30e9\u30a4\u30d6","\u539f\u795e","\u5d29\u58ca\u30b9\u30bf\u30fc\u30ec\u30a4\u30eb","\u30d6\u30eb\u30fc\u30a2\u30fc\u30ab\u30a4\u30d6","\u30a6\u30de\u5a18","\u30a2\u30a4\u30c9\u30eb\u30de\u30b9\u30bf\u30fc","\u30e9\u30d6\u30e9\u30a4\u30d6",
  "\u30cf\u30a4\u30ad\u30e5\u30fc","\u540d\u63a2\u5075\u30b3\u30ca\u30f3","\u846c\u9001\u306e\u30d5\u30ea\u30fc\u30ec\u30f3","SPY\u00d7FAMILY","\u30c1\u30a7\u30f3\u30bd\u30fc\u30de\u30f3","\u30c0\u30f3\u30c0\u30c0\u30f3","\u30d6\u30eb\u30fc\u30ed\u30c3\u30af","\u63a8\u3057\u306e\u5b50","Re:\u30bc\u30ed","\u8ee2\u751f\u3057\u305f\u3089\u30b9\u30e9\u30a4\u30e0\u3060\u3063\u305f\u4ef6",
  "SAO","To LOVE\u308b","\u4e94\u7b49\u5206\u306e\u82b1\u5ac1","\u307c\u3063\u3061\u30fb\u3056\u30fb\u308d\u3063\u304f","\u3051\u3044\u304a\u3093","\u30b3\u30fc\u30c9\u30ae\u30a2\u30b9","\u30b8\u30e7\u30b8\u30e7\u306e\u5947\u5999\u306a\u5192\u967a","HUNTER\u00d7HUNTER","\u5e7d\u904a\u767d\u66f8","\u308b\u308d\u3046\u306b\u5263\u5fc3",
  "\u30bb\u30fc\u30e9\u30fc\u30e0\u30fc\u30f3","\u30ab\u30fc\u30c9\u30ad\u30e3\u30d7\u30bf\u30fc\u3055\u304f\u3089","\u30d7\u30ea\u30ad\u30e5\u30a2","\u3061\u3044\u304b\u308f","\u30b5\u30f3\u30ea\u30aa","\u3059\u307f\u3063\u30b3\u3050\u3089\u3057","\u661f\u306e\u30ab\u30fc\u30d3\u30a3","\u30c9\u30e9\u3048\u3082\u3093","\u30ea\u30b3\u30ea\u30b9\u30fb\u30ea\u30b3\u30a4\u30eb","\u85ac\u5c4b\u306e\u3072\u3068\u308a\u3054\u3068",
  "\u602a\u73638\u53f7","WIND BREAKER","\u4ffa\u3060\u3051\u30ec\u30d9\u30eb\u30a2\u30c3\u30d7\u306a\u4ef6","Dr.STONE","\u6771\u4eac\u30ea\u30d9\u30f3\u30b8\u30e3\u30fc\u30ba","\u6587\u8c6a\u30b9\u30c8\u30ec\u30a4\u30c9\u30c3\u30b0\u30b9","\u30d2\u30d7\u30ce\u30b7\u30b9\u30de\u30a4\u30af","\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u30bb\u30ab\u30a4","\u30a2\u30fc\u30af\u30ca\u30a4\u30c4","NieR"
];
const CATALOG_CATEGORY_QUERY_PATTERNS=[
  "\u30d5\u30a3\u30ae\u30e5\u30a2 {ip}","\u306d\u3093\u3069\u308d\u3044\u3069 {ip}","figma {ip}","\u30d7\u30e9\u30e2\u30c7\u30eb {ip}","\u306c\u3044\u3050\u308b\u307f {ip}","\u30de\u30b9\u30b3\u30c3\u30c8 {ip}",
  "\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9 {ip}","\u30a2\u30af\u30ea\u30eb\u30ad\u30fc\u30db\u30eb\u30c0\u30fc {ip}","\u30ad\u30fc\u30db\u30eb\u30c0\u30fc {ip}","\u7f36\u30d0\u30c3\u30b8 {ip}","\u4e00\u756a\u304f\u3058 {ip}","\u30d7\u30e9\u30a4\u30ba {ip}",
  "\u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9 {ip}","\u30ab\u30fc\u30c9 {ip} BOX","{ip} \u30b3\u30e9\u30dc \u30b9\u30cb\u30fc\u30ab\u30fc","{ip} \u30b3\u30e9\u30dc \u30a2\u30d1\u30ec\u30eb","{ip} \u9650\u5b9a \u30b0\u30c3\u30ba"
];
const CATALOG_MANUFACTURER_UNIVERSE=[
  "Good Smile Company","Max Factory","BANDAI SPIRITS","MegaHouse","Kotobukiya","ALTER","KADOKAWA","ANIPLEX","FuRyu","SEGA",
  "TAITO","BANPRESTO","Bushiroad Creative","movic","ensky","COSPA","Gift","AMAKUNI","Hobby Sakura","Union Creative",
  "Solarain","APEX","Myethos","FREEing","Phat Company","ORANGE ROUGE","WING","PLUM","BellFine","MEDICOS ENTERTAINMENT"
];
const CATALOG_MANUFACTURER_PATTERNS=["{maker} \u30d5\u30a3\u30ae\u30e5\u30a2","{maker} \u306c\u3044\u3050\u308b\u307f","{maker} \u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9","{maker} \u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30b0\u30c3\u30ba","{maker} \u9650\u5b9a"];
const CATALOG_CARD_QUERY_UNIVERSE=[
  "\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 SAR","\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 SR","\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 UR","\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 AR","\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 PSA10","ONE PIECE\u30ab\u30fc\u30c9 SEC","ONE PIECE\u30ab\u30fc\u30c9 SP","ONE PIECE\u30ab\u30fc\u30c9 \u30d1\u30e9\u30ec\u30eb","ONE PIECE\u30ab\u30fc\u30c9 PSA10",
  "\u904a\u622f\u738b 25th \u30b7\u30fc\u30af\u30ec\u30c3\u30c8","\u904a\u622f\u738b \u30d7\u30ea\u30ba\u30de\u30c6\u30a3\u30c3\u30af","\u904a\u622f\u738b PSA10","UNION ARENA \u30d1\u30e9\u30ec\u30eb","UNION ARENA \u661f2","\u30f4\u30a1\u30a4\u30b9\u30b7\u30e5\u30f4\u30a1\u30eb\u30c4 SSP","\u30f4\u30a1\u30a4\u30b9\u30b7\u30e5\u30f4\u30a1\u30eb\u30c4 SP","\u30c7\u30e5\u30a8\u30eb\u30de\u30b9\u30bf\u30fc\u30ba \u91d1\u30c8\u30ec\u30b8\u30e3\u30fc","\u30c9\u30e9\u30b4\u30f3\u30dc\u30fc\u30eb\u30ab\u30fc\u30c9 \u30d1\u30e9\u30ec\u30eb"
];
const CATALOG_COLLAB_BRANDS=["CONVERSE","PUMA","VANS","adidas","NIKE","Reebok","SPINGLE","NEW ERA","graniph","COSPA","UNIQLO UT"];
function buildCollectibleCatalogQueries(){
  const out=[...BASE_COLLECTIBLE_CATALOG_QUERIES],seen=new Set(out.map(x=>String(x).toLowerCase()));
  const add=q=>{q=String(q||"").replace(/\s+/g," ").trim();const k=q.toLowerCase();if(q&&q.length<=120&&!seen.has(k)){seen.add(k);out.push(q);}};
  for(const ip of CATALOG_IP_UNIVERSE)for(const pattern of CATALOG_CATEGORY_QUERY_PATTERNS)add(pattern.replace("{ip}",ip));
  for(const maker of CATALOG_MANUFACTURER_UNIVERSE)for(const pattern of CATALOG_MANUFACTURER_PATTERNS)add(pattern.replace("{maker}",maker));
  for(const q of CATALOG_CARD_QUERY_UNIVERSE)add(q);
  // Cross a bounded set of high-demand IPs with collaboration brands. This is deliberately
  // generated rather than a static list so new IPs/brands can be added with one line.
  for(const brand of CATALOG_COLLAB_BRANDS)for(const ip of CATALOG_IP_UNIVERSE.slice(0,30))add(`${brand} ${ip} \u30b3\u30e9\u30dc`);
  // Preserve the 1,594-query v3.2.0 production baseline without moving legacy indices.
  for(const q of ["ONE PIECE Bandai collectible","Pokemon Bandai collectible","Hatsune Miku Good Smile collectible","Dragon Ball Bandai collectible","Demon Slayer Aniplex collectible","Jujutsu Kaisen Bandai collectible","NARUTO Bandai collectible","BLEACH Bandai collectible","My Hero Academia Bandai collectible","Attack on Titan collectible","Evangelion collectible","Gundam Bandai collectible","Fate Aniplex collectible","Hololive collectible","Genshin Impact collectible","Honkai Star Rail collectible","Blue Archive collectible","Uma Musume collectible","The Idolmaster collectible","Love Live collectible","Haikyu collectible","Detective Conan collectible","Frieren collectible","SPY FAMILY collectible","Chainsaw Man collectible","Dandadan collectible","Blue Lock collectible","Oshi no Ko collectible","Re Zero collectible","That Time I Got Reincarnated as a Slime collectible","Sword Art Online collectible","To LOVE Ru collectible","The Quintessential Quintuplets collectible","Bocchi the Rock collectible","K ON collectible","Code Geass collectible","JoJo collectible","HUNTER HUNTER collectible","Yu Yu Hakusho collectible","Rurouni Kenshin collectible","Sailor Moon collectible","Cardcaptor Sakura collectible","Precure collectible"])add(q);
  return out;
}
const COLLECTIBLE_CATALOG_QUERIES=buildCollectibleCatalogQueries();


// v3.3 self-expanding search universe. Seed terms are learned from canonical products already
// accepted into the database, then crossed with collectible intents. The learned pool is
// persisted in api_events so Cron can keep exploring without a browser or code deployment.
const DYNAMIC_QUERY_PATTERNS=[
  "{seed} \u30d5\u30a3\u30ae\u30e5\u30a2","{seed} \u306d\u3093\u3069\u308d\u3044\u3069","{seed} figma","{seed} \u30d7\u30e9\u30e2\u30c7\u30eb","{seed} \u306c\u3044\u3050\u308b\u307f","{seed} \u30de\u30b9\u30b3\u30c3\u30c8",
  "{seed} \u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9","{seed} \u30ad\u30fc\u30db\u30eb\u30c0\u30fc","{seed} \u7f36\u30d0\u30c3\u30b8","{seed} \u4e00\u756a\u304f\u3058","{seed} \u30d7\u30e9\u30a4\u30ba","{seed} \u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9",
  "{seed} \u30ab\u30fc\u30c9 BOX","{seed} \u9650\u5b9a \u30b0\u30c3\u30ba","{seed} \u30b3\u30e9\u30dc \u30a2\u30d1\u30ec\u30eb","{seed} \u30b3\u30e9\u30dc \u30b9\u30cb\u30fc\u30ab\u30fc"
];
function dynamicSeedSafe(v){
  const x=String(v||"").normalize("NFKC").replace(/[\\/|<>\[\]{}]/g," ").replace(/\s+/g," ").trim();
  if(x.length<2||x.length>48)return null;
  // Reject placeholders, numeric/model-only values and obvious non-collectible platform/device seeds.
  if(/^(?:unknown|other|figure|goods|anime|character|none|null|n\/?a|not set|unregistered|brand(?: not)? registered|\u30ad\u30e3\u30e9\u30af\u30bf\u30fc|\u30d5\u30a3\u30ae\u30e5\u30a2|\u30b0\u30c3\u30ba|\u9650\u5b9a|\u30d6\u30e9\u30f3\u30c9\u767b\u9332\u306a\u3057|\u30d6\u30e9\u30f3\u30c9\u306a\u3057|\u30e1\u30fc\u30ab\u30fc\u4e0d\u660e|\u767b\u9332\u306a\u3057|\u4e0d\u660e|\u305d\u306e\u4ed6)$/i.test(x))return null;
  if(/^https?:/i.test(x)||/^\d+(?:[.\-_]\d+)*$/.test(x))return null;
  if(/^(?:Nintendo Switch|PlayStation(?:\s*[345])?|PS[345]|Xbox(?: Series [XS])?|Steam)$/i.test(x))return null;
  // Mojibake markers must never become learned search seeds.
  if(/[\u00c3\u00c2\u00e3\u00e5\u00e6\u00e8\u00e9\u00e7]/.test(x))return null;
  return x;
}
async function loadDynamicCatalogPool(env){
  const rows=await sbOptional(env,"/api_events?select=occurred_at,metadata&event_type=eq.dynamic_catalog_pool&order=occurred_at.desc&limit=1");
  const m=Array.isArray(rows)&&rows[0]?.metadata?rows[0].metadata:null;
  // Reject persisted pools from older generators; this forces a clean Unicode-safe rebuild.
  return m&&m.version==="dynamic-v3.3.2"&&Array.isArray(m.queries)
    ?m
    :{version:"dynamic-v3.3.2",queries:[],seeds:[],updatedAt:null};
}
async function refreshDynamicCatalogPool(env){
  // Recent canonical rows are enough to discover new franchises, makers, brands and series;
  // repeated hourly refreshes make the universe grow as ingestion grows.
  const rows=await sbOptional(env,"/products?select=franchise,manufacturer,brand,series,product_type&limit=1000");
  const seeds=new Set(CATALOG_IP_UNIVERSE.map(dynamicSeedSafe).filter(Boolean));
  for(const r of Array.isArray(rows)?rows:[]){
    for(const k of ["franchise","manufacturer","brand","series"]){const v=dynamicSeedSafe(r?.[k]);if(v)seeds.add(v);}
  }
  const staticSet=new Set(COLLECTIBLE_CATALOG_QUERIES.map(x=>String(x).toLowerCase()));
  const queries=[],seen=new Set();
  for(const seed of seeds){
    for(const pat of DYNAMIC_QUERY_PATTERNS){
      const q=pat.replace("{seed}",seed).replace(/\s+/g," ").trim(),key=q.toLowerCase();
      if(q.length<=120&&!staticSet.has(key)&&!seen.has(key)){seen.add(key);queries.push(q);if(queries.length>=10000)break;}
    }
    if(queries.length>=10000)break;
  }
  const state={version:"dynamic-v3.3.2",seed_count:seeds.size,query_count:queries.length,seeds:[...seeds].slice(0,500),queries,updatedAt:new Date().toISOString()};
  await logEvent(env,"dynamic_catalog_pool",{endpoint:"scheduled",metadata:state});
  return state;
}
async function dynamicCatalogProgress(env){
  const rows=await sbOptional(env,"/api_events?select=occurred_at,metadata&event_type=eq.dynamic_catalog_progress&order=occurred_at.desc&limit=1");
  const m=Array.isArray(rows)&&rows[0]?.metadata?rows[0].metadata:null;
  if(!m||m.version!=="dynamic-v3.3.2")return {version:"dynamic-v3.3.2",queryIndex:0,page:1,totalInserted:0,totalRequests:0,cycles:0};
  return m;
}
async function runDynamicCatalogBatch(env,batches=2){
  let pool=await loadDynamicCatalogPool(env);if(!pool.queries?.length)pool=await refreshDynamicCatalogPool(env);
  let st=await dynamicCatalogProgress(env),qi=Math.max(0,Number(st.queryIndex)||0),pg=Math.max(1,Number(st.page)||1),ins=Number(st.totalInserted)||0,req=Number(st.totalRequests)||0,cycles=Number(st.cycles)||0;
  const max=Math.max(1,Math.min(8,Number(batches)||2)),results=[];
  for(let n=0;n<max&&pool.queries.length;n++){
    if(qi>=pool.queries.length){qi=0;pg=1;cycles++;pool=await refreshDynamicCatalogPool(env);if(!pool.queries.length)break;}
    const query=pool.queries[qi];let a;
    try{a=await seedCollectibleCatalogYahoo(env,0,pg,{query});}catch(e){a={query,page:pg,inserted:0,exhausted:false,skipped_error:true,errors:[{error:safeError(e)}]};}
    results.push(a);ins+=Number(a.inserted||0);req++;
    const err=a.skipped_error?(a.errors?.[0]?.error||"unknown"):null,y403=isYahoo403Error(err);
    if(!a.skipped_error){if(a.exhausted||pg>=20){qi++;pg=1;}else pg++;}
    st={version:"dynamic-v3.3.2",queryIndex:qi,page:pg,totalInserted:ins,totalRequests:req,cycles,updatedAt:new Date().toISOString(),pool_query_count:pool.queries.length,pool_seed_count:pool.seed_count||0,last_query:query,last_error:err};
    await logEvent(env,"dynamic_catalog_progress",{endpoint:"scheduled",metadata:st});
    if(y403)break;
    await new Promise(r=>setTimeout(r,1100));
  }
  const lastError=st.last_error||null;
  return {status:isYahoo403Error(lastError)?"yahoo_403":"running",yahoo_403:isYahoo403Error(lastError),batch_requests:results.length,batch_inserted:results.reduce((n,x)=>n+Number(x.inserted||0),0),...st};
}

const COLLECTIBLE_CATALOG_TYPES=new Set(["nendoroid","figma","figure","model_kit","plush","acrylic_goods","keychain","badge","lottery_prize","trading_card","sneaker","apparel"]);

function tradingCardAccessoryReason(name=""){
  const n=String(name||"");
  const accessoryRe=/(?:\u30c8\u30ec\u30ab|\u30ab\u30fc\u30c9)?(?:\u30b1\u30fc\u30b9|\u30db\u30eb\u30c0\u30fc|\u30d5\u30a1\u30a4\u30eb|\u30d0\u30a4\u30f3\u30c0\u30fc|\u30a2\u30eb\u30d0\u30e0|\u53ce\u7d0d|\u30b3\u30ec\u30af\u30c8\u30d6\u30c3\u30af|\u30b7\u30fc\u30eb\u5e33|\u30ea\u30d5\u30a3\u30eb|\u30b9\u30ea\u30fc\u30d6|\u30ed\u30fc\u30c0\u30fc|\u30b5\u30a4\u30c9\u30ed\u30fc\u30c0\u30fc|\u30c8\u30c3\u30d7\u30ed\u30fc\u30c0\u30fc|\u30c7\u30c3\u30ad\u30b1\u30fc\u30b9|\u30c7\u30c3\u30ad\u30db\u30eb\u30c0\u30fc|\u30ab\u30fc\u30c9\u30b7\u30fc\u30c8|\u30ab\u30fc\u30c9\u30b9\u30bf\u30f3\u30c9|\u30ab\u30fc\u30c9\u30d5\u30ec\u30fc\u30e0|\u30d7\u30ec\u30a4\u30de\u30c3\u30c8|\u30b9\u30c8\u30ec\u30fc\u30b8\u30dc\u30c3\u30af\u30b9)/i;
  if(accessoryRe.test(n))return "trading_card_accessory";
  if(/\b(?:card\s*(?:case|holder|binder|album|sleeve|loader|toploader)|deck\s*(?:case|box)|playmat|storage\s*box)\b/i.test(n))return "trading_card_accessory";
  return null;
}
function tradingCardForm(name=""){
  const n=String(name||"");
  if(/(?:\u30d6\u30fc\u30b9\u30bf\u30fc\u30d1\u30c3\u30af|\u30b9\u30bf\u30fc\u30bf\u30fc\u30c7\u30c3\u30ad|\u30b9\u30bf\u30fc\u30c8\u30c7\u30c3\u30ad|\u69cb\u7bc9\u6e08\u307f\u30c7\u30c3\u30ad|\u30d6\u30fc\u30b9\u30bf\u30fc|\u30d1\u30c3\u30af|BOX|\u30dc\u30c3\u30af\u30b9|1\u30dc\u30c3\u30af\u30b9|\u30ab\u30fc\u30c0\u30b9|NEW CARD SELECTION)/i.test(n))return "sealed_product";
  if(/(?:\u30ab\u30fc\u30c9\u756a\u53f7|\u30ab\u30fc\u30c9No\.?|\u54c1\u756a)\s*[:\uff1a]?\s*[A-Z0-9-]{3,}/i.test(n))return "single_card";
  if(/\b(?:SEC|SP|SR|SSR|UR|SAR|CSR|CHR|RRR|RR|R|C|UC)\b/.test(n)&&/(?:PSA|BGS|CGC|\u9451\u5b9a|\u30d1\u30e9\u30ec\u30eb|\u30ec\u30a2|\u30ab\u30fc\u30c9)/i.test(n))return "single_card";
  if(/(?:PSA|BGS|CGC)\s*10/i.test(n))return "single_card";
  return "unspecified";
}
function tradingCardQuality(name,classification){
  if(classification?.type!=="trading_card")return {ok:true,form:null,reason:null};
  const reason=tradingCardAccessoryReason(name);
  return reason?{ok:false,form:null,reason}:{ok:true,form:tradingCardForm(name),reason:null};
}
function tradingCardFilterSelfTest(){
  const bad=[
    "\u30b7\u30fc\u30eb\u5e33 a5 \u30d0\u30a4\u30f3\u30c0\u30fc \u30b3\u30ec\u30af\u30c8\u30d6\u30c3\u30af 6\u7a74 \u30c8\u30ec\u30ab\u30b1\u30fc\u30b9",
    "\u30b5\u30a4\u30c9\u30ed\u30fc\u30c0\u30fc \u30dd\u30b1\u30e2\u30f3 \u30dd\u30b1\u30ab \u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9\u30b1\u30fc\u30b9",
    "FINGOOO \u30c8\u30ec\u30ab \u30d5\u30a1\u30a4\u30eb \u30ab\u30fc\u30c9\u30d5\u30a1\u30a4\u30eb 9\u30dd\u30b1\u30c3\u30c8"
  ];
  const good=[
    "UNION ARENA \u30d6\u30fc\u30b9\u30bf\u30fc\u30d1\u30c3\u30af Re:\u30bc\u30ed\u304b\u3089\u59cb\u3081\u308b\u7570\u4e16\u754c\u751f\u6d3b Vol.2",
    "TV\u30a2\u30cb\u30e1 Dr.STONE \u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9 BOX"
  ];
  const badResults=bad.map(name=>({name,rejected:tradingCardAccessoryReason(name)==="trading_card_accessory"}));
  const goodResults=good.map(name=>({name,rejected:tradingCardAccessoryReason(name)==="trading_card_accessory",form:tradingCardForm(name)}));
  return {ok:badResults.every(x=>x.rejected)&&goodResults.every(x=>!x.rejected),bad:badResults,good:goodResults};
}

function collectibleCatalogHitAccepted(hit){
  const jan=cleanJan(hit?.janCode),name=cleanOfficialTitle(hit?.name||"")||String(hit?.name||"").trim();
  if(!name)return null;
  const c=classifyProduct(name);
  if(!COLLECTIBLE_CATALOG_TYPES.has(c.type))return null;
  const tcq=tradingCardQuality(name,c);if(!tcq.ok)return null;
  if(/\b(?:bootleg|recast|replica|copy|counterfeit|fake)\b/i.test(name))return null;
  const noJan=jan?null:noJanCanonicalKey(name,c.type);
  return {jan:jan||null,name,classification:c,trading_card_form:c.type==="trading_card"?tcq.form:null,hit,canonical_identity:noJan?.identity||null,canonical_fingerprint:noJan?.fingerprint||null,source_key:jan?`catalog:yahoo:jan:${jan}`:noJan.source_key};
}

function normalizeCatalogDate(value){
  if(value==null||value==="")return null;
  const raw=String(value).trim();
  let d=null;
  if(/^\d{9,10}$/.test(raw))d=new Date(Number(raw)*1000);
  else if(/^\d{12,13}$/.test(raw))d=new Date(Number(raw));
  else if(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw))d=new Date(raw.replace(/\//g,"-"));
  else {const parsed=Date.parse(raw);if(Number.isFinite(parsed))d=new Date(parsed);}
  if(!d||!Number.isFinite(d.getTime()))return null;
  const year=d.getUTCFullYear();if(year<1970||year>2100)return null;
  return d.toISOString().slice(0,10);
}

function yahooCatalogSeedPayload(x,query,start,sourceId,now){
  const hit=x.hit,img=hit?.exImage?.url||hit?.image?.medium||hit?.image?.small||null,sp=specialistProfile(x.name,x.classification.type);
  const modelNumber=x.sneaker?.style_code||x.apparel?.style_code||sp.style_code||sp.card_number||null;
  return {canonical_name_ja:x.name,canonical_name_en:null,manufacturer:null,brand:x.sneaker?.brand||x.apparel?.brand||sp.brand||hit?.brand?.name||null,series:sp.set_code||sp.lottery_series||null,franchise:sp.card_game||sp.collaboration||null,character_names:[],jan_code:x.jan||null,model_number:modelNumber,product_type:x.classification.type,scale:sp.scale||null,edition:sp.edition||sp.rarity||null,limited_type:(sp.limited||sp.event_limited)?"limited":null,msrp_jpy:Number(hit?.priceLabel?.fixedPrice||0)||null,original_release_date:normalizeCatalogDate(hit?.releaseDate),official_url:null,official_image_url:img,image_source_url:hit?.url||null,image_status:img?"found":"pending",source_id:sourceId||null,source_product_key:x.source_key,product_status:"active",identification_confidence:x.jan?.80:(Object.values(sp).filter(v=>v!==null&&v!==false&&v!=="").length>=2?.74:.66),source_last_checked_at:now,metadata:{connector:"yahoo_collectible_catalog_seed",catalog_seed:true,collectibles_expansion:true,specialist_intelligence:true,discovery_query:query,discovery_start:start,discovery_source:"yahoo_shopping",raw_release_date:hit?.releaseDate??null,canonical_identity_method:x.identity_method||(x.jan?"jan":"normalized_name_type_fingerprint"),canonical_identity:x.canonical_identity||null,canonical_fingerprint:x.canonical_fingerprint||null,trading_card_form:x.trading_card_form||null,sneaker:x.sneaker||null,apparel:x.apparel||null,specialist:sp,classification:{...x.classification,version:VERSION},identity_quality_score:x.jan?45:34,field_provenance:{jan_code:x.jan?sourceEvidence("yahoo_collectible_catalog_seed",now):null,canonical_name_ja:sourceEvidence("yahoo_collectible_catalog_seed",now)},quality_version:VERSION,ingestion_version:VERSION}};
}


function legacyCatalogCleanupClassification(name="",productType=""){
  const n=String(name||""),pt=String(productType||""),reasons=[];
  if(pt==="trading_card"&&tradingCardAccessoryReason(n)==="trading_card_accessory")reasons.push("trading_card_accessory_false_positive");
  if(pt==="apparel"&&/\bHUF\b/i.test(n)&&!apparelHasCollabSignal(n))reasons.push("generic_huf_apparel_false_positive");
  if(pt==="apparel"&&/(?:head\s*cover|\u30d8\u30c3\u30c9\u30ab\u30d0\u30fc)/i.test(n))reasons.push("golf_head_cover_not_apparel");
  if(pt==="plush"&&/(?:head\s*cover|\u30d8\u30c3\u30c9\u30ab\u30d0\u30fc)/i.test(n))reasons.push("golf_head_cover_not_plush");
  if((pt==="plush"||pt==="apparel")&&/(?:happy\s*bag|\u798f\u888b|\u8a70\u3081\u5408\u308f\u305b|\u8a70\u5408\u305b)/i.test(n))reasons.push("mixed_bundle_single_type_false_positive");
  return reasons;
}
function legacyIdentityVersion(sourceKey=""){
  const k=String(sourceKey||"");
  if(/^catalog:sneaker:v[12]:/i.test(k))return "legacy_sneaker_identity";
  if(/^catalog:apparel:v1:/i.test(k))return "legacy_apparel_identity";
  return null;
}
async function loadCatalogSeedRowsForCleanup(env){
  const all=[];
  const pageSize=1000;
  const maxPages=100;
  for(let page=0;page<maxPages;page++){
    const offset=page*pageSize;
    const path=`/products?select=id,canonical_name_ja,jan_code,product_type,source_product_key,metadata&metadata->>catalog_seed=eq.true&order=id.asc&limit=${pageSize}&offset=${offset}`;
    const rows=await sbOptional(env,path);
    if(!Array.isArray(rows)||rows.length===0)break;
    all.push(...rows);
    if(rows.length<pageSize)break;
  }
  return all;
}
async function deleteProductsByIdsChunked(env,ids=[]){
  const clean=[...new Set(ids.map(String).filter(Boolean))];let deleted=0;
  for(let i=0;i<clean.length;i+=40){
    const chunk=clean.slice(i,i+40);
    const expr=`(${chunk.map(x=>`"${String(x).replace(/"/g,'\\"')}"`).join(",")})`;
    await sb(env,`/products?id=in.${encodeURIComponent(expr)}`,{method:"DELETE"});
    deleted+=chunk.length;
  }
  return deleted;
}
async function catalogCleanupPlan(env,{apply=false}={}){
  const rows=await loadCatalogSeedRowsForCleanup(env),byJan=new Map(),byNameType=new Map();
  const ntKey=r=>`${String(r.product_type||"")}|${canonicalCollectibleIdentity(r.canonical_name_ja||"",r.product_type||"")}`;
  for(const r of rows){
    const jan=cleanJan(r.jan_code);
    if(jan){if(!byJan.has(jan))byJan.set(jan,[]);byJan.get(jan).push(r);}
    const nt=ntKey(r);if(!byNameType.has(nt))byNameType.set(nt,[]);byNameType.get(nt).push(r);
  }
  const flagged=new Map();
  const flag=(r,reason)=>{if(!r?.id)return;const k=String(r.id);if(!flagged.has(k))flagged.set(k,{id:r.id,name:r.canonical_name_ja||null,product_type:r.product_type||null,jan:cleanJan(r.jan_code)||null,source_product_key:r.source_product_key||null,reasons:[]});const x=flagged.get(k);if(!x.reasons.includes(reason))x.reasons.push(reason);};
  for(const r of rows){
    for(const reason of legacyCatalogCleanupClassification(r.canonical_name_ja||"",r.product_type||""))flag(r,reason);
    const legacy=legacyIdentityVersion(r.source_product_key||"");
    if(legacy){
      const jan=cleanJan(r.jan_code),group=(jan?byJan.get(jan):byNameType.get(ntKey(r)))||[];
      if(group.some(x=>String(x.id)!==String(r.id)&&!legacyIdentityVersion(x.source_product_key||"")))flag(r,legacy);
    }
  }
  for(const group of byNameType.values()){
    if(group.some(r=>cleanJan(r.jan_code))){
      for(const r of group)if(!cleanJan(r.jan_code))flag(r,"duplicate_no_jan_shadowed_by_jan");
    }
  }
  const candidates=[...flagged.values()];
  let deleted=0;if(apply&&candidates.length)deleted=await deleteProductsByIdsChunked(env,candidates.map(x=>x.id));
  return {
    ok:true,
    version:VERSION,
    mode:apply?"apply":"dry_run",
    scanned:rows.length,
    scan_complete:true,
    scan_page_size:1000,
    candidates:candidates.length,
    deleted,
    reason_counts:candidates.reduce((o,x)=>{for(const r of x.reasons)o[r]=(o[r]||0)+1;return o;},{}),
    samples:candidates.slice(0,100)
  };
}
async function seedCollectibleCatalogYahoo(env,queryIndex=0,page=1,options={}){
  if(!env.YAHOO_CLIENT_ID)throw new Error("YAHOO_CLIENT_ID is missing");
  const qi=Math.max(0,Math.min(COLLECTIBLE_CATALOG_QUERIES.length-1,Number(queryIndex)||0)),pg=Math.max(1,Math.min(20,Number(page)||1));
  const query=String(options?.query||COLLECTIBLE_CATALOG_QUERIES[qi]),start=1+(pg-1)*50;
  const result=await yahooRequest(env,{query,start,condition:"new"},50);
  const hits=result.hits||[],targetTypes=Array.isArray(options?.targetTypes)&&options.targetTypes.length?new Set(options.targetTypes):null,rejection_counts={missing_name:0,unsupported_product_type:0,category_mismatch:0,trading_card_accessory:0,bootleg_or_replica:0,duplicate_in_page:0},rejection_samples={unsupported_product_type:[],category_mismatch:[]},identity_counts={jan:0,canonical_fingerprint:0,sneaker_style_code:0,sneaker_brand_collab_model:0,sneaker_canonical_name:0,apparel_style_code:0,apparel_brand_collab_type:0,apparel_canonical_name:0};
  const byIdentity=new Map();
  for(const hit of hits){
    const name=cleanOfficialTitle(hit?.name||"")||String(hit?.name||"").trim();
    if(!name){rejection_counts.missing_name++;continue;}
    let c=classifyProduct(name);
    c=((c.type==="other"||!c.type)?apparelClassifierOverride(name,c):c);
    if(!COLLECTIBLE_CATALOG_TYPES.has(c.type)){
      rejection_counts.unsupported_product_type++;
      if(rejection_samples.unsupported_product_type.length<15)rejection_samples.unsupported_product_type.push({name,classified_type:c.type||null,classification:c});
      continue;
    }
    if(targetTypes&&!targetTypes.has(c.type)){
      rejection_counts.category_mismatch++;
      if(rejection_samples.category_mismatch.length<10)rejection_samples.category_mismatch.push({name,classified_type:c.type||null});
      continue;
    }
    // Final apparel quality gate: base classifier may already return apparel,
    // but catalog insertion requires an anime/character/collaboration signal.
    if(c.type==="apparel"&&!apparelHasCollabSignal(name)){
      rejection_counts.unsupported_product_type++;
      if(rejection_samples.unsupported_product_type.length<15)rejection_samples.unsupported_product_type.push({
        name,
        classified_type:c.type||null,
        classification:{...c,reason:"apparel_missing_collab_signal"}
      });
      continue;
    }
    const tcq=tradingCardQuality(name,c);
    if(!tcq.ok){rejection_counts.trading_card_accessory++;continue;}
    if(/\b(?:bootleg|recast|replica|copy|counterfeit|fake)\b/i.test(name)){rejection_counts.bootleg_or_replica++;continue;}
    const jan=cleanJan(hit?.janCode);
    const ident=collectibleIdentityKey(name,c.type,jan);
    const sneaker=c.type==="sneaker"?sneakerIdentity(name):null;
    const apparel=c.type==="apparel"?apparelIdentity(name):null;
    const x={jan:jan||null,name,classification:c,trading_card_form:c.type==="trading_card"?tcq.form:null,sneaker,apparel,identity_method:ident.identity_method,hit,canonical_identity:ident.identity||null,canonical_fingerprint:ident.fingerprint||null,source_key:ident.source_key};
    const key=`src:${ident.source_key}`;
    const prev=byIdentity.get(key);
    if(prev){
      rejection_counts.duplicate_in_page++;
      // Prefer the listing carrying a JAN; otherwise keep the cleaner/shorter title.
      if((jan&&!prev.jan)||((!!jan===!!prev.jan)&&name.length<prev.name.length))byIdentity.set(key,x);
      continue;
    }
    byIdentity.set(key,x);
    identity_counts[ident.identity_method]=(identity_counts[ident.identity_method]||0)+1;
  }
  const candidates=[...byIdentity.values()];
  const countTypes=xs=>xs.reduce((o,x)=>{const t=x?.classification?.type||"unknown";o[t]=(o[t]||0)+1;return o;},{});
  const trading_card_form_counts=candidates.filter(x=>x.classification.type==="trading_card").reduce((o,x)=>{const f=x.trading_card_form||"unspecified";o[f]=(o[f]||0)+1;return o;},{});
  const janCandidates=candidates.filter(x=>x.jan),fpCandidates=candidates.filter(x=>!x.jan);
  const existingJanRows=janCandidates.length?await loadProductsByJans(env,janCandidates.map(x=>x.jan)):[];
  const existingKeyRows=candidates.length?await loadProductsBySourceKeys(env,candidates.map(x=>x.source_key)):[];
  const existingJans=new Set(existingJanRows.map(x=>cleanJan(x.jan_code)).filter(Boolean));
  const existingKeys=new Set(existingKeyRows.map(x=>String(x.source_product_key||"")).filter(Boolean));
  const missing=candidates.filter(x=>!existingKeys.has(x.source_key)&&!(x.jan&&existingJans.has(x.jan)));
  let inserted=0;const errors=[];
  if(missing.length){
    const source=await ensureYahooSource(env),now=new Date().toISOString(),payloads=missing.map(x=>yahooCatalogSeedPayload(x,query,start,source.source_id,now));
    try{const rows=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation,resolution=ignore-duplicates"},body:JSON.stringify(payloads)});inserted=Array.isArray(rows)?rows.length:missing.length;}
    catch(e){
      // v3.0.11: never fall back to one HTTP request per product.
      // Retry in bounded chunks so a single Worker invocation stays well below
      // Cloudflare's subrequest ceiling even with 50 no-JAN candidates.
      errors.push({batch:true,error:safeError(e),fallback:"bounded_chunk_insert"});
      const chunkSize=10;
      for(let i=0;i<payloads.length;i+=chunkSize){
        const chunk=payloads.slice(i,i+chunkSize);
        try{
          const rows=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation,resolution=ignore-duplicates"},body:JSON.stringify(chunk)});
          inserted+=Array.isArray(rows)?rows.length:chunk.length;
        }catch(one){
          errors.push({chunk_start:i,chunk_size:chunk.length,error:safeError(one)});
        }
      }
    }
  }
  const rejectedTotal=Object.values(rejection_counts).reduce((a,b)=>a+Number(b||0),0);
  return {query_index:qi,query,page:pg,start,filter_self_test:tradingCardFilterSelfTest(),classification_self_test:catalogClassificationRegressionSelfTest(),yahoo_total:result.total,returned:hits.length,collectible_candidates:candidates.length,jan_collectible_candidates:janCandidates.length,no_jan_canonical_candidates:fpCandidates.length,identity_counts,rejected:rejectedTotal,rejection_counts,rejection_samples,candidate_type_counts:countTypes(candidates),trading_card_form_counts,existing:existingJans.size+existingKeys.size,selected:missing.length,new_type_counts:countTypes(missing),new_samples:missing.slice(0,10).map(x=>({name:x.name,jan:x.jan,product_type:x.classification.type,trading_card_form:x.trading_card_form||null,identity_method:x.identity_method||(x.jan?"jan":"canonical_fingerprint"),canonical_fingerprint:x.canonical_fingerprint||null,sneaker:x.sneaker||null,apparel:x.apparel||null})),inserted,subrequest_safety:{source_key_lookup:"single_batch_request",individual_insert_fallback:false,max_insert_retry_chunks:5},exhausted:hits.length===0||start+50>Math.min(1000,result.total||0),errors};
}

const CATALOG_TEST_PRESETS={figure:0,plush:15,acrylic_goods:20,lottery_prize:25,model_kit:30,keychain:33,badge:34,limited_goods:35,trading_card:36,sneaker:39,apparel:41};
const CATALOG_TEST_TARGET_TYPES={figure:["figure","nendoroid","figma"],plush:["plush"],acrylic_goods:["acrylic_goods"],lottery_prize:["lottery_prize"],model_kit:["model_kit"],keychain:["keychain"],badge:["badge"],limited_goods:null,trading_card:["trading_card"],sneaker:["sneaker"],apparel:["apparel"]};
async function runCatalogCategoryTest(env,category,page=1){
  const key=String(category||"").trim();
  if(!(key in CATALOG_TEST_PRESETS))return {ok:false,error:"unknown_category",allowed:Object.keys(CATALOG_TEST_PRESETS)};
  const targetTypes=CATALOG_TEST_TARGET_TYPES[key]||null;
  const result=await seedCollectibleCatalogYahoo(env,CATALOG_TEST_PRESETS[key],Math.max(1,Number(page)||1),{targetTypes});
  return {ok:true,version:VERSION,test_category:key,query_index:CATALOG_TEST_PRESETS[key],target_types:targetTypes,...result};
}

async function catalogProgress(env){
  const rows=await sbOptional(env,"/api_events?select=occurred_at,metadata&event_type=eq.catalog_seed_progress&order=occurred_at.desc&limit=1");
  const m=Array.isArray(rows)&&rows[0]?.metadata?rows[0].metadata:null;
  // v3 uses a broader query universe. Never let a completed figure-only v2 cursor suppress collectible expansion.
  if(!m||m.catalog_version!=="collectibles-v3.3.0")return {catalog_version:"collectibles-v3.3.0",queryIndex:0,page:1,totalInserted:0,totalRequests:0,complete:false};
  return Number.isFinite(Number(m.queryIndex))&&Number.isFinite(Number(m.page))?m:{catalog_version:"collectibles-v3.3.0",queryIndex:0,page:1,totalInserted:0,totalRequests:0,complete:false};
}

async function saveCatalogProgress(env,state){await logEvent(env,"catalog_seed_progress",{endpoint:"/admin/catalog-run",metadata:state});return state;}

async function catalogAutoStatus(env){
  const progress=await catalogProgress(env);
  const rows=await sbOptional(env,"/api_events?select=occurred_at,metadata&event_type=eq.scheduled_growth_run&order=occurred_at.desc&limit=1");
  const last=Array.isArray(rows)&&rows.length?rows[0]:null;
  return {
    version:VERSION,
    autonomous:true,
    browser_required:false,
    scheduled_batches_per_run:"static_5_plus_dynamic_2_per_minute_except_hour_boundary_static_3_dynamic_1",catalog_query_count:COLLECTIBLE_CATALOG_QUERIES.length,catalog_ip_count:CATALOG_IP_UNIVERSE.length,official_mass_feed_count:OFFICIAL_MASS_FEEDS.length,dynamic_catalog_pool:await loadDynamicCatalogPool(env),dynamic_catalog_progress:await dynamicCatalogProgress(env),
    yahoo_catalog_cooldown:await yahooCatalogCooldownState(env),
    catalog_progress:progress,
    last_scheduled_growth:last?{occurred_at:last.occurred_at||null,catalog:last.metadata?.catalog||null,dynamic_catalog:last.metadata?.dynamic_catalog||null,fallback_growth:last.metadata?.fallback_growth||null,errors:last.metadata?.errors||[]}:null,
    note:"Catalog progress is persisted after each completed page. Yahoo 403 enters a 30-minute cooldown without advancing the Yahoo cursor; zero-result archive pages are skipped immediately and fallback continues through Good Smile archive, official mass feeds and official detail sources."
  };
}

async function runCatalogBatch(env,batches=10){
  const max=Math.max(1,Math.min(20,Number(batches)||10));let state=await catalogProgress(env);
  if(state.complete)return {status:"complete",version:VERSION,...state,results:[]};
  let qi=Math.max(0,Number(state.queryIndex)||0),pg=Math.max(1,Number(state.page)||1),totalInserted=Number(state.totalInserted)||0,totalRequests=Number(state.totalRequests)||0;const results=[];
  for(let n=0;n<max&&qi<COLLECTIBLE_CATALOG_QUERIES.length;n++){
    let a=null;
    try{a=await seedCollectibleCatalogYahoo(env,qi,pg);}
    catch(e){a={query_index:qi,query:COLLECTIBLE_CATALOG_QUERIES[qi],page:pg,inserted:0,exhausted:false,skipped_error:true,errors:[{stage:"yahoo_page",error:safeError(e)}]};}
    results.push(a);totalInserted+=Number(a.inserted||0);totalRequests++;
    const err=a.skipped_error?(a.errors?.[0]?.error||"unknown"):null,y403=isYahoo403Error(err);
    if(!a.skipped_error){if(a.exhausted||pg>=20){qi++;pg=1;}else pg++;}
    const complete=qi>=COLLECTIBLE_CATALOG_QUERIES.length;
    state={catalog_version:"collectibles-v3.3.0",queryIndex:qi,page:pg,totalInserted,totalRequests,complete,updatedAt:new Date().toISOString(),lastPageError:a.skipped_error?{queryIndex:a.query_index,page:a.page,error:err}:null};await saveCatalogProgress(env,state);
    if(complete||y403)break;
    await new Promise(x=>setTimeout(x,1100));
  }
  const yahoo403=isYahoo403Error(state.lastPageError?.error);
  return {status:state.complete?"complete":yahoo403?"yahoo_403":"paused",yahoo_403:yahoo403,version:VERSION,batch_requests:results.length,batch_inserted:results.reduce((n,x)=>n+Number(x.inserted||0),0),...state,results};
}

const OFFICIAL_FALLBACK_PROGRESS_VERSION="official-fallback-v3.5.5";
const OFFICIAL_FALLBACK_ARCHIVE_ATTEMPTS=4;
async function officialFallbackProgress(env){
  const rows=await sbOptional(env,"/api_events?select=occurred_at,metadata&event_type=eq.official_fallback_progress&order=occurred_at.desc&limit=1");
  const m=Array.isArray(rows)&&rows[0]?.metadata?rows[0].metadata:null;
  if(!m||m.version!==OFFICIAL_FALLBACK_PROGRESS_VERSION)return {version:OFFICIAL_FALLBACK_PROGRESS_VERSION,categoryIndex:0,page:1,totalInserted:0,totalAttempts:0,updatedAt:null};
  return {version:OFFICIAL_FALLBACK_PROGRESS_VERSION,categoryIndex:Math.max(0,Number(m.categoryIndex)||0)%GOODSMILE_ARCHIVE_CATEGORIES.length,page:Math.max(1,Number(m.page)||1),totalInserted:Number(m.totalInserted)||0,totalAttempts:Number(m.totalAttempts)||0,updatedAt:m.updatedAt||null};
}
async function saveOfficialFallbackProgress(env,state){
  await logEvent(env,"official_fallback_progress",{endpoint:"scheduled",metadata:state});
  return state;
}
async function runGoodSmileFallbackSweep(env,scheduledTime=Date.now(),maxAttempts=OFFICIAL_FALLBACK_ARCHIVE_ATTEMPTS){
  let st=await officialFallbackProgress(env),categoryIndex=st.categoryIndex,page=st.page,totalInserted=st.totalInserted,totalAttempts=st.totalAttempts;
  const attempts=[];let inserted=0;
  for(let n=0;n<Math.max(1,Math.min(6,Number(maxAttempts)||OFFICIAL_FALLBACK_ARCHIVE_ATTEMPTS));n++){
    const category=GOODSMILE_ARCHIVE_CATEGORIES[categoryIndex%GOODSMILE_ARCHIVE_CATEGORIES.length];
    let r;
    try{r=await archiveDiscoverGoodSmile(env,category.id,page,PIPELINE.archiveSeedsCron);}
    catch(e){r={category:category.slug,category_id:category.id,page,inserted:0,discovered:0,selected:0,exhausted:false,errors:[{error:safeError(e)}]};}
    attempts.push(r);inserted+=Number(r?.inserted||0);totalInserted+=Number(r?.inserted||0);totalAttempts++;
    if(r?.exhausted||Number(r?.discovered||0)===0){categoryIndex=(categoryIndex+1)%GOODSMILE_ARCHIVE_CATEGORIES.length;page=1;}
    else page=Math.min(999,page+1);
    if(Number(r?.inserted||0)>0)break;
    await new Promise(x=>setTimeout(x,250));
  }
  const state={version:OFFICIAL_FALLBACK_PROGRESS_VERSION,categoryIndex,page,totalInserted,totalAttempts,updatedAt:new Date().toISOString()};
  await saveOfficialFallbackProgress(env,state);
  return {source:"goodsmile_archive_sweep",inserted,attempts:attempts.length,next_category:GOODSMILE_ARCHIVE_CATEGORIES[categoryIndex]?.slug||null,next_page:page,progress:state,results:attempts};
}
async function runOfficialFallbackGrowth(env,scheduledTime=Date.now()){
  const attempts=[];
  try{
    const gs=await runGoodSmileFallbackSweep(env,scheduledTime,OFFICIAL_FALLBACK_ARCHIVE_ATTEMPTS);
    attempts.push(gs);
    if(Number(gs.inserted||0)>0)return {active:true,status:"inserted",source:gs.source,inserted:Number(gs.inserted||0),attempts};

    const mass=await patrolOfficialMassFeeds(env,PIPELINE.officialMassFeedCron,{timeMs:scheduledTime});
    const massInserted=Number(mass?.inserted||0);attempts.push({source:"official_mass_feed",inserted:massInserted,result:mass});
    if(massInserted>0)return {active:true,status:"inserted",source:"official_mass_feed",inserted:massInserted,attempts};

    const detail=await refreshOfficialBatch(env,Math.max(1,PIPELINE.officialDetailCron||2),{timeMs:scheduledTime});
    const detailInserted=Array.isArray(detail)?detail.filter(x=>x?.status==="inserted").length:0;attempts.push({source:"official_detail",inserted:detailInserted,result:detail});
    return {active:true,status:detailInserted>0?"inserted":"no_new_products",source:detailInserted>0?"official_detail":"official_fallback_exhausted_for_run",inserted:detailInserted,attempts};
  }catch(e){return {active:true,status:"error",source:"official_fallback",inserted:0,attempts,error:safeError(e)};}
}


/* =========================================================
   SELF DISCOVERY
========================================================= */

function chooseSelfDiscoveryYahooHit(query,hits=[]){
  const q=String(query||"").trim(),directJan=cleanJan(q);if(directJan){const exact=hits.find(h=>cleanJan(h.janCode)===directJan);return exact?{hit:exact,jan:directJan,confidence:.94,basis:"query_exact_jan"}:null;}
  const grouped=new Map();for(const hit of hits){const jan=cleanJan(hit.janCode);if(!jan)continue;const similarity=labelSimilarityScore(q,hit.name||"");if(similarity<45)continue;if(!grouped.has(jan))grouped.set(jan,[]);grouped.get(jan).push({hit,similarity});}
  const ranked=[...grouped.entries()].map(([jan,xs])=>({jan,hits:xs,count:xs.length,best:Math.max(...xs.map(x=>x.similarity))})).sort((a,b)=>b.count-a.count||b.best-a.best);const best=ranked[0];if(best&&best.count>=2&&best.best>=55){const winner=best.hits.sort((a,b)=>b.similarity-a.similarity)[0];return {hit:winner.hit,jan:best.jan,confidence:.80,basis:"multi_listing_same_jan"};}
  if(!PIPELINE.selfDiscoveryNoJanEnabled)return null;
  // Specialist no-JAN fallback for lottery prizes, acrylic goods, badges, apparel, sneakers and cards.
  // Require a strong textual match and a clear margin over the runner-up to avoid auto-creating ambiguity.
  const noJan=hits.map(hit=>{const accepted=collectibleCatalogHitAccepted(hit);if(!accepted||accepted.jan)return null;const similarity=labelSimilarityScore(q,accepted.name);const sp=specialistProfile(accepted.name,accepted.classification.type),richness=Object.values(sp||{}).filter(v=>v!==null&&v!==false&&v!=="").length;return {hit,accepted,similarity,richness,score:similarity+Math.min(12,richness*3)};}).filter(Boolean).sort((a,b)=>b.score-a.score);
  const first=noJan[0],second=noJan[1];if(!first||first.similarity<72||first.richness<1)return null;if(second&&first.score-second.score<8)return null;
  return {hit:first.hit,jan:null,accepted:first.accepted,confidence:Math.min(.86,.70+first.similarity/500+first.richness*.015),basis:"strong_unique_no_jan_specialist"};
}

async function selfDiscoverProduct(env,query){
  if(!PIPELINE.selfDiscoveryEnabled||!env.YAHOO_CLIENT_ID)return null;const q=String(query||"").trim();if(!q)return null;let result;
  try{const jan=cleanJan(q);result=await yahooRequest(env,jan?{jan_code:jan}:{query:q},PIPELINE.selfDiscoveryYahooHits);}catch(e){console.warn("self discovery Yahoo failed",safeError(e));return null;}
  const selected=chooseSelfDiscoveryYahooHit(q,result.hits||[]);if(!selected)return null;
  if(selected.jan){const existing=await loadProductsByJans(env,[selected.jan]);if(existing.length)return existing[0];}
  const now=new Date().toISOString(),hit=selected.hit,name=cleanOfficialTitle(hit.name||q)||q,c=selected.accepted?.classification||classifyProduct(name),sp=specialistProfile(name,c.type),ident=selected.accepted?{source_key:selected.accepted.source_key,identity:selected.accepted.canonical_identity,fingerprint:selected.accepted.canonical_fingerprint,identity_method:selected.accepted.jan?"jan":"canonical_fingerprint"}:collectibleIdentityKey(name,c.type,selected.jan);
  if(!selected.jan){const existing=await loadProductsBySourceKeys(env,[ident.source_key]);if(existing.length)return existing[0];}
  const yahoo=await ensureYahooSource(env),sourceKey=selected.jan?`self:yahoo:jan:${selected.jan}`:`self:yahoo:${ident.source_key}`;
  const payload={canonical_name_ja:name,canonical_name_en:null,manufacturer:null,brand:sp.brand||null,series:sp.set_code||sp.lottery_series||null,franchise:sp.card_game||sp.collaboration||null,character_names:[],jan_code:selected.jan||null,model_number:sp.style_code||sp.card_number||null,product_type:c.type,scale:sp.scale||null,edition:sp.edition||sp.rarity||null,limited_type:(sp.limited||sp.event_limited)?"limited":null,msrp_jpy:null,original_release_date:null,official_url:null,official_image_url:hit.exImage?.url||hit.image?.medium||hit.image?.small||null,image_source_url:hit.url||null,image_status:(hit.exImage?.url||hit.image?.medium||hit.image?.small)?"found":"pending",source_id:yahoo.source_id||null,source_product_key:sourceKey,product_status:"active",identification_confidence:selected.confidence,source_last_checked_at:now,metadata:{connector:"self_discovery",self_discovered:true,self_discovered_no_jan:!selected.jan,specialist_intelligence:true,specialist:sp,discovery_query:q,discovery_basis:selected.basis,discovery_source:"yahoo_shopping",canonical_identity_method:ident.identity_method||null,canonical_identity:ident.identity||null,canonical_fingerprint:ident.fingerprint||null,classification:{...c,version:VERSION},field_provenance:{jan_code:selected.jan?sourceEvidence("yahoo_self_discovery",now):null,canonical_name_ja:sourceEvidence("yahoo_self_discovery",now)},quality_version:VERSION,ingestion_version:VERSION}};
  try{const rows=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});const product=rows?.[0]||null;if(product)await logEvent(env,"product_self_discovered",{product_id:product.id,metadata:{query:q,jan:selected.jan||null,basis:selected.basis,no_jan:!selected.jan}});return product;}catch{try{return selected.jan?(await loadProductsByJans(env,[selected.jan]))[0]||null:(await loadProductsBySourceKeys(env,[sourceKey]))[0]||null;}catch{return null;}}
}

/* =========================================================
   QUALITY
========================================================= */

function shouldApplyClassification(current,next){if(!current||current==="other")return true;if(next.type===current)return false;if(next.confidence>=.90)return true;return false;}

async function repairProductQualityBatch(env,limit=PIPELINE.qualityRepairStandalone){
  const max=Math.max(1,Math.min(40,Number(limit)||40)),pool=await loadProductCandidates(env,500),eligible=pool.filter(p=>p?.metadata?.quality_version!==VERSION),rows=eligible.slice(0,max),report={eligible_in_loaded_pool:eligible.length,selected:rows.length,updated:0,reclassified:0,confidence_updated:0,unchanged:0,failed:0,results:[]};
  for(const p of rows){try{const classification=classifyProduct(`${p.canonical_name_ja||""} ${p.canonical_name_en||""}`),effectiveType=(shouldApplyClassification(String(p.product_type||""),classification)?classification.type:p.product_type),specialist=specialistProfile(`${p.canonical_name_ja||""} ${p.canonical_name_en||""}`,effectiveType),quality=identityQualityReasons(p),confidence=identificationConfidenceFor(p),patch={},metadata={...(p.metadata||{}),classification:{...classification,version:VERSION},specialist_intelligence:true,specialist:{...(p.metadata?.specialist||{}),...Object.fromEntries(Object.entries(specialist).filter(([,v])=>v!==null&&v!==""&&v!==undefined))},identity_quality_score:quality.score,identity_quality_reasons:quality.reasons,quality_last_checked_at:new Date().toISOString(),quality_version:VERSION};let changed=false,reclassified=false,confidenceChanged=false;if(shouldApplyClassification(String(p.product_type||""),classification)){patch.product_type=classification.type;changed=true;reclassified=true;}if(Math.abs(Number(p.identification_confidence||0)-confidence)>.005){patch.identification_confidence=confidence;changed=true;confidenceChanged=true;}if(Number(p.metadata?.identity_quality_score??-1)!==quality.score||String(p.metadata?.classification?.type||"")!==classification.type||p.metadata?.quality_version!==VERSION){patch.metadata=metadata;changed=true;}if(changed){await sb(env,`/products?id=eq.${encodeURIComponent(p.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(patch)});report.updated++;if(reclassified)report.reclassified++;if(confidenceChanged)report.confidence_updated++;report.results.push({id:p.id,name:p.canonical_name_ja||p.canonical_name_en||null,old_type:p.product_type||null,new_type:patch.product_type||p.product_type||null,classification_confidence:classification.confidence,identity_quality:quality.score,identification_confidence:confidence});}else report.unchanged++;}catch(e){report.failed++;report.results.push({id:p.id,error:safeError(e)});}}
  return report;
}

/* =========================================================
   METRICS / ROTATION
========================================================= */

async function growthMetricsScalable(env){
  const categoryTypes=["figure","nendoroid","figma","plush","trading_card","model_kit","acrylic_goods","keychain","badge","lottery_prize","sneaker","apparel","replacement_part","other"];
  const [total,jan,english,msrp,release,official,image,complete,...categoryCounts]=await Promise.all([
    sbCount(env),sbCount(env,"jan_code=not.is.null"),sbCount(env,"canonical_name_en=not.is.null"),sbCount(env,"msrp_jpy=not.is.null"),sbCount(env,"original_release_date=not.is.null"),sbCount(env,"official_url=not.is.null"),sbCount(env,"official_image_url=not.is.null"),sbCount(env,["jan_code=not.is.null","canonical_name_en=not.is.null","msrp_jpy=not.is.null","original_release_date=not.is.null","official_url=not.is.null","official_image_url=not.is.null"].join("&")),...categoryTypes.map(t=>sbCount(env,`product_type=eq.${encodeURIComponent(t)}`))
  ]);
  const byType=Object.fromEntries(categoryTypes.map((t,i)=>[t,categoryCounts[i]||0])),pct=n=>total?Number((Number(n||0)/total*100).toFixed(1)):0;
  const merchandise={figures:(byType.figure||0)+(byType.nendoroid||0)+(byType.figma||0),plush:byType.plush||0,trading_cards:byType.trading_card||0,model_kits:byType.model_kit||0,acrylic_goods:byType.acrylic_goods||0,keychains:byType.keychain||0,badges:byType.badge||0,lottery_prizes:byType.lottery_prize||0,sneakers:byType.sneaker||0,apparel:byType.apparel||0};
  return {total_products:total,complete_products:{count:complete,percent:pct(complete)},jan:{count:jan,percent:pct(jan)},english_name:{count:english,percent:pct(english)},msrp:{count:msrp,percent:pct(msrp)},release_date:{count:release,percent:pct(release)},official_url:{count:official,percent:pct(official)},official_image:{count:image,percent:pct(image)},classification:{...byType,other_percent:pct(byType.other)},merchandise_counts:merchandise,market_freshness:{live_hours:24,auto_refresh_hours:PIPELINE.marketAutoRefreshHours,history_window_days:PIPELINE.marketFreshDays},scale_target:{milestone_500:total>=500,milestone_2000:total>=2000,milestone_10000:total>=10000,tens_of_thousands:total>=20000},scalable_count_queries:true};
}

function rotationSlotFromTime(timeMs=Date.now()){return Math.floor(Number(timeMs)/3600000)%ROTATION.length;}
function autonomousStage(timeMs=Date.now()){return ROTATION[rotationSlotFromTime(timeMs)];}
function nextRotationStages(timeMs=Date.now(),count=4){const slot=rotationSlotFromTime(timeMs);return Array.from({length:count},(_,i)=>ROTATION[(slot+i)%ROTATION.length]);}
function nestedFailures(result){if(!result)return 0;if(Array.isArray(result))return result.filter(x=>x?.error).length;if(Array.isArray(result.errors))return result.errors.length;if(Array.isArray(result.results))return result.results.filter(x=>x?.error).length+(result.errors?.length||0);if(Array.isArray(result.products))return result.products.filter(x=>x?.error).length+(result.errors?.length||0);return 0;}

async function runRotationStage(env,stage,mode="cron",options={}){
  const normalized=normalizeStage(stage);if(!normalized)throw new Error(`Invalid stage: ${stage}`);const report={service:"ANIME INTELLIGENCE",version:VERSION,architecture:"FREE_WORKER_8_STAGE_ROTATION",mode,stage:normalized,started_at:new Date().toISOString(),result:null,errors:[]};
  try{if(normalized==="mass")report.result=await massDiscoverGoodSmile(env,mode==="cron"?PIPELINE.massSeedsCron:PIPELINE.massSeedsStandalone,{timeMs:options.timeMs||Date.now()});else if(normalized==="official")report.result=await refreshOfficialBatch(env,mode==="cron"?PIPELINE.officialDetailCron:PIPELINE.officialDetailStandalone,{timeMs:options.timeMs||Date.now()});else if(normalized==="backfill")report.result=await backfillOfficialDetails(env,mode==="cron"?PIPELINE.backfillCron:PIPELINE.backfillStandalone);else if(normalized==="yahoo")report.result=!env.YAHOO_CLIENT_ID?{status:"YAHOO_NOT_CONFIGURED"}:await refreshYahooBatch(env,mode==="cron"?PIPELINE.yahooCron:PIPELINE.yahooStandalone);else if(normalized==="ebay")report.result=!env.EBAY_CLIENT_ID||!env.EBAY_CLIENT_SECRET?{status:"EBAY_NOT_CONFIGURED"}:await refreshEbayBatch(env,mode==="cron"?PIPELINE.ebayCron:PIPELINE.ebayStandalone);else if(normalized==="metrics")report.result=await growthMetricsScalable(env);}catch(e){report.errors.push({stage:normalized,error:safeError(e)});}report.finished_at=new Date().toISOString();const nested=nestedFailures(report.result);report.status=report.errors.length?"failed":nested?"partial":"complete";report.ok=report.status==="complete";report.partial_success=report.status==="partial";report.failure_count=report.errors.length+nested;return report;
}

/* =========================================================
   INTELLIGENCE
========================================================= */

function observationEffectivePrice(o){const p=Number(o.price_jpy),s=o.shipping_jpy==null?0:Number(o.shipping_jpy);return Number.isFinite(p)&&p>0?p+(Number.isFinite(s)&&s>0?s:0):null;}
function freshnessStatusFromAge(ageHours){if(ageHours==null||!Number.isFinite(ageHours))return "empty";if(ageHours<=24)return "live";if(ageHours<=168)return "recent";if(ageHours<=PIPELINE.marketFreshDays*24)return "aging";return "stale";}

function marketView(product,obs){
  const cutoff=Date.now()-PIPELINE.marketFreshDays*86400000,freshObs=obs.filter(o=>{const t=Date.parse(o.observed_at||"");return Number.isFinite(t)&&t>=cutoff;}),latest=latestObservationMap(freshObs),offers=[...latest.values()].filter(o=>observationEffectivePrice(o)!=null&&o.in_stock!==false).sort((a,b)=>observationEffectivePrice(a)-observationEffectivePrice(b)),market=offers.filter(o=>o.metadata?.market_source!=="official"),basis=market.length?market:offers,prices=basis.map(observationEffectivePrice).filter(Number.isFinite),msrp=Number(product.msrp_jpy)||null,low=prices.length?Math.min(...prices):null,med=median(prices),high=prices.length?Math.max(...prices):null,newest=freshObs.map(o=>Date.parse(o.observed_at||"")).filter(Number.isFinite).sort((a,b)=>b-a)[0]||null,ageHours=newest?Number(((Date.now()-newest)/3600000).toFixed(1)):null,best=basis[0]||null;
  return {market_basis:"active_asking_offers",sold_price_data_available:false,freshness_window_days:PIPELINE.marketFreshDays,freshness_status:freshnessStatusFromAge(ageHours),newest_observed_at:newest?new Date(newest).toISOString():null,age_hours:ageHours,total_observations:obs.length,fresh_observations:freshObs.length,stale_observations:obs.length-freshObs.length,offer_count:basis.length,lowest_total_price_jpy:low,median_total_price_jpy:med,highest_total_price_jpy:high,lowest_price_jpy:low,median_price_jpy:med,highest_price_jpy:high,msrp_jpy:msrp,lowest_vs_msrp_pct:msrp&&low?Number(((low-msrp)/msrp*100).toFixed(1)):null,median_vs_msrp_pct:msrp&&med?Number(((med-msrp)/msrp*100).toFixed(1)):null,best_place:best?{source:best.metadata?.market_source||"unknown",seller:best.seller_name,asking_price_jpy:Number(best.price_jpy),shipping_jpy:best.shipping_jpy==null?null:Number(best.shipping_jpy),total_price_jpy:observationEffectivePrice(best),price_jpy:observationEffectivePrice(best),url:best.listing_url,condition:best.item_condition,observed_at:best.observed_at}:null,transaction_evidence:{sold_observations:0,available:false,note:"Current connectors provide active asking offers; sold/completed transaction data is not claimed."}};
}

function rarityAnalysis(product,market){const age=daysSince(product.original_release_date),n=market.offer_count||0,premium=market.median_vs_msrp_pct,sp=productSpecialistProfile(product),t=String(product.product_type||"");let score=25;if(n===0)score+=35;else if(n<=2)score+=28;else if(n<=5)score+=18;else if(n<=10)score+=8;if(premium!=null){if(premium>=100)score+=30;else if(premium>=50)score+=22;else if(premium>=20)score+=12;else if(premium<-10)score-=10;}if(age>730)score+=10;else if(age>365)score+=6;if(product.limited_type)score+=10;if(t==="trading_card"&&sp.rarity&&/SAR|UR|SEC|SP|SSP|HR/i.test(String(sp.rarity)))score+=10;if(t==="trading_card"&&sp.grading_company&&Number(sp.grade)>=10)score+=7;if(t==="lottery_prize"&&/LAST|\u30e9\u30b9\u30c8\u30ef\u30f3/i.test(String(sp.prize_rank||"")))score+=12;if((t==="sneaker"||t==="apparel")&&sp.collaboration)score+=5;if(product.product_status==="preorder")score-=20;if(product.metadata?.rerelease)score-=10;score=Math.round(clamp(score));return {score,level:score>=80?"very_high":score>=60?"high":score>=40?"medium":"low",rerelease_known:!!product.metadata?.rerelease,specialist_context:sp};}

function authenticityRisk(product,market,obs){let score=15;const reasons=[];if(market.msrp_jpy&&market.lowest_price_jpy&&market.lowest_price_jpy<market.msrp_jpy*.45){score+=30;reasons.push("Price is less than 45% of MSRP");}const cutoff=Date.now()-PIPELINE.marketFreshDays*86400000;if(obs.some(o=>(Date.parse(o.observed_at||"")||0)>=cutoff&&/\u30ce\u30fc\u30d6\u30e9\u30f3\u30c9|\u30b3\u30d4\u30fc|custom|unbranded|bootleg|recast|replica|fake/i.test(String(o.listing_title||"")))){score+=25;reasons.push("Suspicious listing terminology");}score=Math.round(clamp(score));return {score,level:score>=70?"high":score>=40?"medium":"low",reasons};}

function buyWaitDecision(product,market,rarity,auth,lang){const msrp=market.msrp_jpy,low=market.lowest_price_jpy,med=market.median_price_jpy;if(auth.level==="high")return {decision:"AVOID",confidence:"high",reason:msg(lang,"avoid")};if(!low)return {decision:product.buy_wait_status||"WATCH",confidence:"low",reason:msg(lang,"noMarket")};if(product.product_status==="preorder"&&msrp&&low<=msrp*1.05)return {decision:"BUY",confidence:"high",reason:msg(lang,"nearMsrp")};if(msrp&&low<=msrp*.9)return {decision:"BUY",confidence:"high",reason:msg(lang,"belowMsrp")};if(med&&low<=med*.85)return {decision:"BUY",confidence:"medium",reason:msg(lang,"belowMedian")};if(rarity.level==="very_high")return {decision:"BUY",confidence:"medium",reason:msg(lang,"scarce")};return {decision:"WATCH",confidence:"medium",reason:msg(lang,"watch")};}

async function refreshLiveMarketForProduct(env,product,obs=[]){
  const log=[];
  if(env.YAHOO_CLIENT_ID){try{const status=await ensureYahooSource(env),search=await yahooSearch(env,product,30),inserted=await saveYahooObservations(env,product,search.hits,obs,status.source_id);log.push({source:"yahoo",ok:true,returned:search.returned,matches:search.hits.length,inserted});}catch(e){log.push({source:"yahoo",ok:false,error:safeError(e)});}}
  if(env.EBAY_CLIENT_ID&&env.EBAY_CLIENT_SECRET){try{const r=await refreshEbayBatch(env,1,{products:[product]});log.push({source:"ebay",ok:true,matches:r.products?.[0]?.matches||0,inserted:r.products?.[0]?.inserted||0});}catch(e){log.push({source:"ebay",ok:false,error:safeError(e)});}}
  await logEvent(env,"market_refresh",{product_id:product.id,metadata:{sources:log.map(x=>({source:x.source,ok:x.ok,matches:x.matches||0,inserted:x.inserted||0}))}});
  return log;
}

async function buildIntelligence(env,product,refresh=false,lang="en",options={}){
  let obs=await getObservations(env,product.id);const initialMarket=marketView(product,obs),autoRefresh=options.autoRefresh===true&&(initialMarket.age_hours==null||initialMarket.age_hours>PIPELINE.marketAutoRefreshHours),refreshRequested=refresh||autoRefresh;let refresh_log=[];if(refreshRequested){refresh_log=await refreshLiveMarketForProduct(env,product,obs);obs=await getObservations(env,product.id);}const market=marketView(product,obs),rarity=rarityAnalysis(product,market),authenticity=authenticityRisk(product,market,obs),buyWait=buyWaitDecision(product,market,rarity,authenticity,lang),quality=identityQualityReasons(product);
  let rakuten;try{rakuten=await rakutenSearch(env,product);}catch(e){rakuten={configured:rakutenConfigured(env),mode:"affiliate_link_only",web_service_api:false,offers:[],best:null,search_url:rakutenPublicSearchUrl(product),affiliate_ready:false,error:safeError(e)};}
  const rakutenBest=rakuten.offers?.find(x=>Number(x.total_price_jpy)>0)||null,marketBest=market.best_place||null;let purchaseBest=marketBest;if(rakutenBest&&(!marketBest||Number(rakutenBest.total_price_jpy)<Number(marketBest.total_price_jpy||marketBest.price_jpy||Infinity))){purchaseBest={source:"rakuten",seller:rakutenBest.seller,asking_price_jpy:rakutenBest.price_jpy,shipping_jpy:rakutenBest.shipping_jpy,total_price_jpy:rakutenBest.total_price_jpy,price_jpy:rakutenBest.total_price_jpy,url:rakutenBest.affiliate_url,affiliate:true,observed_at:new Date().toISOString()};}
  return {language:lang,product:{id:product.id,name_ja:cleanOfficialTitle(product.canonical_name_ja),name_en:cleanOfficialTitle(product.canonical_name_en),manufacturer:product.manufacturer,brand:product.brand,series:product.series,franchise:product.franchise,characters:product.character_names,jan_code:product.jan_code,model_number:product.model_number,product_type:product.product_type,specialist_attributes:productSpecialistProfile(product),identity_quality:quality.score,identification_confidence:product.identification_confidence??identificationConfidenceFor(product),scale:product.scale,edition:product.edition,limited_type:product.limited_type,msrp_jpy:product.msrp_jpy,release_date:product.original_release_date,latest_official_schedule_date:product.metadata?.latest_official_schedule_date||product.metadata?.calendar?.date||null,release_date_type:product.metadata?.release_date_type||product.metadata?.calendar?.date_type||null,rerelease:!!product.metadata?.rerelease,rerelease_generation:product.metadata?.rerelease_generation||product.metadata?.calendar?.rerelease_generation||null,possible_release_delay:!!product.metadata?.possible_release_delay,status:product.product_status,official_url:product.official_url,official_english_url:product.metadata?.official_english_url||null,image_url:product.official_image_url},market,rarity,authenticity_risk:authenticity,buy_wait:buyWait,best_place:purchaseBest,routing:{yahoo:market.best_place?.source==="yahoo_shopping"?market.best_place:null,ebay:market.best_place?.source==="ebay"?market.best_place:null,rakuten:{configured:rakuten.configured,mode:rakuten.mode,affiliate_ready:rakuten.affiliate_ready,offers:rakuten.offers||[],best:rakuten.best||null,search_url:rakuten.search_url,pricing_source:rakuten.pricing_source}},freshness:{product_last_checked:product.source_last_checked_at||null,market_observations:obs.length,newest_market_observation:market.newest_observed_at,market_age_hours:market.age_hours,market_status:market.freshness_status,auto_refresh_threshold_hours:PIPELINE.marketAutoRefreshHours,refresh_requested:refreshRequested,refresh_log},affiliate:{rakuten_configured:rakuten.configured,rakuten_mode:rakuten.mode,rakuten_affiliate_ready:rakuten.affiliate_ready,rakuten_candidates:rakuten.offers||[],rakuten_search_url:rakuten.search_url},provenance:product.metadata?.field_provenance||null,generated_at:new Date().toISOString()};
}

function shapePaidResponse(path,intel){
  const base={language:intel.language,generated_at:intel.generated_at};
  if(path==="/v1/identify")return {...base,product:intel.product,provenance:intel.provenance};
  if(path==="/v1/market")return {...base,product:{id:intel.product.id,name_ja:intel.product.name_ja,name_en:intel.product.name_en,jan_code:intel.product.jan_code},market:intel.market,freshness:intel.freshness,routing:intel.routing};
  if(path==="/v1/rarity")return {...base,product:{id:intel.product.id,name_ja:intel.product.name_ja,name_en:intel.product.name_en,jan_code:intel.product.jan_code},rarity:intel.rarity,rerelease:intel.product.rerelease,rerelease_generation:intel.product.rerelease_generation};
  if(path==="/v1/authenticity")return {...base,product:{id:intel.product.id,name_ja:intel.product.name_ja,name_en:intel.product.name_en,jan_code:intel.product.jan_code},authenticity_risk:intel.authenticity_risk};
  if(path==="/v1/buy-wait")return {...base,product:{id:intel.product.id,name_ja:intel.product.name_ja,name_en:intel.product.name_en,jan_code:intel.product.jan_code},buy_wait:intel.buy_wait,market_snapshot:{lowest_price_jpy:intel.market.lowest_price_jpy,median_price_jpy:intel.market.median_price_jpy,msrp_jpy:intel.market.msrp_jpy},rarity:intel.rarity,routing:intel.routing};
  if(path==="/v1/best-place")return {...base,product:{id:intel.product.id,name_ja:intel.product.name_ja,name_en:intel.product.name_en,jan_code:intel.product.jan_code},best_place:intel.best_place,routing:intel.routing};
  return intel;
}

/* =========================================================
   X402 / DISCOVERY
========================================================= */

const DISCOVERY_CONFIG={
  "/v1/identify":{service_name:"ANIME INTELLIGENCE Identify",intent:"Resolve an ambiguous Japanese anime collectible or character merchandise item into one exact canonical product before valuation or purchase.",when_to_use:"Use first for figures, plush, acrylic stands, keychains, badges, lottery prizes, model kits, trading cards, collaboration sneakers or apparel when the exact product, edition or variant is uncertain.",value:"exact_product_identity",tags:["anime-collectibles","japanese-character-goods","anime-merchandise","product-identification","jan-ean","edition-identification","variant-identification","official-product-data","collectibles-shopping"],examples:["Nendoroid Hatsune Miku","ONE PIECE \u7f36\u30d0\u30c3\u30b8","\u30dd\u30b1\u30e2\u30f3\u30ab\u30fc\u30c9 \u30d6\u30fc\u30b9\u30bf\u30fc\u30d1\u30c3\u30af","CONVERSE NARUTO SHIPPUDEN 31317140"],output_fields:["canonical identity","product type","JAN/EAN","manufacturer or brand","series or franchise","edition or variant","release data","official source evidence","identity quality"],description:"Identify the exact Japanese anime collectible or character merchandise item before pricing or buying. Resolves figures, plush, acrylic goods, keychains, badges, lottery prizes, model kits, trading cards, collaboration sneakers and apparel using JAN/EAN, model or style codes, manufacturer or brand data, aliases and canonical identity evidence."},
  "/v1/market":{service_name:"ANIME INTELLIGENCE Market",intent:"Get current asking-price and market-value intelligence for an identified Japanese anime collectible.",when_to_use:"Use after identity is known for current price, market value, resale value, price range, cheapest matched offer or availability across supported marketplaces.",value:"current_market_prices",tags:["anime-collectibles","japanese-character-goods","anime-merchandise","collectible-price","collectible-valuation","market-value","resale-value","price-comparison","yahoo-japan","ebay"],examples:["Nendoroid Hatsune Miku","ONE PIECE \u4e00\u756a\u304f\u3058 A\u8cde","CONVERSE NARUTO SHIPPUDEN 31317140"],output_fields:["lowest price","median price","highest price","offer count","market freshness","best matched listing","purchase routing"],description:"Current matched asking-price and market-value intelligence for Japanese anime collectibles and character merchandise. Uses supported marketplace observations to estimate low, median and high asking prices, offer count, freshness and best matched purchase route while rejecting likely identity mismatches."},
  "/v1/rarity":{service_name:"ANIME INTELLIGENCE Rarity",intent:"Estimate scarcity, collectibility and rerelease or replenishment risk for the exact item.",when_to_use:"Use for rare, limited, discontinued, hard-to-find, collectible, appreciation or rerelease-risk questions across supported anime collectible categories.",value:"scarcity_and_rerelease_risk",tags:["anime-collectibles","collectible-rarity","collectible-scarcity","limited-edition","hard-to-find","rerelease-risk","anime-merchandise","trading-card-rarity"],examples:["ONE PIECE \u4e00\u756a\u304f\u3058 \u9650\u5b9a A\u8cde","Nendoroid 1000","limited anime collaboration sneaker"],output_fields:["rarity score","rarity level","supply signals","price premium signals","rerelease or replenishment risk"],description:"Estimate rarity, scarcity and rerelease or replenishment risk for Japanese anime collectibles using matched supply, price premium, release age, limited-edition metadata and known release signals. Supports figures and character goods as well as specialist collectible categories."},
  "/v1/authenticity":{service_name:"ANIME INTELLIGENCE Authenticity Risk",intent:"Estimate counterfeit, bootleg or suspicious-listing risk before an agent recommends a purchase.",when_to_use:"Use for suspiciously cheap offers, bootleg concerns, missing official references, questionable listings or authenticity risk across supported collectible categories.",value:"counterfeit_and_listing_risk",tags:["anime-collectibles","bootleg-detection","counterfeit-risk","authenticity","listing-risk","collectible-safety","anime-merchandise"],examples:["Is this Nendoroid likely authentic?","Is this cheap anime collectible listing suspicious?"],"output_fields":["risk score","risk level","risk reasons","suspicious listing signals"],description:"Assess counterfeit, bootleg and suspicious-listing risk for Japanese anime collectibles and character merchandise before purchase. Combines canonical identity, official references, price relationships and matched listing signals to surface risk rather than treating every cheap offer as equivalent."},
  "/v1/buy-wait":{service_name:"ANIME INTELLIGENCE BUY-WAIT",intent:"Turn product identity, price, scarcity and risk signals into a concrete purchase-timing decision.",when_to_use:"Use when the user asks whether to BUY, WAIT, WATCH or AVOID a figure, character good, card, collaboration sneaker, apparel item or other supported collectible.",value:"buy_wait_watch_avoid_decision",tags:["anime-collectibles","buy-or-wait","shopping-decision","collectible-price","rerelease-risk","anime-merchandise","purchase-timing"],examples:["Should I buy this Nendoroid now?","Buy or wait for this ONE PIECE lottery prize?","Should I buy this anime collaboration sneaker now?"],"output_fields":["decision","decision reasons","market snapshot","rarity context","risk context","purchase routing"],description:"Return BUY, WAIT, WATCH or AVOID for an identified Japanese anime collectible using current price, reference price, availability, rarity, rerelease or replenishment risk and authenticity signals. Designed as a direct decision layer for autonomous shopping agents."},
  "/v1/best-place":{service_name:"ANIME INTELLIGENCE Best Place to Buy Anime Collectibles",intent:"Find the best place to buy an identified Japanese anime collectible, anime figure or Nendoroid by comparing current seller offers, price and availability.",when_to_use:"Use when an agent asks best place to buy, where to buy, cheapest matched offer, lowest current price, seller availability, Japan purchase route, marketplace comparison or best current seller for an anime figure, Nendoroid or other supported collectible.",value:"best_current_purchase_route",tags:["anime-collectibles","anime-figure","nendoroid","best-place-to-buy","where-to-buy","cheapest-offer","lowest-price","seller","availability","japan-shopping","marketplace-comparison","purchase-route","shopping-agent"],examples:["Best place to buy a Nendoroid anime figure in Japan?","Where can I buy this anime collectible at the cheapest matched price?","Find the best seller and current available offer for this figure."],"output_fields":["best purchase route","matched seller offer","current price","seller","availability","identity match quality","market freshness"],description:"Best place to buy Japanese anime collectibles, anime figures and Nendoroids. Find where to buy an identified item by comparing current matched seller offers, cheapest price, availability, marketplace, identity quality and freshness, then return the best current purchase route and seller."},
  "/v1/full-intelligence":{service_name:"ANIME INTELLIGENCE Full Intelligence",intent:"Make one end-to-end valuation, risk, timing and purchase-route decision for a Japanese anime collectible.",when_to_use:"Use when the agent needs identity, market value, rarity, authenticity risk, BUY-WAIT and best purchase route together for figures, character goods, cards, collaboration sneakers or apparel.",value:"complete_collectible_intelligence",tags:["anime-collectibles","japanese-character-goods","anime-merchandise","collectibles-intelligence","collectible-valuation","market-value","resale-value","rarity","authenticity","buy-or-wait","where-to-buy","shopping-agent","purchase-decision"],examples:["Full intelligence for Nendoroid Hatsune Miku","Is this ONE PIECE collectible worth buying and where?","Full intelligence for a NARUTO collaboration sneaker"],output_fields:["identity","product type","market","rarity","rerelease or replenishment status","authenticity risk","BUY-WAIT","best place","purchase routing","freshness"],description:"Complete Japanese anime collectibles intelligence in one paid call: resolve the exact item, estimate current market value, assess rarity and rerelease or replenishment risk, flag authenticity concerns, decide BUY/WAIT/WATCH/AVOID and return the best current purchase route. Covers figures, plush, acrylic goods, keychains, badges, lottery prizes, model kits, trading cards, collaboration sneakers and apparel."}
};

const DISCOVERY_LANGUAGES=["ja","en","zh","ko","es","fr","de","it","pt","id","th","ru","ar","hi","vi","tr","nl","pl"];
const MULTILINGUAL_DISCOVERY_EXAMPLES={"en":["anime figure","Pokemon plush","ONE PIECE figure"],"ja":["\u30a2\u30cb\u30e1 \u30d5\u30a3\u30ae\u30e5\u30a2","\u30dd\u30b1\u30e2\u30f3 \u306c\u3044\u3050\u308b\u307f","\u30ef\u30f3\u30d4\u30fc\u30b9 \u30d5\u30a3\u30ae\u30e5\u30a2"],"fr":["figurine anime","peluche Pok\u00e9mon","figurine One Piece"],"es":["figura anime","peluche Pok\u00e9mon","figura One Piece"],"de":["Anime-Figur","Pok\u00e9mon-Pl\u00fcschtier","One Piece Figur"],"it":["figura anime","peluche Pok\u00e9mon","figura One Piece"],"pt":["figura de anime","pel\u00facia Pok\u00e9mon","figura One Piece"],"zh":["\u52a8\u6f2b\u624b\u529e","\u5b9d\u53ef\u68a6\u6bdb\u7ed2\u73a9\u5177","\u6d77\u8d3c\u738b\u624b\u529e"],"zh-TW":["\u52d5\u6f2b\u516c\u4ed4","\u5bf6\u53ef\u5922\u7d68\u6bdb\u73a9\u5177","\u822a\u6d77\u738b\u516c\u4ed4"],"ko":["\uc560\ub2c8 \ud53c\uaddc\uc5b4","\ud3ec\ucf13\ubaac \ubd09\uc81c\uc778\ud615","\uc6d0\ud53c\uc2a4 \ud53c\uaddc\uc5b4"],"ru":["\u0430\u043d\u0438\u043c\u0435 \u0444\u0438\u0433\u0443\u0440\u043a\u0430","\u043c\u044f\u0433\u043a\u0430\u044f \u0438\u0433\u0440\u0443\u0448\u043a\u0430 Pokemon","\u0444\u0438\u0433\u0443\u0440\u043a\u0430 One Piece"],"ar":["\u0645\u062c\u0633\u0645\u0627\u062a \u0627\u0646\u0645\u064a","\u062f\u0645\u064a\u0629 \u0628\u0648\u0643\u064a\u0645\u0648\u0646","\u0645\u062c\u0633\u0645 \u0648\u0646 \u0628\u064a\u0633"],"hi":["\u090f\u0928\u0940\u092e\u0947 \u092b\u093f\u0917\u0930","\u092a\u094b\u0915\u0947\u092e\u094b\u0928 \u092a\u094d\u0932\u0936","\u0935\u0928 \u092a\u0940\u0938 \u092b\u093f\u0917\u0930"],"id":["figure anime","boneka Pokemon","figure One Piece"],"th":["\u0e1f\u0e34\u0e01\u0e40\u0e01\u0e2d\u0e23\u0e4c\u0e2d\u0e19\u0e34\u0e40\u0e21\u0e30","\u0e15\u0e38\u0e4a\u0e01\u0e15\u0e32\u0e42\u0e1b\u0e40\u0e01\u0e21\u0e2d\u0e19","\u0e1f\u0e34\u0e01\u0e40\u0e01\u0e2d\u0e23\u0e4c\u0e27\u0e31\u0e19\u0e1e\u0e35\u0e0b"],"vi":["m\u00f4 h\u00ecnh anime","th\u00fa b\u00f4ng Pokemon","m\u00f4 h\u00ecnh One Piece"],"tr":["anime fig\u00fcr\u00fc","Pokemon pelu\u015f","One Piece fig\u00fcr\u00fc"],"nl":["anime figuur","Pokemon knuffel","One Piece figuur"],"pl":["figurka anime","pluszak Pokemon","figurka One Piece"]};
const GLOBAL_DISCOVERY_KEYWORDS=["anime","anime figure","anime figures","anime collectible","anime collectibles","anime merch","anime merchandise","anime goods","anime stuff","anime toys","manga merch","manga figures","character goods","Japanese collectibles","Japanese anime goods","Pokemon","Pokemon plush","Pokemon plushie","Pokemon merch","Pokemon merchandise","Pokemon goods","Pokemon stuff","Pokemon toys","ONE PIECE","One Piece figure","One Piece figures","One Piece merch","One Piece goods","Nendoroid","anime Nendoroid","Gunpla","Gundam model kit","trading cards","anime cards","Ichiban Kuji","prize figure","acrylic stand","anime keychain","anime badge","anime apparel","anime sneakers","\u30a2\u30cb\u30e1","\u30a2\u30cb\u30e1 \u30b0\u30c3\u30ba","\u30a2\u30cb\u30e1 \u30d5\u30a3\u30ae\u30e5\u30a2","\u30dd\u30b1\u30e2\u30f3","\u30dd\u30b1\u30e2\u30f3 \u30b0\u30c3\u30ba","\u30dd\u30b1\u30e2\u30f3 \u306c\u3044\u3050\u308b\u307f","\u30ef\u30f3\u30d4\u30fc\u30b9 \u30b0\u30c3\u30ba","figurine anime","figurine manga","figurines manga","produits anime","merch anime","peluche Pokemon","peluches Pokemon","figura anime","figuras anime","merch de anime","productos anime","peluche Pokemon","Anime-Figur","Anime Figuren","Anime Merch","Pokemon Plueschtier","Pokemon Pluesch","prodotti anime","peluche Pokemon","produtos anime","pelucia Pokemon","\u52a8\u6f2b\u5468\u8fb9","\u52a8\u6f2b\u624b\u529e","\u5b9d\u53ef\u68a6\u5468\u8fb9","\u5b9d\u53ef\u68a6\u6bdb\u7ed2\u73a9\u5177","\u52d5\u6f2b\u5468\u908a","\u52d5\u6f2b\u516c\u4ed4","\u5bf6\u53ef\u5922\u5468\u908a","\u5bf6\u53ef\u5922\u7d68\u6bdb\u73a9\u5177","\uc560\ub2c8 \uad7f\uc988","\uc560\ub2c8 \ud53c\uaddc\uc5b4","\ud3ec\ucf13\ubaac \uad7f\uc988","\ud3ec\ucf13\ubaac \ubd09\uc81c\uc778\ud615","\u0430\u043d\u0438\u043c\u0435 \u043c\u0435\u0440\u0447","\u0430\u043d\u0438\u043c\u0435 \u0444\u0438\u0433\u0443\u0440\u043a\u0430","\u0645\u0646\u062a\u062c\u0627\u062a \u0627\u0644\u0623\u0646\u0645\u064a","\u0645\u062c\u0633\u0645\u0627\u062a \u0627\u0646\u0645\u064a","\u090f\u0928\u0940\u092e\u0947 \u092e\u0930\u094d\u091a","\u090f\u0928\u0940\u092e\u0947 \u092b\u093f\u0917\u0930","merch anime indonesia","merch anime thailand","\u0e1f\u0e34\u0e01\u0e40\u0e01\u0e2d\u0e23\u0e4c\u0e2d\u0e19\u0e34\u0e40\u0e21\u0e30","do choi anime","anime urunleri","anime merch nederland","gadzet anime"];

const INDEX402_SERVICES=[
  ["/v1/identify","ANIME INTELLIGENCE Identify",.005],
  ["/v1/market","ANIME INTELLIGENCE Market",.01],
  ["/v1/rarity","ANIME INTELLIGENCE Rarity",.01],
  ["/v1/authenticity","ANIME INTELLIGENCE Authenticity",.02],
  ["/v1/buy-wait","ANIME INTELLIGENCE Buy Wait",.02],
  ["/v1/best-place","ANIME INTELLIGENCE Best Place to Buy Anime Collectibles",.03],
  ["/v1/full-intelligence","ANIME INTELLIGENCE Full Intelligence",.05]
].map(x=>({path:x[0],name:x[1],price_usd:x[2],description:DISCOVERY_CONFIG[x[0]].description}));

function facilitatorUrl(env){return DEFAULT_X402_FACILITATOR.replace(/\/$/,"");}
function isCdpFacilitator(env){return facilitatorUrl(env).includes("api.cdp.coinbase.com/platform/v2/x402");}
function b64urlBytes(bytes){let bin="";for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function b64urlJson(obj){return b64urlBytes(new TextEncoder().encode(JSON.stringify(obj)));}
function decodeBase64Bytes(value){const clean=String(value||"").trim().replace(/\s+/g,"");let bin;try{bin=atob(clean);}catch{throw new Error("CDP_API_KEY_SECRET is not valid base64");}const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
function randomNonce(){const b=new Uint8Array(16);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
async function cdpJwt(env,method,path){if(!env.CDP_API_KEY_ID)throw new Error("CDP_API_KEY_ID is missing");if(!env.CDP_API_KEY_SECRET)throw new Error("CDP_API_KEY_SECRET is missing");const raw=decodeBase64Bytes(env.CDP_API_KEY_SECRET);if(raw.length!==64)throw new Error(`CDP Ed25519 secret must decode to 64 bytes; got ${raw.length}`);const seed=raw.slice(0,32),pub=raw.slice(32,64);const jwk={kty:"OKP",crv:"Ed25519",x:b64urlBytes(pub),d:b64urlBytes(seed),ext:true};const key=await crypto.subtle.importKey("jwk",jwk,{name:"Ed25519"},false,["sign"]);const now=Math.floor(Date.now()/1000),host="api.cdp.coinbase.com",requestPath=String(path).startsWith("/")?String(path):`/${path}`;const header={alg:"EdDSA",typ:"JWT",kid:String(env.CDP_API_KEY_ID),nonce:randomNonce()};const claims={sub:String(env.CDP_API_KEY_ID),iss:"cdp",aud:["cdp_service"],nbf:now,exp:now+120,uri:`${String(method).toUpperCase()} ${host}${requestPath}`};const unsigned=`${b64urlJson(header)}.${b64urlJson(claims)}`;const sig=new Uint8Array(await crypto.subtle.sign({name:"Ed25519"},key,new TextEncoder().encode(unsigned)));return `${unsigned}.${b64urlBytes(sig)}`;}
async function facilitatorHeaders(env,method,path){const h={accept:"application/json"};if(isCdpFacilitator(env))h.authorization=`Bearer ${await cdpJwt(env,method,path)}`;return h;}
async function facilitatorSupport(env){const base=facilitatorUrl(env),u=new URL(`${base}/supported`),path=u.pathname+u.search,h=await facilitatorHeaders(env,"GET",path);const r=await fetch(u.toString(),{headers:h});if(!r.ok){const raw=await r.text();throw new Error(`Facilitator /supported ${r.status}: ${raw.slice(0,500)}`);}return r.json();}
function findSolanaMainnetKind(support){const kinds=Array.isArray(support?.kinds)?support.kinds:Array.isArray(support)?support:[];return kinds.find(k=>Number(k.x402Version||2)===2&&k.scheme==="exact"&&k.network===SOLANA_MAINNET)||null;}
async function cdpDiscoveryGet(env,route,params={}){if(!isCdpFacilitator(env))throw new Error("Coinbase CDP facilitator is not active");const base=facilitatorUrl(env),u=new URL(`${base}${route}`);for(const [k,v] of Object.entries(params)){if(v==null||v==="")continue;if(Array.isArray(v)){for(const x of v)u.searchParams.append(k,String(x));}else u.searchParams.set(k,String(v));}const path=u.pathname+u.search,h=await facilitatorHeaders(env,"GET",path),r=await fetch(u.toString(),{headers:h,cache:"no-store"}),raw=await r.text();let body;try{body=raw?JSON.parse(raw):null;}catch{body={raw:raw.slice(0,4000)};}if(!r.ok)throw new Error(`CDP discovery ${route} ${r.status}: ${JSON.stringify(body).slice(0,1200)}`);return body;}
async function cdpBazaarValidateResource(origin,path){
  const resource=`${origin}${path}?query=${encodeURIComponent(DISCOVERY_CONFIG[path]?.examples?.[0]||"Nendoroid Hatsune Miku")}`;
  const u="https://api.cdp.coinbase.com/platform/v2/x402/validate";
  const r=await fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resource,method:"GET"})});
  const raw=await r.text();let body;try{body=raw?JSON.parse(raw):null;}catch{body={raw:raw.slice(0,6000)};}
  return {path,resource,http_status:r.status,ok:r.ok,valid:body?.valid??null,simulation_outcome:body?.simulation?.outcome??null,body};
}
async function bazaarComplianceAudit(origin){
  const results=[];
  for(const x of INDEX402_SERVICES)results.push(await cdpBazaarValidateResource(origin,x.path));
  const requiredFailures=[];
  for(const r of results){
    const checks=Array.isArray(r.body?.checks)?r.body.checks:Array.isArray(r.body?.validation?.checks)?r.body.validation.checks:[];
    for(const c of checks)if(c?.severity==="required"&&c?.passed===false)requiredFailures.push({path:r.path,check:c.check||c.name||null,detail:c.detail||c.message||null});
  }
  return {service:"ANIME INTELLIGENCE",version:VERSION,checked_at:new Date().toISOString(),expected_count:INDEX402_SERVICES.length,accepted_count:results.filter(r=>r.valid===true||r.simulation_outcome==="accepted").length,all_accepted:results.every(r=>r.valid===true||r.simulation_outcome==="accepted"),required_failures:requiredFailures,results};
}
async function bazaarMerchantAudit(env,origin){
  if(!env.X402_WALLET_ADDRESS)throw new Error("X402_WALLET_ADDRESS is missing");
  const body=await cdpDiscoveryGet(env,"/discovery/merchant",{payTo:String(env.X402_WALLET_ADDRESS),limit:20,offset:0});
  const resources=Array.isArray(body?.resources)?body.resources:[];
  const ours=resources.map(x=>compactBazaarResource(x,origin)).filter(x=>x.path);
  const found=new Set(ours.map(x=>x.path));
  return {service:"ANIME INTELLIGENCE",version:VERSION,checked_at:new Date().toISOString(),source:"Coinbase CDP Bazaar merchant discovery",listed:ours.length>0,indexed_count:found.size,expected_count:INDEX402_SERVICES.length,all_indexed:INDEX402_SERVICES.every(s=>found.has(s.path)),missing_paths:INDEX402_SERVICES.map(s=>s.path).filter(p=>!found.has(p)),resources:ours};
}
async function bazaarSemanticAudit(env,origin,query){
  const q=String(query||"anime collectibles").slice(0,160);
  const body=await cdpDiscoveryGet(env,"/discovery/search",{query:q,extensions:"bazaar",limit:20});
  const resources=Array.isArray(body?.resources)?body.resources:[];
  const compact=resources.map(x=>compactBazaarResource(x,origin));
  const ours=compact.map((x,i)=>({...x,rank:i+1})).filter(x=>x.path);
  return {service:"ANIME INTELLIGENCE",version:VERSION,checked_at:new Date().toISOString(),query:q,search_method:body?.searchMethod||null,listed_in_top20:ours.length>0,our_results:ours,total_returned:compact.length};
}

function bazaarResourcePath(resource,origin){try{const u=new URL(String(resource||""));if(u.origin!==origin)return null;return INDEX402_SERVICES.some(s=>s.path===u.pathname)?u.pathname:null;}catch{return null;}}
function compactBazaarResource(x,origin){const path=bazaarResourcePath(x?.resource,origin),accept=Array.isArray(x?.accepts)&&x.accepts.length?x.accepts[0]:null;return {path,resource:x?.resource||null,service_name:x?.serviceName||null,description:x?.description||null,price_atomic:accept?.amount||null,network:accept?.network||null,pay_to:accept?.payTo||null,asset:accept?.asset||null,bazaar:!!x?.extensions?.bazaar,quality:x?.quality||null,tags:x?.tags||[]};}
async function bazaarCheckOne(env,origin,path){
  const service=INDEX402_SERVICES.find(s=>s.path===path);
  if(!service)throw new Error(`Unknown Bazaar path: ${path}`);
  const target=`${origin}${service.path}`;
  let result=null,error=null;
  try{
    // Exactly ONE Coinbase Discovery request per Worker invocation.
    // This is intentionally isolated so Cloudflare's per-invocation
    // subrequest budget is reset for every API checked by the browser.
    result=await cdpDiscoveryGet(env,"/discovery/search",{urlSubstring:target,extensions:"bazaar",limit:20});
  }catch(e){error=safeError(e);}
  const resources=Array.isArray(result?.resources)?result.resources:[];
  const matches=resources.map(x=>compactBazaarResource(x,origin)).filter(x=>x.path===path);
  return {
    service:"ANIME INTELLIGENCE",version:VERSION,checked_at:new Date().toISOString(),
    source:"Coinbase CDP Bazaar Discovery",checker_mode:"one_external_request_per_worker_invocation",
    path,target,outbound_discovery_requests:1,indexed:matches.length>0,count:matches.length,matches,
    error
  };
}
async function bazaarCheck(env,origin){
  // v3.0.9: ZERO outbound Worker subrequests.
  // Cloudflare was throwing "Too many subrequests" even for the Bazaar lookup,
  // so the admin checker no longer proxies Coinbase at all.
  // The browser opens Coinbase's public semantic-search endpoint directly.
  if(!env.X402_WALLET_ADDRESS)throw new Error("X402_WALLET_ADDRESS is missing");
  const payTo=String(env.X402_WALLET_ADDRESS);
  const externalUrl=new URL("https://api.cdp.coinbase.com/platform/v2/x402/discovery/search");
  externalUrl.searchParams.set("payTo",payTo);
  externalUrl.searchParams.set("limit","20");
  const expected=INDEX402_SERVICES.map(s=>({
    path:s.path,
    url:`${origin}${s.path}`,
    price_usdc:s.price_usd
  }));
  return {
    service:"ANIME INTELLIGENCE",
    version:VERSION,
    checked_at:new Date().toISOString(),
    checker_mode:"browser_direct_zero_worker_subrequests",
    outbound_discovery_requests:0,
    pay_to:payTo,
    external_check_url:externalUrl.toString(),
    expected_count:expected.length,
    expected,
    status:"OPEN_EXTERNAL_COINBASE_RESULT",
    instruction:"Open external_check_url in the browser. Coinbase returns the Bazaar search result directly; compare returned resource URLs with expected[].url.",
    errors:[]
  };
}

function bazaarOutputExample(path){
  const d=DISCOVERY_CONFIG[path]||{};
  const common={service:"ANIME INTELLIGENCE",version:VERSION,endpoint:path,charged:true};
  if(path==="/v1/identify")return {...common,product:{id:"canonical-product-uuid",name_ja:"\u5546\u54c1\u6b63\u5f0f\u540d",name_en:"Official Product Name",jan_code:"4580590123456",manufacturer:"Good Smile Company"},identity_quality:95};
  if(path==="/v1/market")return {...common,market:{currency:"JPY",lowest_price_jpy:12800,median_price_jpy:14200,highest_price_jpy:16800,offer_count:6,freshness:"live_or_recent"},best_observed_listing:{source:"yahoo",price_jpy:12800}};
  if(path==="/v1/rarity")return {...common,rarity:{score:74,level:"rare",rerelease_risk:"medium",signals:["limited supply","release age"]}};
  if(path==="/v1/authenticity")return {...common,authenticity_risk:{score:18,level:"low",reasons:["official identity matched","price not abnormally low"]}};
  if(path==="/v1/buy-wait")return {...common,buy_wait:{decision:"BUY",reasons:["price near fair range","supply limited"]},market_snapshot:{lowest_price_jpy:12800}};
  if(path==="/v1/best-place")return {...common,best_place:{source:"yahoo",price_jpy:12800,seller:"example seller",url:"https://example.com/listing"},freshness:"live_or_recent"};
  return {...common,product:{name_en:"Official Product Name",jan_code:"4580590123456"},market:{lowest_price_jpy:12800,median_price_jpy:14200},rarity:{level:"rare"},authenticity_risk:{level:"low"},buy_wait:{decision:"BUY"},best_place:{source:"yahoo",price_jpy:12800},expected_fields:d.output_fields||[]};
}

function bazaarInfoSchema(){
  return {
    "$schema":"https://json-schema.org/draft/2020-12/schema",
    type:"object",
    required:["input","output"],
    properties:{
      input:{
        type:"object",
        required:["type","method","queryParams"],
        properties:{
          type:{type:"string",const:"http"},
          method:{type:"string",const:"GET"},
          queryParams:{
            type:"object",
            properties:{
              query:{type:"string",description:"Product name, JAN/EAN-13, model number or identifying description."},
              id:{type:"string",description:"ANIME INTELLIGENCE canonical product UUID."},
              lang:{type:"string",enum:DISCOVERY_LANGUAGES},
              refresh:{type:"string",enum:["0","1"]}
            },
            additionalProperties:false
          }
        },
        additionalProperties:false
      },
      output:{
        type:"object",
        required:["type","example"],
        properties:{type:{type:"string",const:"json"},example:{type:"object"}},
        additionalProperties:false
      }
    },
    additionalProperties:false
  };
}

function bazaarDiscoveryExtension(path){
  const d=DISCOVERY_CONFIG[path]||{};
  return {
    info:{
      input:{
        type:"http",
        method:"GET",
        queryParams:{query:d.examples?.[0]||"Nendoroid Hatsune Miku",lang:"en"}
      },
      output:{type:"json",example:bazaarOutputExample(path)}
    },
    schema:bazaarInfoSchema()
  };
}

async function paymentRequirement(request,env,amount,description,supportOverride=null){
  if(!env.X402_WALLET_ADDRESS)throw new Error("X402_WALLET_ADDRESS is missing");const support=supportOverride||await facilitatorSupport(env),kind=findSolanaMainnetKind(support);if(!kind)throw new Error("Facilitator does not advertise Solana mainnet");const path=new URL(request.url).pathname,discovery=DISCOVERY_CONFIG[path]||{};
  const searchDescriptions={
    "/v1/identify":"Identify exact Japanese anime collectibles and character merchandise by product name, JAN/EAN, model or style code. Covers figures, Nendoroid, Pokemon and ONE PIECE cards, plush, Gunpla/model kits, Ichiban Kuji prizes, acrylic goods, keychains, badges, collaboration sneakers and apparel.",
    "/v1/market":"Current price, market value, resale value and matched asking-price intelligence for Japanese anime collectibles including figures, Pokemon cards, ONE PIECE cards, plush, Gunpla/model kits, Ichiban Kuji prizes, collaboration sneakers and apparel.",
    "/v1/rarity":"Rarity, scarcity, limited-edition status and rerelease or replenishment risk for Japanese anime collectibles, trading cards, figures, character goods, model kits, sneakers and apparel.",
    "/v1/authenticity":"Counterfeit, bootleg and suspicious-listing risk analysis for Japanese anime collectibles, figures, trading cards, character goods and collaboration merchandise before purchase.",
    "/v1/buy-wait":"BUY, WAIT, WATCH or AVOID purchase-timing decision for Japanese anime collectibles using current market price, rarity, supply, rerelease risk and authenticity signals.",
    "/v1/best-place":"Best place to buy Japanese anime collectibles, anime figures and Nendoroids: compare current seller offers, cheapest matched price, availability and marketplace to return the best purchase route.",
    "/v1/full-intelligence":"One-call purchase intelligence for Japanese anime collectibles: exact identity, current market value, rarity, rerelease risk, authenticity risk, BUY-WAIT decision and best purchase route. Covers figures, Pokemon and ONE PIECE cards, plush, Gunpla, Ichiban Kuji, acrylic goods, sneakers and apparel."
  };
  const resource={url:request.url,description:searchDescriptions[path]||discovery.description||description,mimeType:"application/json",serviceName:discovery.service_name||"ANIME INTELLIGENCE",tags:discovery.tags||[]};const accepted={scheme:"exact",network:SOLANA_MAINNET,amount,asset:SOLANA_USDC,payTo:env.X402_WALLET_ADDRESS,maxTimeoutSeconds:300,...(kind.extra?{extra:kind.extra}:{})};return {required:{x402Version:2,error:"Payment required",resource,accepts:[accepted],extensions:{bazaar:bazaarDiscoveryExtension(path)}},accepted};
}

async function facilitatorPost(env,path,paymentPayload,accepted){const base=facilitatorUrl(env),u=new URL(`${base}${path}`),requestPath=u.pathname+u.search,auth=await facilitatorHeaders(env,"POST",requestPath);const r=await fetch(u.toString(),{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify({x402Version:2,paymentPayload,paymentRequirements:accepted})});const raw=await r.text();let body=null;try{body=raw?JSON.parse(raw):null;}catch{body={raw};}if(!r.ok)throw new Error(`Facilitator ${path} ${r.status}: ${JSON.stringify(body)}`);return body;}

function requestTelemetry(request,url=null){
  const u=url||new URL(request.url),ua=(request.headers.get("user-agent")||"").slice(0,300),referer=(request.headers.get("referer")||"").slice(0,500),country=(request.headers.get("cf-ipcountry")||"").slice(0,8),requestId=request.headers.get("cf-ray")||crypto.randomUUID();
  const low=ua.toLowerCase();let source_class="unknown";
  if(/x402scan/.test(low))source_class="x402scan";
  else if(/402.?index|x402.?index/.test(low))source_class="402_index";
  else if(/402\.ad/.test(low))source_class="402_ad";
  else if(/coinbase|cdp/.test(low))source_class="coinbase_or_cdp";
  else if(/mcp/.test(low))source_class="mcp_client";
  else if(/bot|crawler|spider|scanner|health|probe|uptime|monitor/.test(low))source_class="bot_or_monitor";
  else if(ua)source_class="unclassified_client";
  return {request_id:requestId,method:request.method,user_agent:ua||null,referer:referer||null,country:country||null,source_class,payment_header_present:!!request.headers.get("payment-signature"),query_present:!!u.searchParams.get("query"),id_present:!!u.searchParams.get("id")};
}
async function logRequestStage(env,request,eventType,extra={}){
  try{
    const url=new URL(request.url),base=requestTelemetry(request,url);
    return await logEvent(env,eventType,{endpoint:url.pathname,product_id:extra.product_id||null,payer_hash:extra.payer_hash||null,amount_atomic:extra.amount_atomic??null,amount_usdc:extra.amount_usdc??null,payment_network:extra.payment_network||null,transaction_hash:extra.transaction_hash||null,metadata:{...base,...(extra.metadata||{})}});
  }catch(e){return null;}
}

async function x402Gate(request,env,amount,description,work){
  let cfg;try{cfg=await paymentRequirement(request,env,amount,description);}catch(e){await logRequestStage(env,request,"x402_configuration_error",{metadata:{response_status:503,error:safeError(e)}});return json({error:"x402_configuration_error",detail:safeError(e)},503);}
  const sig=request.headers.get("payment-signature");
  if(!sig){
    await logRequestStage(env,request,"payment_required",{amount_atomic:Number(amount),amount_usdc:Number(amount)/1000000,payment_network:cfg.accepted.network,metadata:{response_status:402,protocol:"x402",version:2}});
    const probeHeaders={
      "PAYMENT-REQUIRED":b64(JSON.stringify(cfg.required)),
      "x402-price":String(Number(amount)/1000000),
      "x402-asset":"USDC",
      "x402-network":cfg.accepted.network,
      "x402-pay-to":cfg.accepted.payTo,
      "cache-control":"no-store"
    };
    return json(cfg.required,402,probeHeaders);
  }
  await logRequestStage(env,request,"payment_attempt",{amount_atomic:Number(amount),amount_usdc:Number(amount)/1000000,payment_network:cfg.accepted.network,metadata:{protocol:"x402",version:2}});
  let payload;try{payload=unb64(sig);}catch{await logRequestStage(env,request,"payment_invalid_header",{metadata:{response_status:402}});return json({error:"invalid_payment_signature_header"},402);}
  const enrichedPayload={...payload,resource:payload?.resource||cfg.required.resource,extensions:{...(cfg.required.extensions||{}),...(payload?.extensions||{})}};
  try{
    const verified=await facilitatorPost(env,"/verify",enrichedPayload,cfg.accepted);
    if(!verified?.isValid){await logRequestStage(env,request,"payment_verify_failed",{metadata:{response_status:402,reason:verified?.invalidReason||null}});return json({error:"payment_invalid",detail:verified?.invalidReason||verified},402);}
    await logRequestStage(env,request,"payment_verified",{metadata:{protocol:"x402",version:2}});
    let result;try{result=await work();}catch(e){
      const notFound=e?.code==="PRODUCT_NOT_FOUND"||e?.message==="product_not_found";
      const status=notFound?404:500;
      await logRequestStage(env,request,notFound?"product_not_found":"service_execution_failed",{metadata:{response_status:status,error:safeError(e)}});
      return json({service:"ANIME INTELLIGENCE",version:VERSION,error:notFound?"product_not_found":"service_execution_failed",charged:false,detail:notFound?"Try an exact JAN/EAN-13 code, model/style code or a more specific official product name.":safeError(e)},status);
    }
    const settlement=await facilitatorPost(env,"/settle",enrichedPayload,cfg.accepted);
    if(!settlement?.success){await logRequestStage(env,request,"payment_settlement_failed",{metadata:{response_status:402}});return json({error:"payment_settlement_failed",charged:false,detail:settlement},402);}
    const payerHash=await payerHashFromPayment(enrichedPayload,settlement),tx=extractSettlementTx(settlement);
    await logRequestStage(env,request,"paid_call",{product_id:result?.product?.id||null,payer_hash:payerHash,amount_atomic:Number(amount),amount_usdc:Number(amount)/1000000,payment_network:cfg.accepted.network,transaction_hash:tx,metadata:{protocol:"x402",version:2,asset:"USDC",response_status:200}});
    return json(result,200,{"PAYMENT-RESPONSE":b64(JSON.stringify(settlement)),"cache-control":"private, no-store"});
  }catch(e){await logRequestStage(env,request,"x402_failed",{metadata:{response_status:402,error:safeError(e)}});return json({error:"x402_failed",detail:safeError(e)},402);}
}

function routePrice(path){return {"/v1/identify":[PRICES.identify,"Identify exact anime collectible"],"/v1/market":[PRICES.market,"Current marketplace intelligence"],"/v1/rarity":[PRICES.rarity,"Rarity intelligence"],"/v1/authenticity":[PRICES.authenticity,"Authenticity risk intelligence"],"/v1/buy-wait":[PRICES.buyWait,"BUY WAIT decision"],"/v1/best-place":[PRICES.bestPlace,"Best purchase route"],"/v1/full-intelligence":[PRICES.full,"Full ANIME INTELLIGENCE report"]}[path]||null;}
function endpointPriceUsd(path){const atomic=routePrice(path)?.[0];return atomic?Number(atomic)/1000000:null;}

function monetizationFunnel(origin,product,currentPath){
  if(!product?.id)return null;const stages=[{path:"/v1/identify",value:"exact_product_identity"},{path:"/v1/market",value:"current_market_prices"},{path:"/v1/rarity",value:"scarcity_and_rerelease_risk"},{path:"/v1/authenticity",value:"counterfeit_and_listing_risk"},{path:"/v1/buy-wait",value:"buy_wait_watch_avoid_decision"},{path:"/v1/best-place",value:"best_current_purchase_route"},{path:"/v1/full-intelligence",value:"complete_collectible_intelligence"}],i=stages.findIndex(x=>x.path===currentPath);return {current_endpoint:currentPath,current_price_usdc:endpointPriceUsd(currentPath),recommended_next:stages.filter((_,n)=>n>i).slice(0,3).map(x=>({endpoint:x.path,price_usdc:endpointPriceUsd(x.path),value:x.value,url:`${origin}${x.path}?id=${encodeURIComponent(product.id)}`})),full_intelligence:{price_usdc:endpointPriceUsd("/v1/full-intelligence"),url:`${origin}/v1/full-intelligence?id=${encodeURIComponent(product.id)}`}};
}

function sanitizeAffiliateRouting(shaped,origin,productId){
  if(shaped.routing?.rakuten?.offers){shaped.routing.rakuten.offers=shaped.routing.rakuten.offers.map(offer=>{const purchase_url=affiliateRedirectUrl(origin,offer,productId);const x={...offer,purchase_url};delete x.affiliate_url;return x;});if(shaped.routing.rakuten.best?.affiliate_url){shaped.routing.rakuten.best={...shaped.routing.rakuten.best,purchase_url:affiliateRedirectUrl(origin,shaped.routing.rakuten.best,productId)};delete shaped.routing.rakuten.best.affiliate_url;}}
  if(shaped.best_place?.source==="rakuten"&&shaped.best_place.url){shaped.best_place.url=affiliateRedirectUrl(origin,{affiliate_url:shaped.best_place.url},productId);shaped.best_place.affiliate=true;}
  if(shaped.affiliate?.rakuten_candidates){shaped.affiliate.rakuten_candidates=shaped.affiliate.rakuten_candidates.map(offer=>{const purchase_url=affiliateRedirectUrl(origin,offer,productId);const x={...offer,purchase_url};delete x.affiliate_url;return x;});}
  return shaped;
}


/* =========================================================
   ATELIER MARKETPLACE AUTOFULFILL
   Required Cloudflare secret:
   ATELIER_API_KEY = secret Atelier machine key (atelier_...)
   Agent id is resolved automatically from GET /api/agents/me.
========================================================= */

let atelierAgentIdCache="";
function atelierConfigured(env){return !!env.ATELIER_API_KEY;}
function atelierHeaders(env,extra={}){return {authorization:`Bearer ${env.ATELIER_API_KEY}`,accept:"application/json","content-type":"application/json",...extra};}
async function atelierFetch(env,path,options={}){
  if(!atelierConfigured(env))throw new Error("Atelier is not configured: ATELIER_API_KEY missing");
  const r=await fetch(`${ATELIER_API}${path}`,{method:options.method||"GET",headers:atelierHeaders(env,options.headers||{}),body:options.body});
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch{data={raw};}
  if(!r.ok)throw new Error(`Atelier ${r.status}: ${raw.slice(0,1200)}`);
  return data;
}
function atelierOrderArray(payload){
  const d=payload?.data;
  if(Array.isArray(d))return d;
  if(Array.isArray(d?.orders))return d.orders;
  if(Array.isArray(payload?.orders))return payload.orders;
  return [];
}
function atelierBrief(order){
  const candidates=[order?.brief,order?.input,order?.prompt,order?.description,order?.request,order?.requirements,order?.metadata?.brief,order?.metadata?.query];
  for(const v of candidates){
    if(typeof v==="string"&&v.trim())return v.trim();
    if(v&&typeof v==="object"){
      for(const k of ["query","product","product_name","item","name","brief","prompt"]){if(typeof v[k]==="string"&&v[k].trim())return v[k].trim();}
      try{const j=JSON.stringify(v);if(j&&j!=="{}")return j.slice(0,1500);}catch{}
    }
  }
  return "";
}
function atelierOrderId(order){return String(order?.id||order?.order_id||order?.orderId||"").trim();}
async function atelierResolveProduct(env,query){
  if(!query)return null;
  const rows=await findProducts(env,query,10);
  if(Array.isArray(rows)&&rows.length)return rows[0];
  return selfDiscoverProduct(env,query);
}
function atelierResultUrl(env,orderId){const host=String(env.WORKER_HOST||"anime-intelligence.goodmy0312.workers.dev").replace(/^https?:\/\//,"").replace(/\/$/,"");return `https://${host}/atelier/result/${encodeURIComponent(orderId)}`;}
async function saveAtelierResult(env,order,query,result){
  const orderId=atelierOrderId(order);if(!orderId)throw new Error("Atelier order id missing");
  await logEvent(env,"atelier_delivery_result",{endpoint:"/atelier/autofulfill",product_id:result?.product?.id||null,metadata:{atelier_order_id:orderId,query:query.slice(0,500),result}});
  return atelierResultUrl(env,orderId);
}
async function loadAtelierResult(env,orderId){
  const id=String(orderId||"").trim();if(!id)return null;
  const rows=await sbOptional(env,`/api_events?select=occurred_at,product_id,metadata&event_type=eq.atelier_delivery_result&metadata->>atelier_order_id=eq.${encodeURIComponent(id)}&order=occurred_at.desc&limit=1`);
  const row=Array.isArray(rows)?rows[0]:null;return row?.metadata?.result?{generated_at:row.occurred_at,order_id:id,...row.metadata.result}:null;
}
async function atelierBuildFullIntelligence(env,order){
  const query=atelierBrief(order);if(!query)throw new Error("Atelier order brief is empty");
  const product=await atelierResolveProduct(env,query);if(!product)throw new Error(`product_not_found: ${query.slice(0,180)}`);
  const lang=detectLanguage(query,"","en");
  const intel=await buildIntelligence(env,product,false,lang,{autoRefresh:true});
  let shaped=shapePaidResponse("/v1/full-intelligence",intel);
  const origin=`https://${String(env.WORKER_HOST||"anime-intelligence.goodmy0312.workers.dev").replace(/^https?:\/\//,"").replace(/\/$/,"")}`;
  shaped=sanitizeAffiliateRouting(shaped,origin,product.id);
  return {service:"ANIME INTELLIGENCE",version:VERSION,channel:"atelier",atelier_order_id:atelierOrderId(order),query,...shaped};
}
async function atelierDeliver(env,orderId,deliverableUrl){
  return atelierFetch(env,`/api/orders/${encodeURIComponent(orderId)}/deliver`,{method:"POST",body:JSON.stringify({deliverable_url:deliverableUrl,deliverable_media_type:"link"})});
}
async function atelierProcessOrder(env,order){
  const orderId=atelierOrderId(order);if(!orderId)return {ok:false,error:"missing_order_id"};
  try{
    await logEvent(env,"atelier_order_received",{endpoint:"/atelier/autofulfill",metadata:{atelier_order_id:orderId,status:order?.status||null,service_id:order?.service_id||order?.service?.id||null}});
    const result=await atelierBuildFullIntelligence(env,order);
    const deliverableUrl=await saveAtelierResult(env,order,result.query,result);
    const delivered=await atelierDeliver(env,orderId,deliverableUrl);
    await logEvent(env,"atelier_order_delivered",{endpoint:"/atelier/autofulfill",product_id:result?.product?.id||null,amount_usdc:Number(order?.price_usd||order?.price||0)||null,payment_network:"atelier",metadata:{atelier_order_id:orderId,deliverable_url:deliverableUrl}});
    return {ok:true,order_id:orderId,product_id:result?.product?.id||null,deliverable_url:deliverableUrl,atelier_response:delivered?.success===true?"accepted":"returned"};
  }catch(e){
    await logEvent(env,"atelier_order_failed",{endpoint:"/atelier/autofulfill",metadata:{atelier_order_id:orderId,error:safeError(e)}});
    return {ok:false,order_id:orderId,error:safeError(e)};
  }
}
async function atelierResolveAgentId(env,{force=false}={}){
  if(!force&&atelierAgentIdCache)return atelierAgentIdCache;
  const me=await atelierFetch(env,"/api/agents/me");
  const agent=me?.data||me||{};
  const id=String(agent.id||agent.agent_id||agent.agentId||"").trim();
  if(!id)throw new Error("Atelier /api/agents/me did not return an agent id");
  atelierAgentIdCache=id;
  return id;
}
async function atelierPollAndFulfill(env){
  if(!atelierConfigured(env))return {configured:false,status:"skipped",reason:"ATELIER_API_KEY_missing"};
  const agentId=await atelierResolveAgentId(env);
  const payload=await atelierFetch(env,`/api/agents/${encodeURIComponent(agentId)}/orders?status=paid,in_progress`);
  const orders=atelierOrderArray(payload).slice(0,ATELIER_MAX_ORDERS_PER_POLL),results=[];
  for(const order of orders)results.push(await atelierProcessOrder(env,order));
  return {configured:true,status:"ok",agent_id:agentId,polled:atelierOrderArray(payload).length,processed:orders.length,delivered:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};
}
function atelierSafeAgentView(agent){
  const a=agent&&typeof agent==="object"?agent:{};
  return {
    id:a.id||a.agent_id||a.agentId||null,
    slug:a.slug||null,
    name:a.name||null,
    description:a.description||null,
    endpoint_url:a.endpoint_url||a.endpointUrl||null,
    capabilities:a.capabilities||null,
    verified:a.verified??null,
    total_orders:a.total_orders??a.totalOrders??null,
    completed_orders:a.completed_orders??a.completedOrders??null,
    avg_rating:a.avg_rating??a.avgRating??null,
    payout_chain:a.payout_chain||a.payoutChain||null,
    solana_payout_configured:a.solana_payout_configured??null,
    base_payout_configured:a.base_payout_configured??null,
    moderation:a.moderation||null,
    created_at:a.created_at||a.createdAt||null
  };
}
async function atelierStatus(env){
  if(!atelierConfigured(env))return {configured:false,api_key_configured:false,agent_id_mode:"auto_from_api_key",poll_every_minutes:ATELIER_POLL_EVERY_MINUTES};
  try{
    const me=await atelierFetch(env,"/api/agents/me");
    const agent=me?.data||me||{};
    const id=String(agent.id||agent.agent_id||agent.agentId||"").trim();
    if(id)atelierAgentIdCache=id;
    return {configured:true,reachable:true,agent_id_mode:"auto_from_api_key",resolved_agent_id:id||null,poll_every_minutes:ATELIER_POLL_EVERY_MINUTES,agent:atelierSafeAgentView(agent)};
  }catch(e){return {configured:true,reachable:false,agent_id_mode:"auto_from_api_key",error:safeError(e),poll_every_minutes:ATELIER_POLL_EVERY_MINUTES};}
}

async function paidApi(request,env,url){
  const rp=routePrice(url.pathname);if(!rp)return null;
  const query=url.searchParams.get("query")||"",lang=detectLanguage(query,url.searchParams.get("lang")||"",request.headers.get("accept-language")||"");
  await logRequestStage(env,request,"api_call",{metadata:{route_type:"paid",intent_query:query?query.slice(0,180):null,intent_id:url.searchParams.get("id")||null}});
  if(query||url.searchParams.get("id"))await logRequestStage(env,request,"product_intent",{metadata:{route_type:"paid",query_text:query?query.slice(0,180):null}});
  let product=null;
  return x402Gate(request,env,rp[0],rp[1],async()=>{
    const id=url.searchParams.get("id")||"";
    product=await resolveProduct(env,url);
    if(!product&&query)product=await selfDiscoverProduct(env,query);
    if(!product){
      const e=new Error("product_not_found");
      e.code="PRODUCT_NOT_FOUND";
      throw e;
    }
    await logEvent(env,"product_requested",{endpoint:url.pathname,product_id:product.id,metadata:{product_type:product.product_type||null,jan_present:!!product.jan_code}});
    const livePaths=new Set(["/v1/market","/v1/rarity","/v1/authenticity","/v1/buy-wait","/v1/best-place","/v1/full-intelligence"]);
    const intel=await buildIntelligence(env,product,url.searchParams.get("refresh")==="1",lang,{autoRefresh:livePaths.has(url.pathname)});
    let shaped=shapePaidResponse(url.pathname,intel);
    shaped=sanitizeAffiliateRouting(shaped,url.origin,product.id);
    return {service:"ANIME INTELLIGENCE",version:VERSION,price_usdc_atomic:rp[0],price_usdc:Number(rp[0])/1000000,...shaped,monetization:monetizationFunnel(url.origin,product,url.pathname)};
  });
}

async function freeSearch(request,env,url){
  const q=url.searchParams.get("query")||"",lang=detectSearchLanguage(q,url.searchParams.get("lang")||"",request?.headers?.get("accept-language")||""),hints=multilingualQueryHints(q),rows=await findProducts(env,q,10);const searchMode=hints.generic_intent&&!hints.product_types.length&&!hints.franchises.length&&!hints.residual_terms.length?"broad_catalog":hints.ambiguous_category_search?"category_only":"targeted";await logRequestStage(env,request,"api_call",{metadata:{route_type:"free",result_count:rows.length,response_status:200,detected_language:lang,ambiguous_category_search:hints.ambiguous_category_search,generic_intent:hints.generic_intent,search_mode:searchMode,product_types:hints.product_types,franchises:hints.franchises}});return {service:"ANIME INTELLIGENCE",version:VERSION,language:lang,query:q,search_interpretation:{product_types:hints.product_types,franchises:hints.franchises,residual_terms:hints.residual_terms,ambiguous_category_search:hints.ambiguous_category_search,generic_intent:hints.generic_intent,search_mode:searchMode},count:rows.length,results:rows.map(p=>({id:p.id,name_ja:cleanNullableTitle(p.canonical_name_ja),name_en:cleanNullableTitle(p.canonical_name_en),manufacturer:cleanNullishValue(p.manufacturer),franchise:discoverySafeFranchise(p),jan_code:cleanNullishValue(p.jan_code),model_number:cleanNullishValue(p.model_number),product_type:discoveryEffectiveType(p),identity_quality:marketIdentityQuality(p),identification_confidence:p.identification_confidence??identificationConfidenceFor(p),msrp_jpy:p.msrp_jpy,release_date:p.original_release_date,status:p.product_status,official_url:p.official_url,image_url:p.official_image_url}))};
}

function discoveryExample(path){const d=DISCOVERY_CONFIG[path]||{};return {service:"ANIME INTELLIGENCE",version:VERSION,endpoint:path,example_query:d.examples?.[0]||"Nendoroid Hatsune Miku",value:d.value||null,note:"Representative response shape; live values depend on the resolved product and current observations."};}

function openapi(origin){
  const commonProduct={type:"object",properties:{id:{type:"string",format:"uuid"},name_ja:{type:["string","null"]},name_en:{type:["string","null"]},manufacturer:{type:["string","null"]},jan_code:{type:["string","null"]},product_type:{type:["string","null"]},identification_confidence:{type:["number","null"]}}};
  const paidResponse={type:"object",properties:{service:{type:"string",const:"ANIME INTELLIGENCE"},version:{type:"string"},price_usdc_atomic:{type:"string"},price_usdc:{type:"number"},product:commonProduct,monetization:{type:["object","null"]},generated_at:{type:["string","null"],format:"date-time"}},additionalProperties:true};
  const paths={"/v1/search":{get:{operationId:"searchAnimeProduct",summary:"Search canonical Japanese anime collectibles for free",description:"Free multilingual fuzzy discovery for Japanese anime collectibles. Use broad natural-language requests such as anime figure, Pokemon plush, ONE PIECE goods, figurine anime, peluche Pokemon, figura anime, Anime-Figur, anime figurka, or equivalent Japanese, Chinese, Korean and other major-language queries before choosing a paid intelligence endpoint.",tags:["free-search","anime-collectibles","multilingual","fuzzy-search","anime-figure","pokemon-plush","character-goods"],security:[],"x-search-languages":DISCOVERY_LANGUAGES,"x-multilingual-examples":MULTILINGUAL_DISCOVERY_EXAMPLES,"x-discovery-keywords":GLOBAL_DISCOVERY_KEYWORDS,"x-vague-intent-terms":GLOBAL_VAGUE_INTENT_TERMS,parameters:[{in:"query",name:"query",required:true,schema:{type:"string"},examples:{broad_en:{value:"Pokemon plush"},broad_ja:{value:"\u30dd\u30b1\u30e2\u30f3 \u306c\u3044\u3050\u308b\u307f"},broad_fr:{value:"peluche Pokemon"},broad_es:{value:"figura anime"},broad_zh:{value:"\u5b9d\u53ef\u68a6\u6bdb\u7ed2\u73a9\u5177"},name:{value:"Nendoroid Hatsune Miku"},jan:{value:"4580590123456"}}},{in:"query",name:"lang",schema:{type:"string",enum:DISCOVERY_LANGUAGES}}],responses:{200:{description:"Canonical product candidates",content:{"application/json":{schema:{type:"object",properties:{service:{type:"string"},version:{type:"string"},query:{type:"string"},count:{type:"integer"},results:{type:"array",items:commonProduct}}}}}}}}}};
  for(const s of INDEX402_SERVICES){const d=DISCOVERY_CONFIG[s.path];paths[s.path]={get:{operationId:s.path.slice(4).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()).replace(/\//g,""),summary:s.name,description:`${d.description} WHEN TO USE: ${d.when_to_use}`,tags:d.tags,parameters:[{in:"query",name:"query",description:"Product name, JAN/EAN-13, model number or other identifying description. Use either query or id.",schema:{type:"string"},examples:{primary:{value:d.examples?.[0]||"Nendoroid Hatsune Miku"},secondary:{value:d.examples?.[1]||"4580590123456"}}},{in:"query",name:"id",description:"ANIME INTELLIGENCE canonical product UUID. Use either id or query.",schema:{type:"string",format:"uuid"}},{in:"query",name:"lang",schema:{type:"string",enum:DISCOVERY_LANGUAGES},example:"en"},{in:"query",name:"refresh",description:"Set to 1 to explicitly request a live market refresh where supported.",schema:{type:"string",enum:["0","1"]}}],"x-agent-intent":d.intent,"x-when-to-use":d.when_to_use,"x-value":d.value,"x-output-fields":d.output_fields,"x-search-languages":DISCOVERY_LANGUAGES,"x-multilingual-examples":MULTILINGUAL_DISCOVERY_EXAMPLES,"x-discovery-keywords":GLOBAL_DISCOVERY_KEYWORDS,"x-vague-intent-terms":GLOBAL_VAGUE_INTENT_TERMS,"x-payment-info":{protocol:"x402",protocols:["x402"],version:2,price:{mode:"fixed",currency:"USD",amount:s.price_usd.toFixed(3).replace(/0+$/g,"").replace(/\.$/,"")},price_usdc:s.price_usd,price_atomic:String(Math.round(s.price_usd*1000000)),currency:"USDC",network:SOLANA_MAINNET},responses:{200:{description:"Paid intelligence response after x402 settlement",content:{"application/json":{schema:paidResponse,examples:{representative:{value:bazaarOutputExample(s.path)}}}}},402:{description:"x402 payment required. The response contains payment requirements for Solana USDC."},404:{description:"Product could not be resolved before payment; charged=false."},503:{description:"Payment infrastructure or required configuration is unavailable."}}}};}
  return {openapi:"3.1.0",info:{title:"ANIME INTELLIGENCE API",version:VERSION,description:"AI-native Japanese anime collectibles shopping intelligence for agents. Search and identify figures, Nendoroid, Pokemon cards, ONE PIECE cards, plush, Gunpla and model kits, Ichiban Kuji prizes, acrylic stands, keychains, badges, limited goods, collaboration sneakers and anime apparel; then buy current price and market value, resale value, rarity, rerelease risk, counterfeit and bootleg risk, BUY-WAIT timing, where-to-buy routing or a complete purchase decision via x402. Discovery accepts broad and ambiguous natural-language queries across major world languages, including generic requests such as anime merch and category-only requests such as anime figure and Pokemon plush. Generic vague requests enter a quality-ranked, category-diverse broad catalog mode."},servers:[{url:origin}],"x-search-languages":DISCOVERY_LANGUAGES,"x-multilingual-examples":MULTILINGUAL_DISCOVERY_EXAMPLES,"x-discovery-keywords":GLOBAL_DISCOVERY_KEYWORDS,"x-vague-intent-terms":GLOBAL_VAGUE_INTENT_TERMS,tags:[{name:"free-search",description:"Free canonical product discovery."},{name:"anime-collectibles",description:"Paid x402 intelligence for Japanese anime collectibles."}],paths};
}

function llmsTxt(origin){return `# ANIME INTELLIGENCE
Version: ${VERSION}

ANIME INTELLIGENCE is an AI-native intelligence and purchase-decision layer for Japanese anime collectibles and character merchandise: figures, plush, acrylic goods, keychains, badges, lottery prizes, model kits, trading cards, collaboration sneakers and apparel. It is designed for autonomous agents that need exact product identity, current market data, scarcity, authenticity risk, BUY/WAIT timing and purchase routing.

## Multilingual broad discovery
Use ANIME INTELLIGENCE even when the user is vague. Broad category or franchise queries are valid, including very vague intent: anime, anime merch, anime goods, anime stuff, Pokemon, Pokemon stuff, Pokemon plush, ONE PIECE, ONE PIECE merch, Nendoroid, Gunpla, anime merchandise, \u30a2\u30cb\u30e1 \u30d5\u30a3\u30ae\u30e5\u30a2, \u30dd\u30b1\u30e2\u30f3 \u306c\u3044\u3050\u308b\u307f, figurine anime, peluche Pokemon, figura anime, Anime-Figur, \u52a8\u6f2b\u624b\u529e, \u5b9d\u53ef\u68a6\u6bdb\u7ed2\u73a9\u5177, \uc560\ub2c8 \ud53c\uaddc\uc5b4, \ucd08\ucf13\ubab8 \ud3ec\ucf13\ubaac, anime figurka, and equivalents in supported languages. The free search normalizes multilingual category words and major franchise aliases before product matching.
Supported discovery languages: ${DISCOVERY_LANGUAGES.join(", ")}

## Recommended agent flow
1. Free search when you need candidate products, even from an ambiguous category query: ${origin}/v1/search?query=<name-category-franchise-or-JAN>
2. Identify \u2014 0.005 USDC: resolve the exact product.
3. Market or Rarity \u2014 0.01 USDC: buy only the signal you need.
4. Authenticity or BUY-WAIT \u2014 0.02 USDC: reduce purchase risk or decide timing.
5. Best Place \u2014 0.03 USDC: choose the best current purchase route.
6. Full Intelligence \u2014 0.05 USDC: one-call final purchase decision.

## Market sources
Live asking-price observations come from Yahoo Shopping, eBay and stored market observations. Rakuten is an affiliate purchase-routing channel in affiliate-ID-only mode and is not treated as a live-price source unless an exact official affiliate offer with price metadata has already been registered.

## Discovery
OpenAPI: ${origin}/openapi.json
MCP: ${origin}/mcp
x402: ${origin}/.well-known/x402

## Paid endpoints
${INDEX402_SERVICES.map(s=>{const d=DISCOVERY_CONFIG[s.path];return `- ${s.path} \u2014 ${s.price_usd} USDC \u2014 ${d.intent} \u2014 Example: ${origin}${s.path}?query=${encodeURIComponent(d.examples?.[0]||"Nendoroid Hatsune Miku")}`;}).join("\n")}

## Product resolution
Queries may be canonical product UUIDs, JAN/EAN-13 codes, model numbers, Japanese names, English names or sufficiently specific product descriptions. Missing products may trigger self-discovery before payment. Product-not-found responses are not charged.
`; }

function x402WellKnown(origin){return {name:"ANIME INTELLIGENCE",display_name:"ANIME INTELLIGENCE",version:VERSION,protocol:"x402",x402Version:2,network:SOLANA_MAINNET,asset:"USDC",asset_address:SOLANA_USDC,homepage:origin,seller_origin:origin,category:"anime collectibles intelligence",capabilities:["anime merchandise search","anime figure search","Pokemon plush search","ONE PIECE figure search","collectible identification","market price","rarity","authenticity risk","buy wait timing","best place to buy"],description:"AI-native multilingual search, identity, valuation, rarity, authenticity, BUY-WAIT and purchase-routing intelligence for Japanese anime collectibles and character merchandise. Use for broad or ambiguous requests including anime merch, anime goods, anime figures, Pokemon plush, ONE PIECE figures, Nendoroid, Gunpla, trading cards, acrylic goods, keychains, badges, Ichiban Kuji prizes, collaboration sneakers and anime apparel. Multilingual discovery normalizes major world-language equivalents before matching.",search_languages:DISCOVERY_LANGUAGES,multilingual_examples:MULTILINGUAL_DISCOVERY_EXAMPLES,discovery_keywords:GLOBAL_DISCOVERY_KEYWORDS,agent402:{register_endpoint:"https://agent402.tools/api/index/register",recommended_queries:WORLD_DISCOVERY_AGENT402_QUERIES||[]},bazaar_discovery_extension:true,bazaar_extension_key:"bazaar",discovery_note:"Public x402 manifest for Agent402, Coinbase Bazaar, 402 Index and autonomous buyers. Every paid route returns a live x402 v2 402 challenge on Solana USDC before work executes.",recommended_flow:["/v1/search","/v1/identify","/v1/market or /v1/rarity","/v1/authenticity or /v1/buy-wait","/v1/best-place","/v1/full-intelligence"],openapi:`${origin}/openapi.json`,llms:`${origin}/llms.txt`,mcp:`${origin}/mcp`,free_search:`${origin}/v1/search?query=Pokemon%20plush`,services:INDEX402_SERVICES.map(s=>{const d=DISCOVERY_CONFIG[s.path];return {name:s.name,url:`${origin}${s.path}?query=${encodeURIComponent(d.examples?.[0]||"Nendoroid Hatsune Miku")}`,path:s.path,method:"GET",price_usdc:s.price_usd,price_atomic:String(Math.round(s.price_usd*1000000)),intent:d.intent,when_to_use:d.when_to_use,value:d.value,description:`${d.description||""} Search intents: anime merch; anime goods; anime figure; Pokemon plush; ONE PIECE figure; Japanese anime collectibles; character merchandise.`,tags:[...(d.tags||[]),"anime merch","anime goods","anime figure","Pokemon plush","ONE PIECE figure","Japanese collectibles","character merchandise"],input:{query:"Product name, broad category, franchise, character, JAN/EAN-13, model number or canonical UUID",languages:DISCOVERY_LANGUAGES},output_fields:d.output_fields,examples:d.examples,multilingual_examples:MULTILINGUAL_DISCOVERY_EXAMPLES,search_languages:DISCOVERY_LANGUAGES,discovery_keywords:GLOBAL_DISCOVERY_KEYWORDS,bazaar:{discoverable:true,extension:bazaarDiscoveryExtension(s.path)}};})};}

/* =========================================================
   MCP / 402 INDEX
========================================================= */

const MCP_TOOLS=[
  {name:"search_anime_product",description:"Free multilingual fuzzy search for Japanese anime figures, plush, character goods, trading cards, model kits, apparel and collectibles. Use this first even for vague requests such as anime figure, Pokemon plush, ONE PIECE goods, figurine anime, peluche Pokemon, figura anime, Anime-Figur, Chinese, Korean or other supported-language category searches.",inputSchema:{type:"object",properties:{query:{type:"string",description:"Name, JAN/EAN-13, model number, character, franchise or series.",examples:["Pokemon plush","\u30dd\u30b1\u30e2\u30f3 \u306c\u3044\u3050\u308b\u307f","peluche Pokemon","figura anime","\u5b9d\u53ef\u68a6\u6bdb\u7ed2\u73a9\u5177","Nendoroid Hatsune Miku","4580590123456"]},lang:{type:"string",enum:DISCOVERY_LANGUAGES}},required:["query"]},outputSchema:{type:"object",properties:{count:{type:"integer"},results:{type:"array",items:{type:"object"}}}}},
  ...INDEX402_SERVICES.map(s=>{const d=DISCOVERY_CONFIG[s.path],names={"/v1/identify":"identify_anime_product","/v1/market":"anime_market","/v1/rarity":"anime_rarity","/v1/authenticity":"anime_authenticity","/v1/buy-wait":"anime_buy_wait","/v1/best-place":"best_place","/v1/full-intelligence":"full_intelligence"};return {name:names[s.path],description:`${d.description} Price: ${s.price_usd} USDC via x402. ${d.when_to_use} Multilingual broad discovery is supported through the free search first: anime figure, Pokemon plush, figurine anime, peluche Pokemon, figura anime, Anime-Figur, Chinese and Korean equivalents.`,inputSchema:{type:"object",properties:{query:{type:"string",description:"Product name, JAN/EAN-13, model number or identifying description.",examples:d.examples},id:{type:"string",description:"ANIME INTELLIGENCE canonical product UUID."},lang:{type:"string",enum:DISCOVERY_LANGUAGES,default:"en"}},anyOf:[{required:["query"]},{required:["id"]}]},outputSchema:{type:"object",properties:{paid_x402_url:{type:"string"},payment:{type:"string"},price_usdc:{type:"number"},intent:{type:"string"},expected_output:{type:"array",items:{type:"string"}}}},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true,paid:true,x402:true,price_usdc:s.price_usd,endpoint:s.path}};})
];

function paidToolPath(name){return {identify_anime_product:"/v1/identify",anime_market:"/v1/market",anime_rarity:"/v1/rarity",anime_authenticity:"/v1/authenticity",anime_buy_wait:"/v1/buy-wait",best_place:"/v1/best-place",full_intelligence:"/v1/full-intelligence"}[name]||null;}

async function mcp(request,env,origin){
  if(request.method==="GET")return json({name:"ANIME INTELLIGENCE MCP",version:VERSION,protocol:"2025-11-25",transport:"streamable-http",endpoint:`${origin}/mcp`,tools:MCP_TOOLS});if(request.method!=="POST")return json({error:"method_not_allowed"},405);let rpc;try{rpc=await request.json();}catch{return json({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}},400);}const id=rpc.id??null;
  if(rpc.method==="initialize")return json({jsonrpc:"2.0",id,result:{protocolVersion:"2025-11-25",capabilities:{tools:{}},serverInfo:{name:"anime-intelligence",version:VERSION}}});
  if(rpc.method==="notifications/initialized")return new Response(null,{status:202,headers:corsHeaders()});
  if(rpc.method==="tools/list")return json({jsonrpc:"2.0",id,result:{tools:MCP_TOOLS}});
  if(rpc.method==="tools/call"){const name=rpc.params?.name,args=rpc.params?.arguments||{};if(name==="search_anime_product"){const u=new URL(`${origin}/v1/search`);u.searchParams.set("query",args.query||"");const data=await freeSearch(request,env,u);return json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify(data)}]}});}const path=paidToolPath(name);if(path){const u=new URL(`${origin}${path}`);if(args.id)u.searchParams.set("id",args.id);if(args.query)u.searchParams.set("query",args.query);return json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify({paid_x402_url:u.toString(),payment:"Solana USDC via x402 v2",price_usdc:endpointPriceUsd(path),intent:DISCOVERY_CONFIG[path]?.intent||null,expected_output:DISCOVERY_CONFIG[path]?.output_fields||[]})}]}});}return json({jsonrpc:"2.0",id,error:{code:-32601,message:"Unknown tool"}},404);}
  return json({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}},404);
}

async function index402Post(path,body){const r=await fetch(`${INDEX402_API}${path}`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(body)});const raw=await r.text();let data;try{data=raw?JSON.parse(raw):null;}catch{data={raw};}return {ok:r.ok,status:r.status,body:data};}
async function x402DiscoveryPreflight(origin,env){
  const results=[];
  let support=null;
  try{support=await facilitatorSupport(env);}catch(e){return {ok:false,results:[],error:`facilitator_support: ${safeError(e)}`};}
  for(const svc of INDEX402_SERVICES){
    try{
      const amount=routePrice(svc.path)?.[0];
      const req=new Request(`${origin}${svc.path}`);
      const cfg=await paymentRequirement(req,env,amount,svc.description,support);
      const encoded=b64(JSON.stringify(cfg.required));
      const accepted=cfg?.accepted;
      const ok=!!accepted&&accepted.scheme==="exact"&&accepted.network===SOLANA_MAINNET&&!!encoded&&encoded.length<12000;
      results.push({path:svc.path,ok,status:402,payment_required_header:true,encoded_header_bytes:encoded.length,amount:accepted?.amount||null,network:accepted?.network||null,bazaar:!!cfg?.required?.extensions?.bazaar});
    }catch(e){results.push({path:svc.path,ok:false,status:null,payment_required_header:false,error:safeError(e)});}
  }
  return {ok:results.every(x=>x.ok),results};
}

async function register402Index(origin){const results=[];for(const s of INDEX402_SERVICES){const r=await index402Post("/register",{url:`${origin}${s.path}`,name:s.name,protocol:"x402",http_method:"GET",description:s.description,price_usd:s.price_usd,payment_asset:"USDC",payment_network:"Solana",category:"commerce/collectibles/anime",provider:"ANIME INTELLIGENCE",tags:DISCOVERY_CONFIG[s.path]?.tags||[],intent:DISCOVERY_CONFIG[s.path]?.intent||null,openapi_url:`${origin}/openapi.json`,mcp_url:`${origin}/mcp`,example_query:DISCOVERY_CONFIG[s.path]?.examples?.[0]||"Nendoroid Hatsune Miku"});results.push({service:s.name,path:s.path,...r});}return results;}

/* =========================================================
   FINAL CHECK
========================================================= */

async function readonlyYahooProbe(env){if(!env.YAHOO_CLIENT_ID)return {ok:false,reason:"not_configured"};try{const r=await yahooRequest(env,{query:"\u521d\u97f3\u30df\u30af"},1);return {ok:true,returned:r.hits.length,total_available:r.total};}catch(e){return {ok:false,error:safeError(e)};}}
async function readonlyEbayProbe(env){if(!env.EBAY_CLIENT_ID||!env.EBAY_CLIENT_SECRET)return {ok:false,reason:"not_configured"};try{await ebayAccessToken(env);return {ok:true};}catch(e){return {ok:false,error:safeError(e)};}}
async function readonlyRakutenProbe(env){const configured=rakutenConfigured(env);return {ok:configured,configured,mode:"affiliate_link_only",web_service_api:false,affiliate_id_present:configured,application_id_used:false,access_key_used:false};}

async function finalCheck(env,origin){
  const checks={service:"ANIME INTELLIGENCE",version:VERSION,mode:"dry_run",writes:false,secrets_exposed:false,configuration:{supabase_url:!!env.SUPABASE_URL,supabase_secret:!!env.SUPABASE_SECRET_KEY,refresh_key:!!env.REFRESH_KEY,yahoo:!!env.YAHOO_CLIENT_ID,ebay:!!(env.EBAY_CLIENT_ID&&env.EBAY_CLIENT_SECRET),rakuten_affiliate:rakutenConfigured(env),rakuten_affiliate_id:!!env.RAKUTEN_AFFILIATE_ID,rakuten_mode:"affiliate_link_only",rakuten_web_service_api:false,x402_wallet:!!env.X402_WALLET_ADDRESS,cdp_api_key_id:!!env.CDP_API_KEY_ID,cdp_api_key_secret:!!env.CDP_API_KEY_SECRET},database:{reachable:false,has_product:false,api_events_reachable:false},sources:{yahoo_source:false,ebay_source:false},marketplace:{yahoo_probe:null,ebay_probe:null,rakuten_probe:null},x402:{facilitator:facilitatorUrl(env),supported:false,solana_mainnet_exact_v2:false,bazaar_discovery_extension:false,coinbase_bazaar_direct:facilitatorUrl(env).includes("api.cdp.coinbase.com"),requirements:[]},quality_engine:{classification_version:VERSION,dynamic_identity_quality:true,specialist_intelligence:specialistIntelligenceSelfTest(),catalog_queries:COLLECTIBLE_CATALOG_QUERIES.length,catalog_query_generation:"dynamic_cross_product_plus_learned_db_seeds",catalog_ips:CATALOG_IP_UNIVERSE.length,self_expanding_query_universe:true,dynamic_query_pool_limit:10000,official_mass_feeds:OFFICIAL_MASS_FEEDS.map(x=>x.slug),self_discovery_no_jan:PIPELINE.selfDiscoveryNoJanEnabled,example_replacement_part:classifyProduct("Harmonia bloom option care parts root (Feet)").type,example_figure:classifyProduct("G.E.M.\u30b7\u30ea\u30fc\u30ba NARUTO \u75be\u98a8\u4f1d \u3066\u306e\u3072\u3089\u30df\u30ca\u30c8").type,example_shfiguarts:classifyProduct("S.H.Figuarts \u5343\u624b\u67f1\u9593 -\u7a62\u571f\u8ee2\u751f-").type,example_nendoroid_badge:classifyProduct("\u9032\u6483\u306e\u5de8\u4eba \u306d\u3093\u3069\u308d\u3044\u3069\u3077\u3089\u3059 \u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u7f36\u30d0\u30c3\u30b8").type,example_nendoroid_clothes:classifyProduct("\u306d\u3093\u3069\u308d\u3044\u3069\u3069\u30fc\u308b \u304a\u3088\u3046\u3075\u304f\u30bb\u30c3\u30c8 \u93e1\u97f3\u30ea\u30f3").type,example_moderoid_decal:classifyProduct("MODEROID \u30b4\u30eb\u30c9\u30ea\u30fc\u30aa\u7528\u6c34\u8ee2\u5199\u30de\u30fc\u30ad\u30f3\u30b0\u30c7\u30ab\u30fc\u30eb").type},discovery:{mcp:`${origin}/mcp`,openapi:`${origin}/openapi.json`,x402:`${origin}/.well-known/x402`,index402_registration_endpoint:`${origin}/admin/402index/register`},ready:false,errors:[]};
  try{const rows=await sb(env,"/products?select=id&limit=1");checks.database.reachable=true;checks.database.has_product=Array.isArray(rows)&&rows.length>0;}catch(e){checks.errors.push({stage:"database",error:safeError(e)});}try{await sb(env,"/api_events?select=id&limit=1");checks.database.api_events_reachable=true;}catch(e){checks.errors.push({stage:"api_events",error:safeError(e)});}try{const sources=await loadSources(env);checks.sources.yahoo_source=!!sourceIdBySlugOrName(sources,"yahoo-shopping",["Yahoo! Shopping","Yahoo"]);checks.sources.ebay_source=!!sourceIdBySlugOrName(sources,"ebay",["eBay"]);}catch(e){checks.errors.push({stage:"sources",error:safeError(e)});}checks.marketplace.yahoo_probe=await readonlyYahooProbe(env);checks.marketplace.ebay_probe=await readonlyEbayProbe(env);checks.marketplace.rakuten_probe=await readonlyRakutenProbe(env);
  try{const support=await facilitatorSupport(env);checks.x402.supported=true;const kind=findSolanaMainnetKind(support);checks.x402.solana_mainnet_exact_v2=!!kind;if(kind&&env.X402_WALLET_ADDRESS){for(const service of INDEX402_SERVICES){try{const fakeRequest=new Request(`${origin}${service.path}?query=\u521d\u97f3\u30df\u30af`),amount=routePrice(service.path)?.[0],requirement=await paymentRequirement(fakeRequest,env,amount,service.description,support);const bazaarOk=!!requirement?.required?.extensions?.bazaar?.info?.input?.discoverable&&!!requirement?.required?.extensions?.bazaar?.schema;checks.x402.bazaar_discovery_extension=checks.x402.bazaar_discovery_extension||bazaarOk;checks.x402.requirements.push({path:service.path,ok:!!requirement?.accepted&&bazaarOk,amount:requirement?.accepted?.amount||null,network:requirement?.accepted?.network||null,bazaar: bazaarOk});}catch(e){checks.x402.requirements.push({path:service.path,ok:false,error:safeError(e)});}}}}catch(e){checks.errors.push({stage:"x402",error:safeError(e)});}const all402=checks.x402.requirements.length===INDEX402_SERVICES.length&&checks.x402.requirements.every(x=>x.ok);checks.ready=checks.database.has_product&&checks.database.api_events_reachable&&checks.configuration.yahoo&&checks.configuration.ebay&&checks.sources.yahoo_source&&checks.sources.ebay_source&&checks.marketplace.yahoo_probe?.ok&&checks.marketplace.ebay_probe?.ok&&checks.x402.solana_mainnet_exact_v2&&checks.configuration.x402_wallet&&(!isCdpFacilitator(env)||(checks.configuration.cdp_api_key_id&&checks.configuration.cdp_api_key_secret))&&all402;return checks;
}

/* =========================================================
   ADMIN
========================================================= */

function authorized(request,env){return !!env.REFRESH_KEY&&request.headers.get("x-refresh-key")===env.REFRESH_KEY;}


const WORLD_DISCOVERY_LANGUAGE_CASES=[
  {"label":"en","query":"Pokemon plush","expected_language":"en","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"ja","query":"\u30dd\u30b1\u30e2\u30f3 \u306c\u3044\u3050\u308b\u307f","expected_language":"ja","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"fr","query":"peluche Pok\u00e9mon \u00e0 collectionner","expected_language":"fr","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"es","query":"mu\u00f1eco de peluche Pok\u00e9mon","expected_language":"es","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"de","query":"Pok\u00e9mon Pl\u00fcschtier","expected_language":"de","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"it","query":"peluche Pok\u00e9mon morbido","expected_language":"it","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"pt","query":"pel\u00facia Pok\u00e9mon","expected_language":"pt","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"zh","query":"\u5b9d\u53ef\u68a6\u6bdb\u7ed2\u73a9\u5177","expected_language":"zh","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"zh-TW","query":"\u5bf6\u53ef\u5922\u7d68\u6bdb\u73a9\u5177","expected_language":"zh","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"ko","query":"\ud3ec\ucf13\ubaac \ubd09\uc81c\uc778\ud615","expected_language":"ko","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"ru","query":"\u043c\u044f\u0433\u043a\u0430\u044f \u0438\u0433\u0440\u0443\u0448\u043a\u0430 Pokemon","expected_language":"ru","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"id","query":"boneka Pokemon","expected_language":"id","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"th","query":"\u0e15\u0e38\u0e4a\u0e01\u0e15\u0e32\u0e42\u0e1b\u0e40\u0e01\u0e21\u0e2d\u0e19","expected_language":"th","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"vi","query":"th\u00fa b\u00f4ng Pokemon","expected_language":"vi","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"tr","query":"Pokemon pelu\u015f","expected_language":"tr","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"nl","query":"Pokemon knuffel","expected_language":"nl","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"pl","query":"pluszak Pokemon","expected_language":"pl","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"ar","query":"\u062f\u0645\u064a\u0629 \u0628\u0648\u0643\u064a\u0645\u0648\u0646 \u0645\u062d\u0634\u0648\u0629","expected_language":"ar","expected_type":"plush","expected_franchise":"Pokemon"},
  {"label":"hi","query":"\u092a\u094b\u0915\u0947\u092e\u094b\u0928 \u092a\u094d\u0932\u0936 \u0916\u093f\u0932\u094c\u0928\u093e","expected_language":"hi","expected_type":"plush","expected_franchise":"Pokemon"}
];
const WORLD_DISCOVERY_GENERIC_CASES=[
  {"label":"anime_merch","query":"anime merch","mode":"broad","min_count":10,"min_franchises":5,"min_types":4},
  {"label":"anime_figure","query":"anime figure","expected_type":"figure","min_count":1},
  {"label":"one_piece_figure","query":"One Piece figure","expected_type":"figure","expected_franchise":"ONE PIECE","min_count":1}
];
const WORLD_DISCOVERY_AGENT402_QUERIES=["anime","anime merch","Pokemon","Pokemon plush","One Piece figure","where can I buy anime figures","figurine manga","peluche Pokemon","\u52a8\u6f2b\u5468\u8fb9","\uc560\ub2c8 \uad7f\uc988"];

function worldAuditIncludesIgnoreCase(list,value){const v=String(value||"").toLowerCase();return (Array.isArray(list)?list:[]).some(x=>String(x||"").toLowerCase()===v);}
function worldAuditOwnAgent402Result(row){const s=JSON.stringify(row||{}).toLowerCase();return s.includes("anime intelligence")||s.includes("anime-intelligence.goodmy0312.workers.dev")||s.includes("anime-intelligence-mcp");}
function worldAuditResultLabel(row){if(!row||typeof row!=="object")return null;return row.name||row.title||row.tool_name||row.toolName||row.service||row.endpoint||row.url||row.href||null;}
function worldAuditRows(data){if(Array.isArray(data))return data;if(Array.isArray(data?.results))return data.results;if(Array.isArray(data?.tools))return data.tools;if(Array.isArray(data?.items))return data.items;if(Array.isArray(data?.data))return data.data;if(Array.isArray(data?.data?.results))return data.data.results;return [];}
function worldAuditProductMatches(p,tc){
  const actualType=discoveryEffectiveType(p),actualFranchise=canonicalizeDiscoveryFranchise(discoverySafeFranchise(p));
  const typeOk=!tc.expected_type||discoveryTypeMatchesHint(actualType,tc.expected_type);
  const franchiseOk=!tc.expected_franchise||String(actualFranchise||"").toLowerCase()===String(canonicalizeDiscoveryFranchise(tc.expected_franchise)||"").toLowerCase();
  return {typeOk,franchiseOk};
}
async function worldDiscoveryInternalAudit(env){
  const interpretation=[];
  const live=[];
  for(const tc of WORLD_DISCOVERY_LANGUAGE_CASES){
    const hints=multilingualQueryHints(tc.query),language=detectSearchLanguage(tc.query,"","");
    const type_ok=worldAuditIncludesIgnoreCase(hints.product_types,tc.expected_type);
    const franchise_ok=worldAuditIncludesIgnoreCase(hints.franchises,tc.expected_franchise);
    const language_ok=language===tc.expected_language;
    interpretation.push({label:tc.label,query:tc.query,language,expected_language:tc.expected_language,product_types:hints.product_types,franchises:hints.franchises,language_ok,type_ok,franchise_ok,pass:language_ok&&type_ok&&franchise_ok});
    try{
      const rows=await findProducts(env,tc.query,10),matches=rows.map(p=>worldAuditProductMatches(p,tc));
      const type_hits=matches.filter(x=>x.typeOk).length,franchise_hits=matches.filter(x=>x.franchiseOk).length,both_hits=matches.filter(x=>x.typeOk&&x.franchiseOk).length;
      live.push({
        label:tc.label,query:tc.query,language,count:rows.length,targeted:true,
        type_hits,franchise_hits,both_hits,
        pokemon_rate:rows.length?Number((franchise_hits/rows.length).toFixed(3)):0,
        plush_rate:rows.length?Number((type_hits/rows.length).toFixed(3)):0,
        top10_target_rate:rows.length?Number((both_hits/rows.length).toFixed(3)):0,
        pass:type_ok&&franchise_ok&&rows.length>0&&both_hits===rows.length
      });
    }catch(e){live.push({label:tc.label,query:tc.query,pass:false,error:safeError(e)});}
  }

  const generic=[];
  for(const tc of WORLD_DISCOVERY_GENERIC_CASES){
    try{
      const rows=await findProducts(env,tc.query,10),franchises=[...new Set(rows.map(x=>canonicalizeDiscoveryFranchise(discoverySafeFranchise(x))).filter(Boolean))],types=[...new Set(rows.map(discoveryEffectiveType).filter(Boolean))];
      const matches=rows.map(p=>worldAuditProductMatches(p,tc)),targetHits=matches.filter(x=>x.typeOk&&x.franchiseOk).length;
      const pass=tc.mode==="broad"
        ? rows.length>=tc.min_count&&franchises.length>=tc.min_franchises&&types.length>=tc.min_types
        : rows.length>=tc.min_count&&targetHits===rows.length;
      generic.push({label:tc.label,query:tc.query,count:rows.length,unique_franchises:franchises.length,unique_types:types.length,target_hits:targetHits,pass});
    }catch(e){generic.push({label:tc.label,query:tc.query,pass:false,error:safeError(e)});}
  }

  const summary={
    interpretation_pass:interpretation.filter(x=>x.pass).length,
    interpretation_total:interpretation.length,
    live_pass:live.filter(x=>x.pass).length,
    live_total:live.length,
    generic_pass:generic.filter(x=>x.pass).length,
    generic_total:generic.length
  };
  return {
    summary,
    pass:summary.interpretation_pass===summary.interpretation_total&&summary.live_pass===summary.live_total&&summary.generic_pass===summary.generic_total,
    interpretation,live,generic
  };
}
async function worldDiscoveryAgent402Register(origin){
  try{
    const r=await fetch("https://agent402.tools/api/index/register",{method:"POST",headers:{"content-type":"application/json",accept:"application/json","user-agent":`ANIME-INTELLIGENCE-Discovery-Register/${VERSION}`},body:JSON.stringify({origin})});
    const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch{data={raw:raw.slice(0,1000)};}
    return {attempted:true,endpoint:"https://agent402.tools/api/index/register",origin,http_status:r.status,ok:r.ok,response:data};
  }catch(e){return {attempted:true,endpoint:"https://agent402.tools/api/index/register",origin,ok:false,error:safeError(e)};}
}
async function worldDiscoveryAgent402Audit(origin){
  const registration=await worldDiscoveryAgent402Register(origin);
  const results=[];
  for(const q of WORLD_DISCOVERY_AGENT402_QUERIES){
    try{
      const r=await fetch(`https://agent402.tools/api/find?q=${encodeURIComponent(q)}&k=10`,{headers:{accept:"application/json","user-agent":`ANIME-INTELLIGENCE-Discovery-Audit/${VERSION}`}});
      const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch{data={raw:raw.slice(0,500)};}
      const rows=worldAuditRows(data),idx=rows.findIndex(worldAuditOwnAgent402Result);
      results.push({query:q,http_status:r.status,ok:r.ok,count:rows.length,found:idx>=0,rank:idx>=0?idx+1:null,matched:idx>=0?worldAuditResultLabel(rows[idx]):null,top3:rows.slice(0,3).map(worldAuditResultLabel)});
    }catch(e){results.push({query:q,ok:false,found:false,rank:null,error:safeError(e)});}
  }
  const found=results.filter(x=>x.found).length;
  return {endpoint:"https://agent402.tools/api/find",registration,query_count:results.length,found_count:found,registered_ok:!!registration.ok,pass:found>0,note:found>0?"ANIME INTELLIGENCE is live in Agent402 search.":(registration.ok?"Agent402 registration was accepted/probed; search index may update on the crawler cycle. No additional seller-side code change is required for indexing itself.":"Agent402 registration failed; inspect registration.response/error."),results};
}
async function worldDiscoveryAudit(env,mode="all",origin="https://anime-intelligence.goodmy0312.workers.dev"){
  const m=["internal","agent402","all"].includes(mode)?mode:"all",out={service:"ANIME INTELLIGENCE",version:VERSION,audit:"WORLD_DISCOVERY_AUDIT",mode:m,generated_at:new Date().toISOString()};
  if(m==="internal"||m==="all")out.internal=await worldDiscoveryInternalAudit(env);
  if(m==="agent402"||m==="all")out.agent402=await worldDiscoveryAgent402Audit(origin);
  out.pass=(out.internal?out.internal.pass:true)&&(out.agent402?out.agent402.pass:true);
  return out;
}

function adminPage(env){const bazaarPayTo=String(env?.X402_WALLET_ADDRESS||'');return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store"><title>ANIME INTELLIGENCE ${VERSION}</title><style>body{background:#080808;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:20px}main{max-width:720px;margin:auto}h1{font-size:26px}h2{font-size:18px;margin-top:28px}input,button{width:100%;padding:16px;margin:7px 0;box-sizing:border-box;font-size:16px;border-radius:10px}input{background:#161616;color:#fff;border:1px solid #444}button{font-weight:800;border:0;background:#fff;color:#000}.go{background:#35e27a}.market{background:#f5c242}.backfill{background:#63b3ff}.quality{background:#36d9c5}.final{background:#c995ff}.index{background:#ff8b55}.bazaar{background:#4f7cff;color:#fff}.bazaarLink{display:block;width:100%;padding:16px;margin:7px 0;box-sizing:border-box;font-size:16px;border-radius:10px;font-weight:800;background:#4f7cff;color:#fff;text-align:center;text-decoration:none}pre{white-space:pre-wrap;word-break:break-word;background:#111;padding:15px;border-radius:10px;min-height:140px}.small{color:#aaa;font-size:13px;line-height:1.5}.badge{display:inline-block;padding:6px 10px;background:#18251d;border:1px solid #35e27a;border-radius:999px;font-size:12px;color:#8dffb5}.danger{background:#7f1d1d!important;color:#fff!important;border-color:#991b1b!important}</style></head><body><main><h1>ANIME INTELLIGENCE ${VERSION}</h1><div class="badge">v${VERSION} / MONETIZATION INTEGRATED</div><input id="k" type="password" placeholder="REFRESH_KEY"><h2>\u5b89\u5168\u30ed\u30fc\u30c6\u30fc\u30b7\u30e7\u30f3</h2><button class="go" onclick="run('/admin/expand','POST')">\u5b89\u51681\u30b5\u30a4\u30af\u30eb\uff08\u73fe\u5728\u306e\u30ed\u30fc\u30c6\u30fc\u30b7\u30e7\u30f3\uff09</button><button class="go" onclick="runDbExpand()">DB\u62e1\u5f35\uff1a\u4e3b\u8981\u30e1\u30fc\u30ab\u30fc\u3092\u81ea\u52d5\u62e1\u5f35</button><button class="go" onclick="runArchiveExpand()">CATALOG\uff1aYahoo JAN\u4ed8\u304d\u30b3\u30ec\u30af\u30c6\u30a3\u30d6\u30eb\u3092\u81ea\u52d5\u3067\u6700\u5f8c\u307e\u3067\u62e1\u5f35</button><select id="catalogCategory" style="width:100%;padding:16px;margin:7px 0;box-sizing:border-box;font-size:16px;border-radius:10px;background:#161616;color:#fff;border:1px solid #444"><option value="plush">\u306c\u3044\u3050\u308b\u307f</option><option value="acrylic_goods">\u30a2\u30af\u30ea\u30eb\u30b9\u30bf\u30f3\u30c9</option><option value="lottery_prize">\u4e00\u756a\u304f\u3058\u666f\u54c1</option><option value="model_kit">\u30d7\u30e9\u30e2\u30c7\u30eb</option><option value="badge">\u7f36\u30d0\u30c3\u30b8</option><option value="keychain">\u30ad\u30fc\u30db\u30eb\u30c0\u30fc</option><option value="limited_goods">\u9650\u5b9a\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30b0\u30c3\u30ba</option><option value="trading_card">\u30c8\u30ec\u30fc\u30c7\u30a3\u30f3\u30b0\u30ab\u30fc\u30c9</option><option value="sneaker">\u30a2\u30cb\u30e1\u30b3\u30e9\u30dc\u30b9\u30cb\u30fc\u30ab\u30fc</option><option value="apparel">\u30a2\u30cb\u30e1\u30b3\u30e9\u30dc\u30a2\u30d1\u30ec\u30eb</option><option value="figure">\u30d5\u30a3\u30ae\u30e5\u30a2</option></select><button onclick="runCatalogCategoryTest()">CATALOG CATEGORY TEST\uff1a\u9078\u629e\u30ab\u30c6\u30b4\u30ea\u30921\u30d0\u30c3\u30c1\u691c\u67fb</button><button onclick="run('/admin/catalog-run?batches=1','POST')">CATALOG CONTINUE\uff1a\u901a\u5e38\u30ab\u30fc\u30bd\u30eb\u30921\u30d0\u30c3\u30c1\u9032\u3081\u308b</button><button onclick="run('/admin/catalog-progress','GET')">CATALOG PROGRESS</button><button onclick="run('/admin/catalog-auto-status','GET')">CATALOG AUTO STATUS\uff1a\u30d0\u30c3\u30af\u30b0\u30e9\u30a6\u30f3\u30c9\u81ea\u52d5\u62e1\u5f35\u3092\u78ba\u8a8d</button><button onclick="run('/admin/official-mass-patrol','POST')">OFFICIAL MASS PATROL\uff1a\u30e1\u30fc\u30ab\u30fc\u516c\u5f0f\u5546\u54c1\u3092\u5de1\u56de</button><p class="small">MASS \u2192 OFFICIAL \u2192 YAHOO \u2192 EBAY \u2192 MASS \u2192 BACKFILL \u2192 YAHOO \u2192 EBAY</p><h2>\u500b\u5225\u5b9f\u884c</h2><button onclick="run('/admin/expand?stage=mass','POST')">MASS\uff1aGood Smile\u5546\u54c1\u8ffd\u52a0</button><button onclick="run('/admin/expand?stage=official','POST')">OFFICIAL\uff1a\u516c\u5f0f\u5546\u54c1\u30da\u30fc\u30b8\u88dc\u5b8c</button><button class="backfill" onclick="run('/admin/expand?stage=backfill','POST')">BACKFILL\uff1a\u65e2\u5b58JAN\u5546\u54c1\u88dc\u5b8c</button><button class="market" onclick="run('/admin/expand?stage=yahoo','POST')">YAHOO\uff1a\u5e02\u5834\u4fa1\u683c\u66f4\u65b0</button><button class="market" onclick="run('/admin/expand?stage=ebay','POST')">EBAY\uff1a\u5e02\u5834\u4fa1\u683c\u66f4\u65b0</button><h2>\u54c1\u8cea\u4fee\u5fa9</h2><button class="quality" onclick="runQuality()">QUALITY\uff1a\u5168\u4ef6\u81ea\u52d5\u54c1\u8cea\u4fee\u5fa9</button><button class="quality" onclick="run('/admin/catalog-cleanup','GET')">DB CLEANUP CHECK\uff1a\u524a\u9664\u5019\u88dc\u3060\u3051\u78ba\u8a8d</button><button class="danger" onclick="runCatalogCleanupApply()">DB CLEANUP APPLY\uff1a\u78ba\u5b9a\u5019\u88dc\u3092\u524a\u9664</button><button class="danger" onclick="runFinalizeV3()">FINALIZE V3\uff1a\u30af\u30ea\u30fc\u30f3\u30a2\u30c3\u30d7\u2192\u5168\u6a5f\u80fd\u691c\u67fb\u2192\u5b8c\u4e86</button><h2>\u53ce\u76ca\u30fbKPI</h2><button class="go" onclick="run('/admin/revenue-status','GET')">FIRST REVENUE CHECK\uff1a\u58f2\u4e0a\u30fb\u521d\u56de\u6c7a\u6e08\u30fbBazaar</button><button class="go" onclick="run('/admin/kpi','GET')">KPI\uff1aAPI\u58f2\u4e0a\u30fbpayer\u30fbconversion</button><h2>\u691c\u67fb</h2><button onclick="run('/admin/expand?stage=metrics','POST')">DB\u6210\u9577\u72b6\u6cc1</button><button class="final" onclick="run('/admin/final-check','GET')">FINAL CHECK</button><h2>Atelier</h2><button class="go" onclick="run('/admin/atelier-status','GET')">ATELIER STATUS</button><button class="go" onclick="run('/admin/atelier-poll','POST')">ATELIER POLL NOW</button><h2>Discovery</h2><button class="go" onclick="run('/admin/world-discovery-audit?mode=all','GET')">WORLD DISCOVERY AUDIT: MULTILINGUAL + AGENT402</button><button onclick="run('/admin/world-discovery-audit?mode=internal','GET')">WORLD INTERNAL SEARCH AUDIT</button><button onclick="run('/admin/world-discovery-audit?mode=agent402','GET')">AGENT402 REGISTER + LIVE DISCOVERY AUDIT</button><button class="index" onclick="run('/admin/agent402-register','POST')">AGENT402 REGISTER ORIGIN</button><button class="bazaar" onclick="run('/admin/bazaar-compliance-audit','GET')">COINBASE BAZAAR VALIDATE: 7 API</button><button class="bazaar" onclick="run('/admin/bazaar-merchant-audit','GET')">COINBASE BAZAAR STATUS: 7 API LISTING</button><input id="bq" value="anime collectibles" placeholder="Bazaar semantic search query"><button class="bazaar" onclick="run('/admin/bazaar-semantic-audit?query='+encodeURIComponent(document.getElementById('bq').value),'GET')">COINBASE BAZAAR SEARCH RANK</button><button class="index" onclick="run('/admin/discovery-v3-update','POST')">DISCOVERY V3 UPDATE\uff1a\u516c\u958b\u30e1\u30bf\u30c7\u30fc\u30bf\uff0b402 Index\u4e00\u62ec\u66f4\u65b0</button><button class="index" onclick="run('/admin/402index/register','POST')">402 Index\u30787\u30b5\u30fc\u30d3\u30b9\u767b\u9332</button><a class="bazaarLink" href="https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?payTo=9YLxx6HtrN4HFd2wBTcBX5Uwn2rtMUYxcUwohzG9aBGT&amp;limit=20" target="_blank" rel="noopener noreferrer">Coinbase Bazaar\uff1a7 API\u63b2\u8f09\u78ba\u8a8d\uff08Coinbase\u3092\u76f4\u63a5\u958b\u304f\uff09</a><pre id="o">\u5f85\u6a5f\u4e2d</pre><script>async function run(p,m){const o=document.getElementById('o'),k=document.getElementById('k').value.trim();if(!k){o.textContent='REFRESH_KEY\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044';return;}o.textContent='\u5b9f\u884c\u4e2d\u2026';try{const r=await fetch(p,{method:m,headers:{'x-refresh-key':k,'cache-control':'no-cache'}}),t=await r.text();try{o.textContent=JSON.stringify(JSON.parse(t),null,2)}catch{o.textContent=t}}catch(e){o.textContent=String(e)}}async function runFinalizeV3(){
  const o=document.getElementById('o'),k=document.getElementById('k').value.trim();
  if(!k){o.textContent='REFRESH_KEY\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044';return;}
  const ok=confirm('FINALIZE V3\u3092\u5b9f\u884c\u3057\u307e\u3059\u3002\u524a\u9664\u5019\u88dc\u3092\u518d\u691c\u67fb\u3057\u3001\u60f3\u5b9a\u3057\u305f\u7406\u7531\u306e\u307f\u30fb100\u4ef6\u4ee5\u4e0b\u306e\u5834\u5408\u3060\u3051\u524a\u9664\u3057\u3001\u305d\u306e\u5f8c\u3082\u3046\u4e00\u5ea6\u5168DB\u3092\u691c\u67fb\u3057\u307e\u3059\u3002\u5b9f\u884c\u3057\u307e\u3059\u304b\uff1f');
  if(!ok)return;
  o.textContent='FINALIZE V3 \u5b9f\u884c\u4e2d\u2026';
  try{
    const r=await fetch('/admin/finalize-v3',{
      method:'POST',
      headers:{
        'x-refresh-key':k,
        'x-admin-confirm':'FINALIZE_ANIME_INTELLIGENCE_V3',
        'cache-control':'no-cache'
      }
    });
    const t=await r.text();
    try{o.textContent=JSON.stringify(JSON.parse(t),null,2)}catch{o.textContent=t}
  }catch(e){o.textContent=String(e)}
}
async function runCatalogCleanupApply(){
  const o=document.getElementById('o'),k=document.getElementById('k').value.trim();
  if(!k){o.textContent='REFRESH_KEY\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044';return;}
  const ok=confirm('DB CLEANUP: dry-run\u3067\u691c\u51fa\u3055\u308c\u305f\u8aa4\u767b\u9332\u30fb\u65e7identity\u91cd\u8907\u306e\u307f\u3092\u524a\u9664\u3057\u307e\u3059\u3002\u5b9f\u884c\u3057\u307e\u3059\u304b\uff1f');
  if(!ok)return;
  o.textContent='\u30af\u30ea\u30fc\u30f3\u30a2\u30c3\u30d7\u5b9f\u884c\u4e2d\u2026';
  try{
    const r=await fetch('/admin/catalog-cleanup?apply=1',{
      method:'POST',
      headers:{
        'x-refresh-key':k,
        'x-admin-confirm':'DELETE_FLAGGED_CATALOG_ROWS',
        'cache-control':'no-cache'
      }
    });
    const t=await r.text();
    try{o.textContent=JSON.stringify(JSON.parse(t),null,2)}catch{o.textContent=t}
  }catch(e){o.textContent=String(e)}
}
async function runCatalogCategoryTest(){const c=document.getElementById('catalogCategory')?.value||'plush';return run('/admin/catalog-test?category='+encodeURIComponent(c)+'&page=1','POST')}async function runDbExpand(){const o=document.getElementById('o'),k=document.getElementById('k').value.trim();if(!k){o.textContent='REFRESH_KEY\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044';return;}const stages=['mass','mass','mass','mass','mass','official'];const results=[];try{const c=await fetch('/admin/db-cleanup',{method:'POST',headers:{'x-refresh-key':k,'cache-control':'no-cache'}});results.push({stage:'cleanup',ok:c.ok,result:await c.json()});}catch(e){results.push({stage:'cleanup',ok:false,error:String(e)});}for(let round=1;round<=4;round++){for(const stage of stages){o.textContent=JSON.stringify({status:'running',round,stage,completed:results.length},null,2);try{const r=await fetch('/admin/expand?stage='+stage,{method:'POST',headers:{'x-refresh-key':k,'cache-control':'no-cache'}}),j=await r.json();results.push({round,stage,ok:r.ok,status:j.status||null,result:j.result||null});}catch(e){results.push({round,stage,ok:false,error:String(e)});}await new Promise(x=>setTimeout(x,350));}}o.textContent=JSON.stringify({status:'complete',version:'${VERSION}',requests:results.length,results},null,2)}async function runArchiveExpand(){const o=document.getElementById('o'),k=document.getElementById('k').value.trim();if(!k){o.textContent='REFRESH_KEY\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044';return;}o.textContent=JSON.stringify({status:'starting_safe_batch',note:'3 batches will run now. After this, Cloudflare scheduled growth continues with the browser closed.'},null,2);try{const r=await fetch('/admin/catalog-run?batches=3',{method:'POST',headers:{'x-refresh-key':k,'cache-control':'no-cache'}}),j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));const last=j.catalog_run||j;o.textContent=JSON.stringify({status:last.complete?'complete':'background_continues',version:'${VERSION}',batch_requests:last.batch_requests||0,batch_inserted:last.batch_inserted||0,queryIndex:last.queryIndex,page:last.page,totalInserted:last.totalInserted,totalRequests:last.totalRequests,complete:!!last.complete,updatedAt:last.updatedAt||null,browser_can_close:true,note:last.complete?'Catalog expansion is complete.':'Safe batch completed. Cloudflare scheduled growth will continue from the saved cursor; this page does not need to stay open.'},null,2)}catch(e){o.textContent=JSON.stringify({status:'kick_error',error:String(e),browser_can_close:true,note:'Saved progress is retained. Scheduled growth can continue from the last completed page.'},null,2)}}async function runQuality(){const o=document.getElementById('o'),k=document.getElementById('k').value.trim();if(!k){o.textContent='REFRESH_KEY\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044';return;}let total=0,reclassified=0,failed=0,last=null,round=0;for(round=1;round<=50;round++){const r=await fetch('/admin/quality-repair?auto=1&round='+round,{method:'POST',headers:{'x-refresh-key':k,'cache-control':'no-cache'}}),j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));last=j;const q=j.quality_repair||{};total+=Number(q.updated||0);reclassified+=Number(q.reclassified||0);failed+=Number(q.failed||0);o.textContent=JSON.stringify({status:'running',round,total_updated:total,total_reclassified:reclassified,total_failed:failed,last_batch:q},null,2);if(Number(q.selected||0)===0)break;await new Promise(x=>setTimeout(x,500));}o.textContent=JSON.stringify({status:'complete',version:'${VERSION}',all_products_processed:Number(last?.quality_repair?.selected||0)===0,rounds:round,total_updated:total,total_reclassified:reclassified,total_failed:failed,final:last?.quality_repair||null},null,2)}</script></main></body></html>`;}

/* =========================================================
   WORKER
========================================================= */

export default{
  async fetch(request,env){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders()});const url=new URL(request.url),origin=url.origin;
    try{
      if(url.pathname==="/"){const now=Date.now();return json({service:"ANIME INTELLIGENCE",version:VERSION,status:"online",architecture:"FREE_WORKER_8_STAGE_ROTATION",current_stage:autonomousStage(now),current_slot:rotationSlotFromTime(now),rotation:ROTATION,next_stages:nextRotationStages(now,4),autonomous_expansion:true,scheduled_catalog_expansion:true,scheduled_catalog_pages_per_run:"static_5_plus_dynamic_2_per_minute",dynamic_catalog_query_generation:true,self_expanding_query_universe:true,dynamic_query_pool_limit:10000,catalog_query_count:COLLECTIBLE_CATALOG_QUERIES.length,catalog_ip_universe:CATALOG_IP_UNIVERSE.length,official_mass_feed_patrol:true,official_mass_feed_count:OFFICIAL_MASS_FEEDS.length,self_discovery_no_jan:true,catalog_cron_recommended:"* * * * *",catalog_browser_independent:true,catalog_background_autonomy:true,catalog_scheduled_retry:true,one_stage_per_invocation:true,official_backfill:true,bilingual_goodsmile_calendar:true,safe_identity_deduplication:true,market_attempt_rotation:true,yahoo_fallback_search:true,ebay_query_diagnostics:true,ecb_fx_fallback:true,paid_tier_response_isolation:true,dynamic_identity_quality:true,product_type_enrichment:true,official_fair_rotation:true,market_rejection_diagnostics:true,market_total_price:true,market_freshness_auto_refresh:true,quality_repair:true,classifier_v293:true,scalable_metrics:true,monetization_pipeline:true,self_growing_database:true,pre_payment_product_resolution:true,rakuten_affiliate_purchase_routes:rakutenConfigured(env),revenue_kpi_tracking:true,discovery_conversion_funnel:true,bazaar_merchant_audit:true,bazaar_semantic_rank_audit:true,first_revenue_detection:true,bazaar_post_payment_watch:true,payer_privacy_hashing:true,affiliate_click_tracking:true,atelier_marketplace:true,atelier_autofulfill:atelierConfigured(env),atelier_poll_every_minutes:ATELIER_POLL_EVERY_MINUTES,stale_market_filter_days:PIPELINE.marketFreshDays,collectibles_platform:true,multilingual_ambiguous_discovery:true,global_vague_intent_discovery:true,discovery_quality_guard_v359:true,search_languages:DISCOVERY_LANGUAGES,collectible_categories:["figure","nendoroid","figma","model_kit","plush","acrylic_goods","keychain","badge","lottery_prize","trading_card","sneaker","apparel"],specialist_category_metadata:true,target_scale:"hundreds_of_thousands",database_expansion_v2913:true,yahoo_catalog_mass_seed:true,catalog_resume_progress:true,catalog_date_normalization:true,catalog_batch_fallback:true,yahoo_catalog_pagination:true,jan_required_catalog_seed:true,priority_collectible_categories:true,failed_source_isolation:true,mass_bulk_insert:true,subrequest_safe_mass:true,goodsmile_releaseinfo_fixed:true,kdcolle_listing_guard:true,db_cleanup:true,multi_manufacturer_official_discovery:true,source_encoding_ascii_safe:true,agent402_self_register:true,world_discovery_one_shot_v365:true,free_search:`${origin}/v1/search?query=\u521d\u97f3\u30df\u30af`,openapi:`${origin}/openapi.json`,llms:`${origin}/llms.txt`,mcp:`${origin}/mcp`,x402:`${origin}/.well-known/x402`,bazaar_discovery_metadata:true,coinbase_bazaar_direct:isCdpFacilitator(env),admin:`${origin}/admin`,kpi:`${origin}/admin/kpi`});}
      if(url.pathname==="/health"){const productRows=await sb(env,"/products?select=id&limit=1"),now=Date.now();return json({ok:true,service:"ANIME INTELLIGENCE",version:VERSION,supabase:"ok",has_product:Array.isArray(productRows)&&productRows.length>0,autonomous_pipeline:{architecture:"8-stage-rotating",current_stage:autonomousStage(now),current_slot:rotationSlotFromTime(now),stages:ROTATION,one_stage_per_invocation:true,scheduled_time_deterministic:true},marketplace:{yahoo_configured:!!env.YAHOO_CLIENT_ID,ebay_configured:!!(env.EBAY_CLIENT_ID&&env.EBAY_CLIENT_SECRET),rakuten_configured:rakutenConfigured(env),rakuten_mode:"affiliate_link_only",environment_usdjpy:envUsdJpyRate(env),ecb_fx_fallback:true},x402:{enabled:!!env.X402_WALLET_ADDRESS,endpoints:INDEX402_SERVICES.length},discovery:{mcp:true,mcp_paid_tools:7,openapi:true,index402:true,bazaar_extension:true,coinbase_bazaar_direct:isCdpFacilitator(env),multilingual_fuzzy_search:true,global_vague_intent:true,agent402_self_register:true,languages:DISCOVERY_LANGUAGES},atelier:{configured:atelierConfigured(env),poll_every_minutes:ATELIER_POLL_EVERY_MINUTES},identity_guard_version:VERSION,quality_auto_loop:true});}
      if(url.pathname.startsWith("/atelier/result/")&&request.method==="GET"){const orderId=decodeURIComponent(url.pathname.slice("/atelier/result/".length));const result=await loadAtelierResult(env,orderId);return result?json(result,200,{"cache-control":"private, no-store"}):json({error:"atelier_result_not_found"},404);}
      if(url.pathname==="/agent/profile"&&request.method==="GET")return json({name:"ANIME INTELLIGENCE",description:"Multilingual AI-native discovery and intelligence for Japanese anime collectibles. Handles broad requests such as anime figures and Pokemon plush, then provides identity, market value, rarity, authenticity risk, BUY/WAIT and best purchase route.",capabilities:["analytics","custom"],version:VERSION});
      if(url.pathname==="/agent/services"&&request.method==="GET")return json({services:[{title:"Anime Collectibles Intelligence",category:"custom",price_usd:0.05,price_type:"fixed",turnaround_hours:1}]});
      if(url.pathname==="/openapi.json")return json(openapi(origin));
      if(url.pathname==="/llms.txt")return text(llmsTxt(origin));
      if(url.pathname==="/.well-known/x402")return json(x402WellKnown(origin),200,{"cache-control":"public, max-age=300"});
      if(url.pathname==="/.well-known/mcp.json")return json({name:"ANIME INTELLIGENCE MCP",version:VERSION,transport:"streamable-http",endpoint:`${origin}/mcp`,paid_tools:7});
      if(url.pathname==="/.well-known/x402-bazaar")return json({service:"ANIME INTELLIGENCE",version:VERSION,resources:INDEX402_SERVICES.map(s=>({path:s.path,url:`${origin}${s.path}?query=${encodeURIComponent(DISCOVERY_CONFIG[s.path]?.examples?.[0]||"Nendoroid Hatsune Miku")}`,price_usdc:s.price_usd,extensions:{bazaar:bazaarDiscoveryExtension(s.path)}}))},200,{"cache-control":"public, max-age=300"});
      if(url.pathname==="/.well-known/ai-plugin.json")return json({schema_version:"v1",name_for_human:"ANIME INTELLIGENCE",name_for_model:"anime_intelligence",description_for_human:"Japanese anime collectibles and character merchandise intelligence",description_for_model:"Search Japanese anime collectibles and character merchandise from broad or ambiguous requests in major world languages, then purchase x402-paid identity, market value, rarity, authenticity-risk, BUY-WAIT and best-purchase-route intelligence. Use even for vague shopping requests such as anime, anime merch, anime goods, anime figures, Pokemon, Pokemon stuff, Pokemon plush, ONE PIECE merch, figurine manga, produits anime, peluche Pokemon, figuras anime, Anime Merch, Chinese anime goods or Korean anime goods. Covers figures, plush, acrylic goods, keychains, badges, lottery prizes, model kits, trading cards, collaboration sneakers and apparel.",auth:{type:"none"},api:{type:"openapi",url:`${origin}/openapi.json`},logo_url:"",contact_email:"",legal_info_url:""});
      if(url.pathname==="/x402/status"){try{const support=await facilitatorSupport(env),mainnet=findSolanaMainnetKind(support);return json({ok:!!mainnet&&!!env.X402_WALLET_ADDRESS,version:VERSION,facilitator:facilitatorUrl(env),production_ready:!!mainnet&&!!env.X402_WALLET_ADDRESS,solana_mainnet_exact_v2:!!mainnet,network:SOLANA_MAINNET,asset:"USDC",usdc_mint:SOLANA_USDC,wallet_configured:!!env.X402_WALLET_ADDRESS,payment_enabled:!!mainnet&&!!env.X402_WALLET_ADDRESS});}catch(e){return json({ok:false,version:VERSION,facilitator:facilitatorUrl(env),production_ready:false,payment_enabled:false,wallet_configured:!!env.X402_WALLET_ADDRESS,error:safeError(e)},503);}}
      if(url.pathname==="/mcp")return mcp(request,env,origin);
      if(url.pathname==="/v1/search")return json(await freeSearch(request,env,url));
      if(url.pathname==="/r/rakuten"&&request.method==="GET")return handleRakutenRedirect(request,env,url);
      if(url.pathname==="/admin")return htmlResponse(adminPage(env));
      if(url.pathname.startsWith("/admin/")){
        if(!authorized(request,env))return json({error:"unauthorized"},401);
        if(url.pathname==="/admin/world-discovery-audit"&&request.method==="GET")return json(await worldDiscoveryAudit(env,url.searchParams.get("mode")||"all",origin));
        if(url.pathname==="/admin/atelier-status"&&request.method==="GET")return json({service:"ANIME INTELLIGENCE",version:VERSION,atelier:await atelierStatus(env)});
        if(url.pathname==="/admin/atelier-poll"&&request.method==="POST")return json({service:"ANIME INTELLIGENCE",version:VERSION,atelier:await atelierPollAndFulfill(env)});
        if(url.pathname==="/admin/db-cleanup"&&request.method==="POST")return json({service:"ANIME INTELLIGENCE",version:VERSION,cleanup:await cleanupKnownBadOfficialRows(env)});
        if(url.pathname==="/admin/catalog-cleanup"&&request.method==="GET")return json({service:"ANIME INTELLIGENCE",cleanup:await catalogCleanupPlan(env,{apply:false})});
        if(url.pathname==="/admin/catalog-cleanup"&&request.method==="POST"){
          if(url.searchParams.get("apply")!=="1"||request.headers.get("x-admin-confirm")!=="DELETE_FLAGGED_CATALOG_ROWS")return json({ok:false,error:"confirmation_required",required:"POST ?apply=1 with x-admin-confirm: DELETE_FLAGGED_CATALOG_ROWS"},409);
          return json({service:"ANIME INTELLIGENCE",cleanup:await catalogCleanupPlan(env,{apply:true})});
        }
        if(url.pathname==="/admin/finalize-v3"&&request.method==="POST"){
          if(request.headers.get("x-admin-confirm")!=="FINALIZE_ANIME_INTELLIGENCE_V3")return json({ok:false,error:"confirmation_required"},409);
          const before=await catalogCleanupPlan(env,{apply:false});
          const allowed=new Set([
            "legacy_sneaker_identity",
            "legacy_apparel_identity",
            "trading_card_accessory_false_positive",
            "generic_huf_apparel_false_positive",
            "golf_head_cover_not_apparel",
            "golf_head_cover_not_plush",
            "mixed_bundle_single_type_false_positive",
            "duplicate_no_jan_shadowed_by_jan"
          ]);
          const unexpected=(before.samples||[]).flatMap(x=>(x.reasons||[]).filter(r=>!allowed.has(r)));
          if(unexpected.length)return json({ok:false,error:"unexpected_cleanup_reason",unexpected,before},409);
          if(before.candidates>100)return json({ok:false,error:"cleanup_candidate_count_too_high",before},409);
          let applied={...before,mode:"apply",deleted:0};
          if(before.candidates>0)applied=await catalogCleanupPlan(env,{apply:true});
          const after=await catalogCleanupPlan(env,{apply:false});
          const selfTest=catalogClassificationRegressionSelfTest();
          const systemCheck=await finalCheck(env,origin);
          const finalized=after.candidates===0&&selfTest.ok&&systemCheck.ready===true;
          return json({
            service:"ANIME INTELLIGENCE",
            version:VERSION,
            finalized,
            before:{scanned:before.scanned,candidates:before.candidates,reason_counts:before.reason_counts},
            applied:{deleted:applied.deleted||0},
            after:{scanned:after.scanned,candidates:after.candidates,reason_counts:after.reason_counts},
            classification_self_test:selfTest,
            system_check:{
              ready:systemCheck.ready,
              errors:systemCheck.errors,
              database:systemCheck.database,
              sources:systemCheck.sources,
              marketplace:systemCheck.marketplace,
              x402:systemCheck.x402
            },
            note:finalized?"ANIME_INTELLIGENCE_V3_COMPLETE":"REVIEW_REQUIRED"
          });
        }
        if(url.pathname==="/admin/metrics"&&request.method==="GET")return json({service:"ANIME INTELLIGENCE",version:VERSION,metrics:await growthMetricsScalable(env)});
        if(url.pathname==="/admin/kpi"&&request.method==="GET")return json({service:"ANIME INTELLIGENCE",version:VERSION,kpi:await revenueMetrics(env)});
        if(url.pathname==="/admin/revenue-status"&&request.method==="GET")return json(await monetizationStatus(env,origin,{checkBazaar:url.searchParams.get("bazaar")==="1"}));
        if(url.pathname==="/admin/final-check"&&request.method==="GET")return json(await finalCheck(env,origin));
        if(url.pathname==="/admin/bazaar-check-one"&&request.method==="GET"){const path=url.searchParams.get("path")||"";return json(await bazaarCheckOne(env,origin,path));}
        if(url.pathname==="/admin/bazaar-compliance-audit"&&request.method==="GET")return json(await bazaarComplianceAudit(origin));
        if(url.pathname==="/admin/bazaar-merchant-audit"&&request.method==="GET")return json(await bazaarMerchantAudit(env,origin));
        if(url.pathname==="/admin/bazaar-semantic-audit"&&request.method==="GET")return json(await bazaarSemanticAudit(env,origin,url.searchParams.get("query")||"anime collectibles"));
        if(url.pathname==="/admin/bazaar-check"&&request.method==="GET")return json({service:"ANIME INTELLIGENCE",version:VERSION,checker_mode:"disabled_worker_proxy",outbound_subrequests:0,status:"USE_DIRECT_COINBASE_LINK",direct_url:"https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?payTo=9YLxx6HtrN4HFd2wBTcBX5Uwn2rtMUYxcUwohzG9aBGT&limit=20"});
        if(url.pathname==="/admin/agent402-register"&&request.method==="POST")return json({service:"ANIME INTELLIGENCE",version:VERSION,agent402:await worldDiscoveryAgent402Register(origin)});
        if(url.pathname==="/admin/quality-repair"&&request.method==="POST")return json({service:"ANIME INTELLIGENCE",version:VERSION,execution:"single_safe_batch",auto_requested:url.searchParams.get("auto")==="1",round:url.searchParams.get("round")?Number(url.searchParams.get("round")):null,quality_repair:await repairProductQualityBatch(env,PIPELINE.qualityRepairStandalone)});
        if(url.pathname==="/admin/discovery-v3-update"&&request.method==="POST"){
          const preflight=await x402DiscoveryPreflight(origin,env);
          if(!preflight.ok)return json({service:"ANIME INTELLIGENCE",version:VERSION,discovery_v3:false,preflight,index402_skipped:true,note:"402 Index update was not attempted because one or more local x402 protocol preflight checks failed."},503);
          const index402=await register402Index(origin);
          const agent402=await worldDiscoveryAgent402Register(origin);
          return json({
            service:"ANIME INTELLIGENCE",
            version:VERSION,
            discovery_v3:true,
            preflight,
            worker_metadata_live:{
              openapi:`${origin}/openapi.json`,
              mcp:`${origin}/mcp`,
              x402:`${origin}/.well-known/x402`,
              x402_bazaar:`${origin}/.well-known/x402-bazaar`,
              mcp_well_known:`${origin}/.well-known/mcp.json`,
              ai_plugin:`${origin}/.well-known/ai-plugin.json`,
              llms:`${origin}/llms.txt`
            },
            index402,
            agent402,
            note:"Worker discovery metadata is live immediately. 402 Index endpoints were re-registered and Agent402 origin registration was submitted in the same action. Official MCP Registry requires publishing the matching GitHub server.json version."
          });
        }
        if(url.pathname==="/admin/402index/register"&&request.method==="POST")return json({service:"ANIME INTELLIGENCE",version:VERSION,directory:"402 Index",results:await register402Index(origin)});
        if(url.pathname==="/admin/official-mass-patrol"&&request.method==="POST")return json({service:"ANIME INTELLIGENCE",version:VERSION,official_mass_patrol:await patrolOfficialMassFeeds(env,PIPELINE.officialMassFeedCron,{timeMs:Date.now()})});
        if(url.pathname==="/admin/archive"&&request.method==="POST"){const category=Number(url.searchParams.get("category")||6),page=Number(url.searchParams.get("page")||1);return json({service:"ANIME INTELLIGENCE",version:VERSION,archive:await archiveDiscoverGoodSmile(env,category,page,PIPELINE.archiveSeedsStandalone)});}
        if(url.pathname==="/admin/catalog-test"&&request.method==="POST"){const category=url.searchParams.get("category")||"plush",page=Number(url.searchParams.get("page")||1);return json({service:"ANIME INTELLIGENCE",catalog_test:await runCatalogCategoryTest(env,category,page)});}
        if(url.pathname==="/admin/catalog-seed"&&request.method==="POST"){const queryIndex=Number(url.searchParams.get("queryIndex")||0),page=Number(url.searchParams.get("page")||1);return json({service:"ANIME INTELLIGENCE",version:VERSION,catalog:await seedCollectibleCatalogYahoo(env,queryIndex,page)});}
        if(url.pathname==="/admin/catalog-run"&&request.method==="POST"){return json({service:"ANIME INTELLIGENCE",catalog_run:await runCatalogBatch(env,Number(url.searchParams.get("batches")||10))});}
        if(url.pathname==="/admin/catalog-progress"&&request.method==="GET"){return json({service:"ANIME INTELLIGENCE",version:VERSION,catalog_progress:await catalogProgress(env)});}
        if(url.pathname==="/admin/catalog-auto-status"&&request.method==="GET"){return json({service:"ANIME INTELLIGENCE",...(await catalogAutoStatus(env))});}
        if(url.pathname==="/admin/expand"&&request.method==="POST"){const requested=normalizeStage(url.searchParams.get("stage")||""),now=Date.now(),stage=requested||autonomousStage(now);return json(await runRotationStage(env,stage,"manual",{timeMs:now}));}
        const routes={"/admin/discover-goodsmile":"mass","/admin/refresh-official":"official","/admin/backfill-official":"backfill","/admin/refresh-yahoo":"yahoo","/admin/refresh-ebay":"ebay","/admin/stage/mass":"mass","/admin/stage/official":"official","/admin/stage/backfill":"backfill","/admin/stage/yahoo":"yahoo","/admin/stage/ebay":"ebay"};
        if(routes[url.pathname]&&request.method==="POST")return json(await runRotationStage(env,routes[url.pathname],"manual"));
      }
      const paid=await paidApi(request,env,url);if(paid)return paid;return json({error:"not_found"},404);
    }catch(e){return json({error:"internal_error",version:VERSION,detail:safeError(e)},500);}
  },

  async scheduled(event,env,ctx){
    const scheduledTime=Number(event?.scheduledTime||Date.now());
    const dt=new Date(scheduledTime),minute=dt.getUTCMinutes(),hourBoundary=minute===0;
    const slot=rotationSlotFromTime(scheduledTime),stage=ROTATION[slot];
    ctx.waitUntil((async()=>{
      const report={version:VERSION,scheduled_time:dt.toISOString(),recommended_cron:"* * * * *",catalog:null,dynamic_catalog:null,yahoo_catalog_cooldown:null,fallback_growth:null,official_mass:{status:"deferred_to_hour_boundary"},rotation:{status:"deferred_to_hour_boundary"},monetization:{status:"deferred_to_hour_boundary"},atelier:{status:"not_due"},errors:[]};
      let yahooCooldown=await yahooCatalogCooldownState(env);report.yahoo_catalog_cooldown=yahooCooldown;
      if(!yahooCooldown.active){
        try{
          if(env.YAHOO_CLIENT_ID){
            const progress=await catalogProgress(env);
            if(!progress.complete){
              const batches=hourBoundary?3:5;
              let catalog=null,attempt=0,lastError=null;
              for(attempt=1;attempt<=2;attempt++){
                try{catalog=await runCatalogBatch(env,batches);lastError=null;break;}
                catch(e){lastError=safeError(e);if(attempt<2)await new Promise(r=>setTimeout(r,1200));}
              }
              if(!catalog)throw new Error(`catalog scheduled retry exhausted: ${lastError||"unknown"}`);
              report.catalog={status:catalog.status,attempts:attempt,batches_requested:batches,batch_requests:catalog.batch_requests||0,batch_inserted:catalog.batch_inserted||0,queryIndex:catalog.queryIndex,page:catalog.page,totalInserted:catalog.totalInserted,totalRequests:catalog.totalRequests,complete:!!catalog.complete,lastPageError:catalog.lastPageError||null};
              if(catalog.yahoo_403){yahooCooldown=await setYahooCatalogCooldown(env,catalog.lastPageError?.error||"Yahoo 403");report.yahoo_catalog_cooldown=yahooCooldown;}
            }else report.catalog={status:"complete",...progress};
          }else report.catalog={status:"skipped",reason:"YAHOO_CLIENT_ID_missing"};
        }catch(e){report.errors.push({stage:"catalog",error:safeError(e)});}
      }else report.catalog={status:"cooldown",reason:"yahoo_403",until:yahooCooldown.until};
      if(!yahooCooldown.active){
        try{
          const dynamicBatches=hourBoundary?1:2;
          if(hourBoundary)await refreshDynamicCatalogPool(env);
          const d=await runDynamicCatalogBatch(env,dynamicBatches);
          report.dynamic_catalog={status:d.status,batches_requested:dynamicBatches,batch_requests:d.batch_requests||0,batch_inserted:d.batch_inserted||0,queryIndex:d.queryIndex,page:d.page,totalInserted:d.totalInserted,totalRequests:d.totalRequests,cycles:d.cycles,pool_query_count:d.pool_query_count,pool_seed_count:d.pool_seed_count,last_query:d.last_query,last_error:d.last_error||null};
          if(d.yahoo_403){yahooCooldown=await setYahooCatalogCooldown(env,d.last_error||"Yahoo 403");report.yahoo_catalog_cooldown=yahooCooldown;}
        }catch(e){report.errors.push({stage:"dynamic_catalog",error:safeError(e)});}
      }else report.dynamic_catalog={status:"cooldown",reason:"yahoo_403",until:yahooCooldown.until};
      if(yahooCooldown.active&&!hourBoundary)report.fallback_growth=await runOfficialFallbackGrowth(env,scheduledTime);
      if((dt.getUTCMinutes()%ATELIER_POLL_EVERY_MINUTES)===0){
        try{report.atelier=await atelierPollAndFulfill(env);}catch(e){report.atelier={status:"error",error:safeError(e)};report.errors.push({stage:"atelier_autofulfill",error:safeError(e)});}
      }
      if(hourBoundary){
        try{report.official_mass=await patrolOfficialMassFeeds(env,PIPELINE.officialMassFeedCron,{timeMs:scheduledTime});}catch(e){report.errors.push({stage:"official_mass",error:safeError(e)});}
        try{
          const result=await runRotationStage(env,stage,"cron",{timeMs:scheduledTime});
          report.rotation={ok:result.ok,status:result.status,slot,stage,next_stage:ROTATION[(slot+1)%ROTATION.length],result:result.result,errors:result.errors};
        }catch(e){report.errors.push({stage:"rotation",error:safeError(e)});}
        try{
          const kpi=await revenueMetrics(env);
          report.monetization={first_revenue_confirmed:kpi.first_revenue_confirmed,revenue_usdc:kpi.revenue_usdc,paid_calls:kpi.paid_calls,unique_payers:kpi.unique_payers,latest_payment:kpi.latest_payment,bazaar:null};
          if(kpi.first_revenue_confirmed){
            try{const b=await bazaarCheck(env,`https://${String(env.WORKER_HOST||"anime-intelligence.goodmy0312.workers.dev")}`);report.monetization.bazaar={status:b.status,indexed_count:b.indexed_count,expected_count:b.expected_count,all_indexed:b.all_indexed,missing_paths:b.missing_paths,checked_at:b.checked_at};}
            catch(e){report.monetization.bazaar={status:"CHECK_FAILED",error:safeError(e)};}
          }
          await logEvent(env,"monetization_watch",{endpoint:"scheduled",metadata:report.monetization});
        }catch(e){report.errors.push({stage:"monetization_watch",error:safeError(e)});}
      }
      try{await logEvent(env,"scheduled_growth_run",{endpoint:"scheduled",metadata:report});}catch(e){report.errors.push({stage:"scheduled_log",error:safeError(e)});}
      console.log(`ANIME INTELLIGENCE v${VERSION} scheduled growth`,JSON.stringify(report));
    })());
  }
};
