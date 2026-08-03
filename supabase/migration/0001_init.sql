-- Sum Up initial schema. Applied locally in dev; apply via Supabase migration in prod.
create table groups (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  base_currency text not null default 'EUR',
  accent_color text not null default 'emerald',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table members (
  id uuid primary key,
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index members_group_idx on members(group_id);

create table photos (
  id uuid primary key,
  group_id uuid not null references groups(id) on delete cascade,
  content_type text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index photos_group_idx on photos(group_id);

create table entries (
  id uuid primary key,
  group_id uuid not null references groups(id) on delete cascade,
  kind text not null check (kind in ('expense', 'payment')),
  title text,
  note text,
  category text,
  category_source text check (category_source in ('keyword', 'llm', 'manual')),
  payer_id uuid not null references members(id),
  recipient_id uuid references members(id),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null,
  -- multiplier original -> group base currency, frozen at entry time
  exchange_rate numeric not null default 1 check (exchange_rate > 0),
  split_mode text not null default 'equal'
    check (split_mode in ('equal', 'exact', 'percent', 'shares')),
  expense_date date not null default current_date,
  photo_id uuid references photos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index entries_group_date_idx on entries(group_id, expense_date desc, created_at desc);

create table entry_shares (
  entry_id uuid not null references entries(id) on delete cascade,
  member_id uuid not null references members(id),
  -- owed amount in the entry's original currency cents; shares of one entry sum exactly to amount_cents
  share_cents bigint not null,
  -- raw user input for the entry's split mode (percent value, share count, exact cents), for form re-editing
  input_value numeric,
  primary key (entry_id, member_id)
);

create table category_overrides (
  group_id uuid not null references groups(id) on delete cascade,
  title_normalized text not null,
  category text not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, title_normalized)
);

-- Deny-all posture: the app connects as the table owner (bypasses RLS);
-- anon/authenticated API roles have no policies and can read nothing.
alter table groups enable row level security;
alter table members enable row level security;
alter table photos enable row level security;
alter table entries enable row level security;
alter table entry_shares enable row level security;
alter table category_overrides enable row level security;
