"""Authenticated Supabase uploader with a durable, project-scoped SQLite outbox.
No service-role/secret keys. A dedicated writer account is configured via env.
"""
import asyncio
import base64
import json
import logging
import math
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

LOG = logging.getLogger('carelink.supabase')
RATES = (125, 200, 250, 500)
LIMITS = {
    1: {'hr': (0, 300), 'spo2': (0, 100)},
    2: {'temp': (-40, 100), 'humidity': (0, 100)},
    3: {'head_angle': (-20, 90), 'motion_hz': (0, 100), 'vibration_rms': (0, 32),
        'last_reposition_at': (1, 8000000000000), 'battery': (0, 100), 'rssi': (-200, 0)},
}
BOOLS = {1: ('measuring',), 2: ('fan',), 3: ('reposition_due', 'buzzer')}


def number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def normalize(node, data):
    if node not in LIMITS or not isinstance(data, dict):
        return None
    result = {k: data[k] for k, (lo, hi) in LIMITS[node].items() if number(data.get(k), lo, hi)}
    result.update({k: data[k] for k in BOOLS[node] if type(data.get(k)) is bool})
    if node == 1 and type(data.get('rate')) is int and data['rate'] in RATES:
        result['rate'] = data['rate']
    if node == 3 and data.get('motion_status') in ('normal', 'agitation', 'suspected_seizure'):
        result['motion_status'] = data['motion_status']
        if isinstance(data.get('reason'), str):
            result['reason'] = data['reason'][:180]
    return result or None


def iso(now):
    return datetime.fromtimestamp(now, timezone.utc).isoformat()


class Collector:
    def __init__(self, interval=5, save_ecg=False):
        self.interval, self.save_ecg = interval, save_ecg
        self.buckets, self.seen = {}, {}
        self.invalid_ecg = 0

    def push(self, message, now=None):
        now = time.time() if now is None else now
        if not isinstance(message, dict) or message.get('type') != 'telemetry':
            return []
        node = message.get('node')
        if type(node) is not int:
            return []
        payload = normalize(node, message.get('data'))
        if not payload:
            return []
        device = str(message.get('device_id') or f'node-{node}')[:100]
        bucket_key = (node, device)
        numbered = isinstance(message.get('boot_id'), str) and type(message.get('seq')) is int and message['seq'] >= 0
        packet = f"{message['boot_id'][:60]}:{message['seq']}" if numbered else str(uuid.uuid4())
        seen_key = (node, device, packet)
        if seen_key in self.seen:
            return []
        self.seen[seen_key] = True
        if len(self.seen) > 2048:
            del self.seen[next(iter(self.seen))]
        data, frame = message['data'], None
        samples = data.get('ecg')
        if self.save_ecg and node == 1 and isinstance(samples, list) and samples:
            if type(data.get('rate')) is int and data['rate'] in RATES and len(samples) <= 2000 and all(number(v, -100000, 100000) for v in samples):
                frame = {'received_at': iso(now), 'rate': data['rate'], 'samples': samples.copy()}
            else:
                self.invalid_ecg += 1
        previous, ready = self.buckets.get(bucket_key), []
        transition = previous and any(k in payload and k in previous['payload'] and payload[k] != previous['payload'][k] for k in ('motion_status', 'reposition_due', 'last_reposition_at', 'buzzer', 'fan', 'measuring'))
        if previous and (now-previous['start'] >= self.interval or transition or previous['samples'] + (len(samples) if frame else 0) > 6000 or len(previous['frames']) >= 400):
            ready.append(self.finish(bucket_key))
            previous = None
        b = previous or {'id': str(uuid.uuid4()), 'node_id': node, 'device_id': device, 'source': 'device', 'start': now, 'end': now, 'first': packet, 'last': packet, 'payload': {}, 'frames': [], 'samples': 0}
        b['payload'].update(payload)
        b['end'], b['last'] = now, packet
        if frame:
            b['frames'].append(frame)
            b['samples'] += len(samples)
        self.buckets[bucket_key] = b
        return ready

    def finish(self, key):
        b = self.buckets.pop(key)
        row = {k: b[k] for k in ('id', 'node_id', 'device_id', 'source', 'payload')}
        row.update(event_key=f"{b['first']}..{b['last']}"[:200], observed_at=iso(b['end']))
        if b['frames']:
            row['ecg_frames'] = b['frames']
        return row

    def drain(self, now=None, force=False):
        now = time.time() if now is None else now
        return [self.finish(k) for k, b in list(self.buckets.items()) if force or now-b['start'] >= self.interval]


class Outbox:
    def __init__(self, path, scope, limit=5000):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.scope, self.limit = scope, limit
        self.db.execute('create table if not exists outbox(scope text not null,id text not null,observed_at text not null,payload text not null,primary key(scope,id))')
        self.db.commit()
        try:
            path.chmod(0o600)
        except OSError:
            pass

    def count(self):
        return self.db.execute('select count(*) from outbox where scope=?', (self.scope,)).fetchone()[0]

    def add(self, rows):
        if not rows:
            return
        if self.count()+len(rows) > self.limit:
            raise ValueError('Hàng chờ Supabase đã đầy; dừng thu vào hàng chờ, cần khôi phục kết nối.')
        with self.db:
            self.db.executemany('insert or ignore into outbox values(?,?,?,?)', [(self.scope, r['id'], r['observed_at'], json.dumps(r, allow_nan=False)) for r in rows])

    def batch(self):
        return [json.loads(r[0]) for r in self.db.execute('select payload from outbox where scope=? order by observed_at,id limit 50', (self.scope,))]

    def remove(self, ids):
        with self.db:
            self.db.executemany('delete from outbox where scope=? and id=?', [(self.scope, id_) for id_ in ids])

    def close(self):
        self.db.close()


