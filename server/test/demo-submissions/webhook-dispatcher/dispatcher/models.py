from __future__ import annotations

import enum
import time
import uuid
from dataclasses import dataclass, field


class Status(str, enum.Enum):
    QUEUED = "queued"
    DELIVERING = "delivering"
    DELIVERED = "delivered"
    FAILED = "failed"


@dataclass
class Webhook:
    url: str
    payload: dict
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: Status = Status.QUEUED
    attempts: int = 0
    created_at: float = field(default_factory=time.time)


@dataclass
class DeliveryAttempt:
    webhook_id: str
    attempt: int
    status_code: int | None
    error: str | None
    at: float = field(default_factory=time.time)
