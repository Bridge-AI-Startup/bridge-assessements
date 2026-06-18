from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
import yaml
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .dispatcher import Dispatcher
from .models import Status, Webhook

_cfg_path = Path(__file__).resolve().parent.parent / "config.yaml"
_dispatcher = Dispatcher(cfg=yaml.safe_load(_cfg_path.read_text())["dispatcher"])

app = FastAPI(title="Webhook Dispatcher")
_store: dict[str, Webhook] = {}


class EnqueueBody(BaseModel):
    url: str
    payload: dict


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.post("/webhooks")
async def enqueue(body: EnqueueBody) -> dict:
    wh = Webhook(url=body.url, payload=body.payload)
    _store[wh.id] = wh

    async def _run() -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await _dispatcher.deliver(wh, client)

    asyncio.create_task(_run())
    return {"id": wh.id, "status": wh.status}


@app.get("/webhooks/{wid}")
async def status(wid: str) -> dict:
    wh = _store.get(wid)
    if wh is None:
        raise HTTPException(status_code=404, detail="unknown webhook")
    return {"id": wh.id, "status": wh.status, "attempts": wh.attempts}


@app.on_event("startup")
async def resume_inflight() -> None:
    for wh in _store.values():
        if wh.status == Status.DELIVERING:
            wh.status = Status.QUEUED
