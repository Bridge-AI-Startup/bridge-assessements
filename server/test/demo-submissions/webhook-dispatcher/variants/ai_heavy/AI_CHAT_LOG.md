# AI assistant log (excerpts)

**Q:** Thread-safe token bucket without locking every call path?  
**A:** Lazy refill under a short lock using monotonic timestamps…

**Q:** Exponential backoff with full jitter to avoid thundering herd?  
**A:** `delay = random.uniform(0, min(max_delay, base * 2**(attempt-1)))` …

**Q:** Bound concurrent deliveries with asyncio while rate-limiting per destination?  
**A:** Semaphore for global cap + per-URL token bucket before acquire…

Used Cmd-K to wrap POST in semaphore and add full jitter branch.
