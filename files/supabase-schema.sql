-- Supabase schema for KeyCounter cloud sync v2
-- 注意：user_id 统一引用 Supabase 内置 auth.users.id（uuid）

-- 1) 用户计划与限制（Free / Pro）
create table if not exists public.user_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free', -- 'free' | 'pro'
  device_limit integer not null default 1,
  retention_days integer,           -- free=90, pro=NULL 表示不清理
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 初始化 plan 时的默认值，可在应用层控制：
-- free:  device_limit=1, retention_days=90
-- pro:   device_limit=5, retention_days=NULL

alter table public.user_plans enable row level security;

create policy "user_plans_select_own"
  on public.user_plans
  for select
  using (auth.uid() = user_id);

create policy "user_plans_modify_own"
  on public.user_plans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 2) 设备表
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_key text not null,        -- 客户端生成的稳定标识
  display_name text not null,      -- 例如 “下班快乐机”
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  disabled_at timestamptz
);

create unique index if not exists devices_user_device_key_uniq
  on public.devices (user_id, device_key);

create index if not exists devices_user_active_idx
  on public.devices (user_id)
  where disabled_at is null;

alter table public.devices enable row level security;

create policy "devices_select_own"
  on public.devices
  for select
  using (auth.uid() = user_id);

create policy "devices_modify_own"
  on public.devices
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 3) 分桶聚合表（1 分钟桶）
create table if not exists public.stats_buckets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  bucket_start timestamptz not null,      -- 向下取整到分钟
  day_id char(8) not null,               -- yyyyMMdd，按 4 点日界线计算

  keys_delta integer not null default 0,
  mouse_left_delta integer not null default 0,
  mouse_right_delta integer not null default 0,
  wheel_up_delta integer not null default 0,
  wheel_down_delta integer not null default 0,
  per_key_delta jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists stats_buckets_device_bucket_uniq
  on public.stats_buckets (device_id, bucket_start);

create index if not exists stats_buckets_user_day_idx
  on public.stats_buckets (user_id, day_id);

alter table public.stats_buckets enable row level security;

create policy "stats_buckets_select_own"
  on public.stats_buckets
  for select
  using (auth.uid() = user_id);

create policy "stats_buckets_modify_own"
  on public.stats_buckets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 4) （可选）每日汇总表，可在后续通过函数/cron 从 stats_buckets 生成
create table if not exists public.daily_rollups (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  day_id char(8) not null,

  keys_total integer not null default 0,
  mouse_left_total integer not null default 0,
  mouse_right_total integer not null default 0,
  wheel_up_total integer not null default 0,
  wheel_down_total integer not null default 0,
  per_key_total jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),

  primary key (user_id, device_id, day_id)
);

alter table public.daily_rollups enable row level security;

create policy "daily_rollups_select_own"
  on public.daily_rollups
  for select
  using (auth.uid() = user_id);

create policy "daily_rollups_modify_own"
  on public.daily_rollups
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

