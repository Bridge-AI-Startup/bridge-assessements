import threading
import time
from dataclasses import dataclass


@dataclass
class TokenBucket:
    """Thread-safe token bucket. rate = tokens/sec, capacity = burst."""

    rate: float
    capacity: int
    _tokens: float = 0.0
    _updated: float = 0.0
    _lock: threading.Lock = None  # type: ignore

    def __post_init__(self) -> None:
        self._tokens = float(self.capacity)
        self._updated = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._updated
        self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
        self._updated = now

    def try_acquire(self, n: int = 1) -> bool:
        with self._lock:
            self._refill()
            if self._tokens >= n:
                self._tokens -= n
                return True
            return False
