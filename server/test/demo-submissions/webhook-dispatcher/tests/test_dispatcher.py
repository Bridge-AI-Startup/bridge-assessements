import time

from dispatcher.backoff import backoff_delay
from dispatcher.models import Status, Webhook
from dispatcher.ratelimiter import TokenBucket


def test_token_bucket_limits_rate():
    tb = TokenBucket(rate=5.0, capacity=2)
    assert tb.try_acquire()
    assert tb.try_acquire()
    assert not tb.try_acquire()


def test_token_bucket_refills():
    tb = TokenBucket(rate=100.0, capacity=1)
    assert tb.try_acquire()
    time.sleep(0.05)
    assert tb.try_acquire()


def test_backoff_grows_and_caps():
    d1 = backoff_delay(1, 200, 30000, jitter="none")
    d5 = backoff_delay(5, 200, 30000, jitter="none")
    assert d5 > d1
    assert backoff_delay(20, 200, 30000, jitter="none") <= 30.0


def test_webhook_defaults():
    wh = Webhook(url="https://x.test/hook", payload={"a": 1})
    assert wh.status == Status.QUEUED
    assert wh.attempts == 0
