# Session notes — steady writer

Built module-by-module in this order:
1. `models.py` — Webhook + DeliveryAttempt dataclasses
2. `ratelimiter.py` — TokenBucket with monotonic refill
3. `backoff.py` — capped exponential + full jitter
4. `dispatcher.py` — semaphore + per-destination buckets
5. `api.py` — FastAPI enqueue/status endpoints
6. `tests/test_dispatcher.py` — ratelimiter + backoff invariants

Ran `pytest -q` and `ruff check .` after each module. Read asyncio Semaphore docs
and AWS backoff+jitter article in browser before implementing retry loop.
