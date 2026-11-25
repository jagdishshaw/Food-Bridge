-- ============================================================================
-- FoodBridge Production Schema for Supabase (PostgreSQL + RLS + Atomic RPCs)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Helper: Haversine distance in kilometers
-- ----------------------------------------------------------------------------
create or replace function public.haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
) returns double precision
language sql
immutable
strict
as $$
  select 6371.0 * 2.0 * asin(
    sqrt(
      least(
        1.0,
        power(sin(radians(lat2 - lat1) / 2.0), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) *
        power(sin(radians(lng2 - lng1) / 2.0), 2)
      )
    )
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('donor', 'ngo', 'admin')),
  org_name text not null,
  contact_name text not null,
  phone text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  food_type text not null check (food_type in ('cooked_meals', 'bakery', 'packaged', 'fruits_veg', 'beverages', 'other')),
  veg_flag boolean not null default true,
  quantity numeric(10, 2) not null check (quantity > 0),
  unit text not null check (unit in ('kg', 'servings')),
  quantity_kg numeric(10, 2) not null check (quantity_kg > 0),
  prepared_at timestamptz not null,
  safe_until timestamptz not null,
  pickup_address text not null,
  lat double precision not null,
  lng double precision not null,
  pickup_window_start timestamptz not null,
  pickup_window_end timestamptz not null,
  photo_url text,
  notes text,
  safety_hygienic boolean not null check (safety_hygienic = true),
  safety_covered boolean not null check (safety_covered = true),
  safety_not_served boolean not null check (safety_not_served = true),
  status text not null default 'available' check (status in ('available', 'claimed', 'collected', 'expired', 'cancelled')),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  collected_at timestamptz,
  collected_by uuid references public.profiles(id) on delete set null,
  actual_quantity numeric(10, 2) check (actual_quantity is null or actual_quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listings_safe_window_chk check (
    safe_until > prepared_at
    and safe_until <= prepared_at + interval '6 hours'
  ),
  constraint listings_pickup_window_chk check (
    pickup_window_end >= pickup_window_start
  )
);

create table if not exists public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete set null,
  recipient_email text not null,
  listing_id uuid references public.listings(id) on delete set null,
  event_type text not null check (event_type in ('listing_posted', 'listing_claimed', 'listing_cancelled', 'listing_collected')),
  channel text not null default 'email',
  provider text not null,
  status text not null check (status in ('sent', 'queued', 'failed', 'logged')),
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  rating integer check (rating is null or (rating >= 1 and rating <= 5)),
  reason text not null,
  details text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_profiles_role_verified on public.profiles(role, verified);
create index if not exists idx_profiles_geo on public.profiles(lat, lng);

create index if not exists idx_listings_status_safe_until on public.listings(status, safe_until);
create index if not exists idx_listings_donor_created on public.listings(donor_id, created_at desc);
create index if not exists idx_listings_claimed_by on public.listings(claimed_by, status);
create index if not exists idx_listings_geo on public.listings(lat, lng);
create index if not exists idx_listings_collected_at on public.listings(collected_at desc) where status = 'collected';

create index if not exists idx_notifications_listing on public.notifications_log(listing_id, created_at desc);
create index if not exists idx_notifications_recipient on public.notifications_log(recipient_id, created_at desc);

