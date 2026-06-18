import random


def backoff_delay(
    attempt: int,
    base_ms: int,
    max_ms: int,
    jitter: str = "full",
) -> float:
    """Exponential backoff with optional full jitter; returns seconds."""
    if attempt < 1:
        raise ValueError("attempt must be >= 1")
    exp = min(max_ms, base_ms * (2 ** (attempt - 1)))
    if jitter == "full":
        return random.uniform(0, exp) / 1000.0
    if jitter == "equal":
        return (exp / 2 + random.uniform(0, exp / 2)) / 1000.0
    return exp / 1000.0
