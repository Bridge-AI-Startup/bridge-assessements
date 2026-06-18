# Bridge Take-Home — Resilient Webhook Dispatcher

## Problem
Build a service that reliably delivers webhook events to customer
endpoints. Deliveries must be **rate-limited per destination**, retried
with **exponential backoff + jitter**, and bounded in concurrency so a
slow endpoint cannot exhaust the worker pool.

## Requirements
1. Token-bucket rate limiter, thread-safe, configurable rate/burst.
2. Async dispatch loop with a bounded concurrency semaphore.
3. Retry policy: max attempts, exponential backoff, full jitter.
4. At-least-once delivery; persist attempt state so a restart resumes.
5. HTTP API: POST /webhooks to enqueue, GET /webhooks/{id} for status.

## Run
```bash
pip install -r requirements.txt
pytest -q
uvicorn dispatcher.api:app --reload
```
