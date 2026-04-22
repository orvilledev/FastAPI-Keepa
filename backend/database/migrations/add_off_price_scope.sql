-- Add per-job off-price detection scope.
alter table batch_jobs
add column if not exists off_price_scope text not null default 'buybox_only';

alter table batch_jobs
drop constraint if exists batch_jobs_off_price_scope_check;

alter table batch_jobs
add constraint batch_jobs_off_price_scope_check
check (off_price_scope in ('buybox_only', 'buybox_and_non_buybox_below_map'));