class API:
    def __init__(self, url, key, email, password, team):
        parsed = urlparse(url)
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
            raise ValueError('SUPABASE_URL phải dùng HTTPS.')
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
            raise ValueError('SUPABASE_URL chỉ chứa địa chỉ dự án, không thêm đường dẫn.')
        if not key.startswith('sb_publishable_'):
            try:
                part = key.split('.')[1]
                role = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))['role']
                if role != 'anon':
                    raise ValueError()
            except (ValueError, KeyError, IndexError):
                raise ValueError('Gateway dùng publishable/anon key cùng tài khoản có quyền ghi, không dùng secret/service_role.') from None
        self.url, self.key, self.email, self.password, self.team = url.rstrip('/'), key, email, password, str(uuid.UUID(team))
        self.token, self.expires, self.user, self.checked = None, 0, None, False

    def request(self, route, body, authenticated=True):
        headers = {'apikey': self.key, 'Content-Type': 'application/json'}
        if authenticated:
            headers['Authorization'] = 'Bearer ' + self.token
        req = Request(self.url+route, data=json.dumps(body, allow_nan=False).encode(), headers=headers, method='POST')
        try:
            with urlopen(req, timeout=8) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code == 401:
                self.expires = 0
            raise ValueError(f'Supabase từ chối yêu cầu (HTTP {exc.code}); kiểm tra đăng nhập, bảng và quyền nhóm.') from None
        except (URLError, TimeoutError, OSError):
            raise ValueError('Chưa kết nối được Supabase; giữ nguyên các bản ghi trong hàng chờ.') from None

    def authenticate(self):
        if time.time() >= self.expires:
            result = self.request('/auth/v1/token?grant_type=password', {'email': self.email, 'password': self.password}, False)
            self.token, self.user = result['access_token'], result['user']['id']
            self.expires = time.time()+max(1, result.get('expires_in', 3600)-60)
        if not self.checked:
            if self.request('/rest/v1/rpc/carelink_schema_version', {}) != 1:
                raise ValueError('Phiên bản bảng Supabase chưa phù hợp.')
            self.checked = True

    def send(self, rows):
        self.authenticate()
        result = self.request('/rest/v1/rpc/carelink_ingest', {'p_team_id': self.team, 'p_rows': rows})
        if not isinstance(result, dict) or type(result.get('inserted')) is not int or type(result.get('duplicates')) is not int or result['inserted']+result['duplicates'] != len(rows):
            raise ValueError('Supabase chưa xác nhận đủ bản ghi; giữ hàng chờ để gửi lại.')
        return result


class SupabaseSink:
    def __init__(self, api, outbox, interval=5, save_ecg=False):
        self.api, self.outbox = api, outbox
        self.collector = Collector(interval, save_ecg)
        self.recording = True
        self.saved = 0

    @classmethod
    def from_environment(cls):
        keys = ('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_EMAIL', 'SUPABASE_PASSWORD', 'SUPABASE_TEAM_ID')
        if not any(os.getenv(k) for k in keys):
            return None
        if not all(os.getenv(k) for k in keys):
            raise ValueError('Chưa bật lưu Supabase: cần đủ URL, PUBLISHABLE_KEY, EMAIL, PASSWORD, TEAM_ID.')
        interval = int(os.getenv('SUPABASE_SAVE_INTERVAL', '5'))
        if interval not in (1, 5, 10, 30):
            raise ValueError('SUPABASE_SAVE_INTERVAL nhận 1, 5, 10 hoặc 30 giây.')
        url, key, email, password, team = (os.environ[k] for k in keys)
        api = API(url, key, email, password, team)
        scope = json.dumps([api.url, api.email.lower(), api.team])
        path = os.getenv('SUPABASE_OUTBOX', str(Path(__file__).parent / 'data' / 'supabase-outbox.sqlite3'))
        return cls(api, Outbox(path, scope), interval, os.getenv('SUPABASE_SAVE_ECG') == '1')

    def ingest(self, message):
        if not self.recording:
            return
        try:
            self.outbox.add(self.collector.push(message))
        except (ValueError, sqlite3.Error) as exc:
            self.recording = False
            LOG.error('Dừng thu lưu Supabase: %s', exc)

    async def cycle(self):
        if self.recording:
            self.outbox.add(self.collector.drain())
        rows = self.outbox.batch()
        if not rows:
            return
        result = await asyncio.to_thread(self.api.send, rows)
        self.outbox.remove([r['id'] for r in rows])
        self.saved += result['inserted']
        LOG.info('Supabase xác nhận: %s mới, %s trùng; còn chờ %s.', result['inserted'], result['duplicates'], self.outbox.count())

    async def run(self):
        failures = 0
        while True:
            try:
                await self.cycle()
                failures = 0
            except (ValueError, sqlite3.Error, KeyError) as exc:
                failures += 1
                LOG.warning('Lưu Supabase: %s', exc)
            await asyncio.sleep(min(60, 2 ** min(failures, 6)))

    def close(self):
        if self.recording:
            try:
                self.outbox.add(self.collector.drain(force=True))
            except (ValueError, sqlite3.Error):
                LOG.error('Chưa lưu được phần đo cuối vào hàng chờ. Kiểm tra dung lượng máy.')
        self.outbox.close()
