-- HKSI 卷一 學習打卡 · Supabase 同步資料表
-- 在 Supabase 後台「SQL Editor」貼上全部執行一次即可。

create table if not exists public.progress (
  uid         text primary key,                       -- 同步碼
  data        jsonb not null default '{}'::jsonb,      -- 答題/打卡/錯題/收藏等進度
  updated_at  bigint not null default 0                -- 最後更新時間（毫秒）
);

-- 此 App 透過 anon key 直接讀寫；資料僅為學習進度、不含個資，
-- 安全性由「同步碼難以猜測」保證。故直接關閉 RLS 最省事。
alter table public.progress disable row level security;

-- 若你偏好較嚴謹：改為 enable + 下列 policy（anon 可對整表 CRUD，
-- 實務上與關閉 RLS 效果相同，因 anon 無法識別使用者身分）：
-- alter table public.progress enable row level security;
-- drop policy if exists "anon_all" on public.progress;
-- create policy "anon_all" on public.progress for all to anon using (true) with check (true);
