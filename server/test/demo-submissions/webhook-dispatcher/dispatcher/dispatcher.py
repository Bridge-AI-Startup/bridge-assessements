import asyncio
import logging
from collections import defaultdict

import httpx

from .backoff import backoff_delay
from .models import DeliveryAttempt, Status, Webhook
from .ratelimiter import TokenBucket

logger = logging.getLogger("dispatcher")


class Dispatcher:
    def __init__(self, cfg: dict) -> None:
        self.cfg = cfg
        self._sem = asyncio.Semaphore(cfg["max_concurrency"])
        self._buckets: dict[str, TokenBucket] = defaultdict(self._new_bucket)
        self._attempts: list[DeliveryAttempt] = []

    def _new_bucket(self) -> TokenBucket:
        return TokenBucket(
            rate=self.cfg["per_destination_rate"],
            capacity=self.cfg["per_destination_burst"],
        )

    async def deliver(self, wh: Webhook, client: httpx.AsyncClient) -> Status:
        retry = self.cfg["retry"]
        for attempt in range(1, retry["max_attempts"] + 1):
            while not self._buckets[wh.url].try_acquire():
                await asyncio.sleep(0.05)
            async with self._sem:
                wh.status = Status.DELIVERING
                wh.attempts = attempt
                try:
                    resp = await client.post(wh.url, json=wh.payload)
                    self._attempts.append(
                        DeliveryAttempt(wh.id, attempt, resp.status_code, None)
                    )
                    if resp.status_code < 500:
                        wh.status = Status.DELIVERED
                        logger.info(
                            "delivered %s after %d attempt(s)", wh.id, attempt
                        )
                        return wh.status
                except httpx.HTTPError as exc:
                    self._attempts.append(
                        DeliveryAttempt(wh.id, attempt, None, str(exc))
                    )
            await asyncio.sleep(
                backoff_delay(
                    attempt,
                    retry["base_delay_ms"],
                    retry["max_delay_ms"],
                    jitter=retry.get("jitter", "full"),
                )
            )
        wh.status = Status.FAILED
        return wh.status
