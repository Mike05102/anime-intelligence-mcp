begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

create index if not exists gpd33_active_offer_gtin on public.merchant_offers(gtin)
  where active=true and gtin is not null;

commit;