create index if not exists idx_reports_listing on public.reports(listing_id);
create index if not exists idx_reports_resolved on public.reports(resolved, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Updated-at triggers
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists trg_listings_touch on public.listings;
create trigger trg_listings_touch
before update on public.listings
for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Role helper & Atomic RPCs (concurrency-safe)
-- ----------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.expire_stale_listings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.listings
  set status = 'expired'
  where status = 'available'
    and safe_until <= now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Atomic claim: guarantees at most ONE verified NGO wins under concurrent claims
create or replace function public.claim_listing(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ngo public.profiles;
  v_row public.listings;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_ngo from public.profiles where id = v_uid;
  if v_ngo.id is null or v_ngo.role <> 'ngo' then
    raise exception 'Only NGO accounts can claim listings' using errcode = '42501';
  end if;
  if not v_ngo.verified then
    raise exception 'NGO verification is pending admin approval' using errcode = '42501';
  end if;

  update public.listings
  set status = 'claimed',
      claimed_by = v_uid,
      claimed_at = now()
  where id = p_listing_id
    and status = 'available'
    and safe_until > now()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Listing is no longer available or has expired' using errcode = '40001';
  end if;

  return v_row;
end;
$$;

create or replace function public.cancel_claim(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.listings;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.listings
  set status = case when safe_until > now() then 'available' else 'expired' end,
      claimed_by = null,
      claimed_at = null
  where id = p_listing_id
    and status = 'claimed'
    and claimed_by = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Claimed listing not found for your organization' using errcode = '42501';
  end if;

  return v_row;
end;
$$;

create or replace function public.confirm_collection(
  p_listing_id uuid,
  p_actual_quantity numeric
)
returns public.listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_row public.listings;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_actual_quantity is null or p_actual_quantity <= 0 then
    raise exception 'Actual quantity must be greater than zero' using errcode = '22023';
  end if;

  update public.listings
  set status = 'collected',
      collected_at = now(),
      collected_by = v_uid,
      actual_quantity = p_actual_quantity
  where id = p_listing_id
    and status = 'claimed'
    and (donor_id = v_uid or claimed_by = v_uid or v_role = 'admin')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Listing cannot be marked collected' using errcode = '42501';
  end if;

  return v_row;
end;
$$;

create or replace function public.nearby_listings(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 25
)
returns table (
  id uuid,
  donor_id uuid,
  title text,
  food_type text,
  veg_flag boolean,
  quantity numeric,
  unit text,
  quantity_kg numeric,
  prepared_at timestamptz,
  safe_until timestamptz,
  pickup_address text,
  lat double precision,
  lng double precision,
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  photo_url text,
  notes text,
  status text,
  distance_km double precision
)
language sql
stable
as $$
  select
    l.id, l.donor_id, l.title, l.food_type, l.veg_flag,
    l.quantity, l.unit, l.quantity_kg, l.prepared_at, l.safe_until,
    l.pickup_address, l.lat, l.lng, l.pickup_window_start, l.pickup_window_end,
    l.photo_url, l.notes, l.status,
    public.haversine_km(p_lat, p_lng, l.lat, l.lng) as distance_km
  from public.listings l
  where l.status = 'available'
    and l.safe_until > now()
    and public.haversine_km(p_lat, p_lng, l.lat, l.lng) <= p_radius_km
  order by l.safe_until asc, distance_km asc;
$$;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security (RLS)
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.notifications_log enable row level security;
alter table public.reports enable row level security;

-- Profiles policies
create policy "profiles_select_self_or_admin" on public.profiles
  for select using (
    id = auth.uid()
    or public.current_user_role() = 'admin'
    or exists (
      select 1 from public.listings l
      where (l.donor_id = profiles.id and l.claimed_by = auth.uid())
         or (l.claimed_by = profiles.id and l.donor_id = auth.uid())
    )
  );

create policy "profiles_insert_self" on public.profiles
  for insert with check (id = auth.uid() and role in ('donor', 'ngo'));

create policy "profiles_update_self_safe" on public.profiles
  for update using (id = auth.uid() or public.current_user_role() = 'admin')
  with check (
    public.current_user_role() = 'admin'
    or (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()))
  );

-- Listings policies
create policy "listings_select_authorized" on public.listings
  for select using (
    public.current_user_role() = 'admin'
    or donor_id = auth.uid()
    or claimed_by = auth.uid()
    or (
      status = 'available'
      and safe_until > now()
      and public.current_user_role() = 'ngo'
    )
  );

create policy "listings_insert_donor" on public.listings
  for insert with check (
    donor_id = auth.uid()
    and public.current_user_role() in ('donor', 'admin')
  );

create policy "listings_update_donor_or_admin" on public.listings
  for update using (
    donor_id = auth.uid() or public.current_user_role() = 'admin'
  );

create policy "listings_delete_donor_or_admin" on public.listings
  for delete using (
    donor_id = auth.uid() or public.current_user_role() = 'admin'
  );

-- Notifications policies
create policy "notifications_select_own_or_admin" on public.notifications_log
  for select using (
    recipient_id = auth.uid() or public.current_user_role() = 'admin'
  );

-- Reports policies
create policy "reports_select_participant_or_admin" on public.reports
  for select using (
    reporter_id = auth.uid()
    or public.current_user_role() = 'admin'
    or exists (
      select 1 from public.listings l
      where l.id = reports.listing_id and (l.donor_id = auth.uid() or l.claimed_by = auth.uid())
    )
  );

create policy "reports_insert_participant" on public.reports
  for insert with check (
    reporter_id = auth.uid()
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.status = 'collected'
        and (l.donor_id = auth.uid() or l.claimed_by = auth.uid())
    )
  );

create policy "reports_update_admin" on public.reports
  for update using (public.current_user_role() = 'admin');

-- ----------------------------------------------------------------------------
-- 7. Supabase Storage Bucket for optional food photos
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

create policy "listing_photos_public_read" on storage.objects
  for select using (bucket_id = 'listing-photos');

create policy "listing_photos_auth_upload" on storage.objects
  for insert with check (
    bucket_id = 'listing-photos' and auth.role() = 'authenticated'
  );
