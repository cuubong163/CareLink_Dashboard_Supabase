-- CareLink v3. Run this whole file in YOUR Supabase project's SQL Editor.
-- auth.users and auth.uid() are supplied by Supabase. No public/anonymous reads.
begin;

create table if not exists public.carelink_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.carelink_members (
  team_id uuid not null references public.carelink_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','writer','viewer')),
  joined_at timestamptz not null default now(),
  primary key (team_id,user_id)
);

create or replace function public.carelink_can_access(p_team_id uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.carelink_members m
    where m.team_id=p_team_id and m.user_id=(select auth.uid())
      and (not p_write or m.role in ('owner','writer')));
$$;
create or replace function public.carelink_is_owner(p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.carelink_members m
    where m.team_id=p_team_id and m.user_id=(select auth.uid()) and m.role='owner');
$$;

create or replace function public.carelink_valid_payload(p_node integer,p_data jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare allowed text[]; k text; lo numeric; hi numeric; v jsonb;
begin
  if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8192 then return false; end if;
  allowed := case p_node
    when 1 then array['hr','spo2','rate','measuring']
    when 2 then array['temp','humidity','fan']
    when 3 then array['head_angle','motion_status','motion_hz','vibration_rms','last_reposition_at','reposition_due','buzzer','battery','rssi','reason']
    else array[]::text[] end;
  if p_data='{}'::jsonb or p_data-allowed<>'{}'::jsonb then return false; end if;
  for k,lo,hi in select * from (values
    ('hr',0,300),('spo2',0,100),('temp',-40,100),('humidity',0,100),
    ('head_angle',-20,90),('motion_hz',0,100),('vibration_rms',0,32),
    ('last_reposition_at',1,8000000000000),('battery',0,100),('rssi',-200,0)
  ) as bounds(key,minimum,maximum) loop
    if p_data ? k then
      v := p_data->k;
      if jsonb_typeof(v)<>'number' then return false; end if;
      if (v::text)::numeric not between lo and hi then return false; end if;
    end if;
  end loop;
  foreach k in array array['measuring','fan','reposition_due','buzzer'] loop
    if p_data ? k and jsonb_typeof(p_data->k)<>'boolean' then return false; end if;
  end loop;
  if p_data ? 'rate' and (p_data->'rate') not in ('125'::jsonb,'200'::jsonb,'250'::jsonb,'500'::jsonb) then return false; end if;
  if p_data ? 'motion_status' and (jsonb_typeof(p_data->'motion_status')<>'string' or p_data->>'motion_status' not in ('normal','agitation','suspected_seizure')) then return false; end if;
  if p_data ? 'reason' and (jsonb_typeof(p_data->'reason')<>'string' or char_length(p_data->>'reason')>180) then return false; end if;
  return true;
end; $$;

create table if not exists public.carelink_measurements (
  id uuid primary key,
  team_id uuid not null references public.carelink_teams(id) on delete cascade,
  node_id smallint not null check(node_id in (1,2,3)),
  device_id text not null check(char_length(device_id) between 1 and 100),
  source text not null check(source in ('device','demo')),
  event_key text not null check(char_length(event_key) between 1 and 200),
  observed_at timestamptz not null check(observed_at <= now()+interval '5 minutes'),
  received_at timestamptz not null default now(),
  payload jsonb not null check(public.carelink_valid_payload(node_id,payload)),
  created_by uuid not null default auth.uid() references auth.users(id),
  unique(team_id,node_id,source,event_key),
  unique(team_id,id)
);
create index if not exists carelink_measurements_history on public.carelink_measurements(team_id,observed_at desc,id desc);
create index if not exists carelink_measurements_node_history on public.carelink_measurements(team_id,node_id,source,observed_at desc,id desc);

create table if not exists public.carelink_ecg_batches (
  measurement_id uuid primary key,
  team_id uuid not null,
  frames jsonb not null check(jsonb_typeof(frames)='array' and octet_length(frames::text)<=160000),
  created_by uuid not null default auth.uid() references auth.users(id),
  foreign key(team_id,measurement_id) references public.carelink_measurements(team_id,id) on delete cascade
);

alter table public.carelink_teams enable row level security;
alter table public.carelink_members enable row level security;
alter table public.carelink_measurements enable row level security;
alter table public.carelink_ecg_batches enable row level security;
revoke all on public.carelink_teams,public.carelink_members,public.carelink_measurements,public.carelink_ecg_batches from anon,authenticated;
grant select on public.carelink_teams,public.carelink_members,public.carelink_measurements,public.carelink_ecg_batches to authenticated;
grant insert on public.carelink_measurements,public.carelink_ecg_batches to authenticated;

drop policy if exists carelink_team_read on public.carelink_teams;
create policy carelink_team_read on public.carelink_teams for select to authenticated using(public.carelink_can_access(id));
drop policy if exists carelink_member_read on public.carelink_members;
create policy carelink_member_read on public.carelink_members for select to authenticated using(public.carelink_can_access(team_id));
drop policy if exists carelink_measurement_read on public.carelink_measurements;
create policy carelink_measurement_read on public.carelink_measurements for select to authenticated using(public.carelink_can_access(team_id));
drop policy if exists carelink_measurement_insert on public.carelink_measurements;
create policy carelink_measurement_insert on public.carelink_measurements for insert to authenticated
  with check(public.carelink_can_access(team_id,true) and created_by=(select auth.uid()));
drop policy if exists carelink_ecg_read on public.carelink_ecg_batches;
create policy carelink_ecg_read on public.carelink_ecg_batches for select to authenticated using(public.carelink_can_access(team_id));
drop policy if exists carelink_ecg_insert on public.carelink_ecg_batches;
create policy carelink_ecg_insert on public.carelink_ecg_batches for insert to authenticated
  with check(public.carelink_can_access(team_id,true) and created_by=(select auth.uid()) and
    exists(select 1 from public.carelink_measurements m where m.id=measurement_id and m.team_id=carelink_ecg_batches.team_id and m.node_id=1));

create or replace function public.carelink_create_team(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare team uuid;
begin
  if auth.uid() is null then raise exception 'Cần đăng nhập'; end if;
  if char_length(trim(p_name)) not between 1 and 80 then raise exception 'Tên nhóm từ 1 đến 80 ký tự'; end if;
  insert into public.carelink_teams(name,created_by) values(trim(p_name),auth.uid()) returning id into team;
  insert into public.carelink_members(team_id,user_id,role) values(team,auth.uid(),'owner');
  return team;
end; $$;

create or replace function public.carelink_add_member(p_team_id uuid,p_email text,p_role text default 'viewer')
returns uuid language plpgsql security definer set search_path = '' as $$
declare member uuid;
begin
  if not public.carelink_is_owner(p_team_id) then raise exception 'Chỉ trưởng nhóm được thêm thành viên'; end if;
  if p_role not in ('writer','viewer') then raise exception 'Vai trò không hợp lệ'; end if;
  select id into member from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
  if member is null then raise exception 'Thành viên cần đăng ký và xác nhận email trước'; end if;
  if exists(select 1 from public.carelink_members where team_id=p_team_id and user_id=member and role='owner') then raise exception 'Không thay đổi vai trò trưởng nhóm'; end if;
  insert into public.carelink_members(team_id,user_id,role) values(p_team_id,member,p_role)
    on conflict(team_id,user_id) do update set role=excluded.role;
  return member;
end; $$;

create or replace function public.carelink_ingest(p_team_id uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare row_data jsonb; frame jsonb; sample jsonb; frames jsonb; row_id uuid; n integer; total integer:=0; inserted integer:=0; ecg integer:=0;
begin
  if auth.uid() is null or not public.carelink_can_access(p_team_id,true) then raise exception 'Không có quyền ghi kết quả vào nhóm'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Mỗi lần gửi từ 1 đến 100 bản ghi'; end if;
  if jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Mỗi lần gửi từ 1 đến 100 bản ghi'; end if;
  for row_data in select value from jsonb_array_elements(p_rows) loop
    row_id := (row_data->>'id')::uuid;
    insert into public.carelink_measurements(id,team_id,node_id,device_id,source,event_key,observed_at,payload,created_by)
      values(row_id,p_team_id,(row_data->>'node_id')::smallint,row_data->>'device_id',row_data->>'source',row_data->>'event_key',
        (row_data->>'observed_at')::timestamptz,row_data->'payload',auth.uid())
      on conflict(team_id,node_id,source,event_key) do nothing;
    get diagnostics n = row_count;
    inserted := inserted+n;
    if row_data ? 'ecg_frames' then
      frames := row_data->'ecg_frames'; total:=0;
      if row_data->>'node_id'<>'1' or jsonb_typeof(frames)<>'array' or jsonb_array_length(frames) not between 1 and 400 or octet_length(frames::text)>160000 then raise exception 'Khối ECG không hợp lệ'; end if;
      for frame in select value from jsonb_array_elements(frames) loop
        if jsonb_typeof(frame) is distinct from 'object' or jsonb_typeof(frame->'rate') is distinct from 'number' or frame->'rate' not in ('125'::jsonb,'200'::jsonb,'250'::jsonb,'500'::jsonb) or jsonb_typeof(frame->'samples') is distinct from 'array' or jsonb_typeof(frame->'received_at') is distinct from 'string' then raise exception 'Mẫu/tần số ECG không hợp lệ'; end if;
        total:=total+jsonb_array_length(frame->'samples');
        if total>6000 then raise exception 'Khối ECG vượt 6000 mẫu'; end if;
        perform (frame->>'received_at')::timestamptz;
        for sample in select value from jsonb_array_elements(frame->'samples') loop
          if jsonb_typeof(sample)<>'number' then raise exception 'Mẫu ECG phải là số'; end if;
          if (sample::text)::numeric not between -100000 and 100000 then raise exception 'Mẫu ECG ngoài phạm vi'; end if;
        end loop;
      end loop;
      if total=0 then raise exception 'Khối ECG rỗng'; end if;
      if n=1 then
        insert into public.carelink_ecg_batches(measurement_id,team_id,frames,created_by) values(row_id,p_team_id,frames,auth.uid());
        ecg:=ecg+1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted',inserted,'duplicates',jsonb_array_length(p_rows)-inserted,'ecg_batches',ecg);
end; $$;

create or replace function public.carelink_schema_version()
returns integer language sql stable security invoker set search_path = '' as $$ select 1; $$;

create or replace function public.carelink_history(p_team_id uuid,p_node integer default 0,p_source text default 'device',p_from timestamptz default null,p_to timestamptz default null,p_after_time timestamptz default null,p_after_id uuid default null,p_limit integer default 101)
returns setof public.carelink_measurements language sql stable security invoker set search_path = '' as $$
  select m.* from public.carelink_measurements m
  where m.team_id=p_team_id and (p_node=0 or m.node_id=p_node)
    and (p_source='all' or m.source=p_source)
    and (p_from is null or m.observed_at>=p_from) and (p_to is null or m.observed_at<=p_to)
    and (p_after_time is null or (m.observed_at,m.id)<(p_after_time,p_after_id))
  order by m.observed_at desc,m.id desc limit greatest(1,least(coalesce(p_limit,101),101));
$$;

revoke execute on function public.carelink_can_access(uuid,boolean),public.carelink_is_owner(uuid),public.carelink_valid_payload(integer,jsonb),public.carelink_create_team(text),public.carelink_add_member(uuid,text,text),public.carelink_ingest(uuid,jsonb),public.carelink_schema_version() from public,anon;
grant execute on function public.carelink_can_access(uuid,boolean),public.carelink_is_owner(uuid),public.carelink_valid_payload(integer,jsonb),public.carelink_create_team(text),public.carelink_add_member(uuid,text,text),public.carelink_ingest(uuid,jsonb),public.carelink_schema_version() to authenticated;
revoke execute on function public.carelink_history(uuid,integer,text,timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon;
grant execute on function public.carelink_history(uuid,integer,text,timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
