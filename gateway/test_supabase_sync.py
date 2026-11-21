import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from supabase_sync import API, Collector, Outbox, SupabaseSink, normalize

class CollectorTests(unittest.TestCase):
    def test_only_valid_results_and_actual_boolean_states(self):
        self.assertEqual(normalize(3, {'head_angle':0,'buzzer':False,'fall':True}), {'head_angle':0,'buzzer':False})
        self.assertIsNone(normalize(3, {'fall':True}))
        self.assertEqual(normalize(1, {'hr':'76','spo2':float('nan'),'rate':200}), {'rate':200})

    def test_aggregated_ecg_and_node3_events(self):
        c=Collector(interval=5,save_ecg=True)
        for i in range(10):
            c.push({'type':'telemetry','node':1,'boot_id':'a','seq':i,'data':{'rate':200,'ecg':[0.1]*20}},1000+i*.1)
        rows=c.drain(1006)
        self.assertEqual(sum(len(f['samples']) for f in rows[0]['ecg_frames']),200)
        c.push({'type':'telemetry','node':3,'data':{'motion_status':'suspected_seizure','buzzer':True}},2000)
        rows=c.push({'type':'telemetry','node':3,'data':{'motion_status':'normal','buzzer':False}},2000.1)
        self.assertEqual(rows[0]['payload']['motion_status'],'suspected_seizure')

    def test_duplicate_sequence_and_invalid_frame_are_not_saved_as_new_measurements(self):
        c=Collector(save_ecg=True)
        msg={'type':'telemetry','node':1,'boot_id':'b','seq':1,'data':{'hr':76,'ecg':[1,2]}}
        c.push(msg,1000)
        c.push(msg,1001)
        rows=c.drain(1006)
        self.assertEqual(len(rows),1)
        self.assertNotIn('ecg_frames',rows[0])
        self.assertEqual(c.invalid_ecg,1)

class OutboxTests(unittest.IsolatedAsyncioTestCase):
    async def test_restart_and_failed_ack_keep_data_until_confirmed(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'outbox.sqlite3'
            box=Outbox(path,'project/team/account')
            row={'id':'a','observed_at':'2026-11-20T00:00:00Z','node_id':3,'payload':{'head_angle':35}}
            box.add([row]);box.close()
            class FakeAPI:
                fail=True
                def send(self,rows):
                    if self.fail: raise ValueError('offline')
                    return {'inserted':0,'duplicates':len(rows)}
            api=FakeAPI();box=Outbox(path,'project/team/account');sink=SupabaseSink(api,box)
            with self.assertRaises(ValueError):await sink.cycle()
            self.assertEqual(box.batch()[0]['id'],'a')
            other=Outbox(path,'another-project/team/account');self.assertEqual(other.count(),0);other.close()
            api.fail=False;await sink.cycle();self.assertEqual(box.count(),0);sink.close()

    async def test_queue_limit_preserves_prior_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            box=Outbox(Path(folder)/'q.sqlite3','a',limit=1)
            box.add([{'id':'a','observed_at':'x'}])
            with self.assertRaises(ValueError):box.add([{'id':'b','observed_at':'x'}])
            self.assertEqual(box.batch()[0]['id'],'a');box.close()

class APITests(unittest.TestCase):
    def test_writer_login_and_rpc_use_user_token_not_publishable_bearer(self):
        requests=[]
        class Reply:
            def __init__(self,data):self.data=data
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return json.dumps(self.data).encode()
        def fake(req,**kwargs):
            requests.append(req)
            if '/auth/v1/token' in req.full_url:return Reply({'access_token':'user-session-token','user':{'id':'u'},'expires_in':3600})
            if 'schema_version' in req.full_url:return Reply(1)
            return Reply({'inserted':1,'duplicates':0})
        api=API('https://example.supabase.co','sb_publishable_qa_only','writer@example.test','fake-test-password','11111111-1111-4111-8111-111111111111')
        with patch('supabase_sync.urlopen',fake):api.send([{'id':'sample'}])
        self.assertNotIn('Authorization',requests[0].headers)
        self.assertEqual(requests[-1].headers['Authorization'],'Bearer user-session-token')
        self.assertEqual(requests[-1].headers['Apikey'],'sb_publishable_qa_only')
        self.assertEqual(json.loads(requests[-1].data)['p_rows'][0]['id'],'sample')

    def test_gateway_rejects_secret_key_and_non_https_endpoint(self):
        for url,key in [('https://example.supabase.co','sb_secret_not_allowed'),('http://remote.example','sb_publishable_qa_only')]:
            with self.assertRaises(ValueError):API(url,key,'x','x','11111111-1111-4111-8111-111111111111')

if __name__=='__main__':unittest.main()
