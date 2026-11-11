"""Tests of the worker's HTTP layer without a model (python3 -B -m unittest test_server): token, body checks, busy."""
import json
import os
import threading
import time
import unittest
import urllib.error
import urllib.request

os.environ["BILD_TOKEN"] = "t" * 20
import server  # noqa: E402


class FakeImg:
    def convert(self, _):
        return self

    def save(self, buf, *_a, **_k):
        buf.write(b"\xff\xd8\xff\xe0fake")


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.generate = lambda q, d: (time.sleep(float(q.get("sleep", 0))), (FakeImg(), 256, 256))[1]
        cls.srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def post(self, body, token="t" * 20):
        req = urllib.request.Request(self.base + "/generate", data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_token(self):
        self.assertEqual(self.post({"prompt": "p", "width": 256, "height": 256, "seed": 1}, token="x" * 20)[0], 401)

    def test_bad(self):
        self.assertEqual(self.post({"prompt": "", "width": 256, "height": 256, "seed": 1})[0], 400)

    def test_ok(self):
        code, j = self.post({"prompt": "p", "width": 256, "height": 256, "seed": 1})
        self.assertEqual(code, 200)
        self.assertEqual(j["mime"], "image/jpeg")

    def test_busy(self):
        t = threading.Thread(target=self.post, args=({"prompt": "p", "width": 256, "height": 256, "seed": 1, "sleep": 2.5},))
        t.start()
        time.sleep(0.2)
        code, j = self.post({"prompt": "p", "width": 256, "height": 256, "seed": 2, "timeout_ms": 1200})
        t.join()
        self.assertEqual((code, j["error"]), (503, "busy"))

    def test_clamp(self):
        self.assertEqual(server.clamp16(4000), 1024)
        self.assertEqual(server.clamp16(300), 288)
        self.assertEqual(server.clamp16(10), 256)


if __name__ == "__main__":
    unittest.main()
