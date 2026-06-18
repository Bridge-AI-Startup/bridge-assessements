# Debug log — test loop session

## Initial failure (fixed)
```
tests/test_dispatcher.py ..F.
test_backoff_grows_and_caps
> assert backoff_delay(20, 200, 30000, jitter='none') <= 30.0
E assert 104857.6 <= 30.0
```

Root cause: missing `exp = min(max_ms, ...)` cap before returning delay.

## Fix applied
Added cap in `dispatcher/backoff.py`, re-ran pytest → 4 passed.

```bash
git diff --stat
 dispatcher/backoff.py | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```
