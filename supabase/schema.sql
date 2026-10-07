-- Jalankan di Supabase > SQL Editor

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  periode text not null,
  perusahaan text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.slips (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  nama text not null,
  email text,
  wa text,
  jabatan text,
  gaji_pokok numeric not null default 0,
  tunjangan numeric not null default 0,
  lembur numeric not null default 0,
  potongan numeric not null default 0,
  net numeric generated always as (gaji_pokok + tunjangan + lembur - potongan) stored,
  email_status text not null default 'pending' check (email_status in ('pending','sent','failed','skipped')),
  wa_status text not null default 'pending' check (wa_status in ('pending','sent','failed','skipped')),
  email_error text,
  wa_error text,
  sent_at timestamptz
);
create index on public.slips (batch_id);

-- Cek admin (security definer agar tidak rekursif dengan RLS)
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.admins  enable row level security;
alter table public.batches enable row level security;
alter table public.slips   enable row level security;

-- admins: hanya bisa baca barisnya sendiri; tidak ada policy insert/update/delete
-- (admin ditambahkan manual lewat SQL Editor)
create policy "admin baca diri sendiri" on public.admins
  for select to authenticated using (user_id = auth.uid());

create policy "admin kelola batches" on public.batches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin kelola slips" on public.slips
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Pengunjung tanpa login tidak boleh menyentuh apa pun
revoke all on all tables in schema public from anon;

-- =====================  TAMBAHAN PDF  =====================
-- (Kalau Anda sudah menjalankan schema versi lama, jalankan blok ini saja.)
alter table public.slips add column if not exists pdf_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 1048576, array['application/pdf'])
on conflict (id) do nothing;

create policy "admin kelola file slip" on storage.objects
  for all to authenticated
  using (bucket_id = 'slips' and public.is_admin())
  with check (bucket_id = 'slips' and public.is_admin());
