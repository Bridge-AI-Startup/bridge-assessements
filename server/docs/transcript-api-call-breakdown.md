# Transcript generation — API call breakdown & rate limiting

This doc summarizes which OpenAI calls happen during proctoring transcript generation and which ones drive rate limits (429).

---

## Summary: What’s using the API and causing 429s

| Rank | Call type | Model | API calls (typical run) | Causes 429? | Why |
|------|-----------|--------|---------------------------|--------------|-----|
| 1 | **file_tree OCR** | gpt-4o-mini | ~1 per 3 frames (always) | **Yes** | Not Tesseract-eligible; every batch hits the API. |
| 2 | **terminal OCR** | gpt-4o-mini | ~1 per 3 frames (often) | **Yes** | Tesseract confidence usually &lt; 65% → vision fallback. |
| 3 | **editor OCR fallback** | gpt-4o-mini | Occasional | Sometimes | Only when Tesseract &lt; 60%. |
| 4 | **ai_chat OCR fallback** | gpt-4o | Occasional | Less often | Different model/limit; Tesseract often passes. |
| 5 | **Region detection (layout)** | gpt-4o-mini | Every 60 frames or on big change | Sometimes | One large image per call; less frequent. |

So **gpt-4o-mini** is the main driver of both volume and rate limits, and **file_tree** and **terminal** are the two call types that fire on almost every batch.

---

## Pipeline summary

For each batch of 3 frames we flush 4 region types in order: **ai_chat → editor → file_tree → terminal**. Each flush either uses Tesseract only (no API) or sends a vision request (gpt-4o-mini or gpt-4o). Region detection (layout) uses gpt-4o-mini when the layout is re-detected.

---

## Table: What uses the API and what gets rate limited

| Call type | Model | When it runs | Uses API? | Typically 429? | Notes |
|-----------|--------|----------------|------------|----------------|--------|
| **Region detection** (layout) | gpt-4o-mini | First frame, every 60 frames, or on major visual change (~15% diff) | Yes | Sometimes | Infrequent; one big image per call. |
| **file_tree OCR** | gpt-4o-mini | Every flush (every 3 frames) | **Always** | **Yes** | file_tree is not Tesseract-eligible → every batch hits the API. |
| **terminal OCR** | gpt-4o-mini | Every flush when Tesseract confidence &lt; 65% | **Often** | **Yes** | Terminal crops usually fall back to vision (colored output, small text). |
| **editor OCR** | gpt-4o-mini | Only when Tesseract confidence &lt; 60% | Sometimes | When used | Editor often passes Tesseract; fallback is less common. |
| **ai_chat OCR** | gpt-4o | Only when Tesseract confidence &lt; 70% | Sometimes | Less often | ai_chat uses gpt-4o; fewer calls, different rate limit. |

---

## Table: From your log snippet (this run segment)

*Parsed from the terminal output before the server restart. Run the script below on a full transcript log for complete counts.*

| Metric | Count |
|--------|--------|
| **Vision calls (gpt-4o-mini)** | 2 file_tree + 2 terminal = **4** (in snippet) |
| **Vision calls (gpt-4o)** | 0 (ai_chat used Tesseract in snippet) |
| **Region detection calls** | 0 in snippet (layout cached) |
| **429 retries (gpt-4o-mini)** | **10** (one terminal batch hit 5 retries) |
| **Flushes that used Tesseract only** | editor: 2, ai_chat: 2 |
| **Flushes that used vision** | file_tree: 2, terminal: 2 |

So in this segment, **file_tree** and **terminal** were the only regions causing vision API calls, and **gpt-4o-mini** was the model that got rate limited.

---

## Main drivers of rate limiting

1. **file_tree** — Every batch of 3 frames triggers one gpt-4o-mini call (no Tesseract). For 100 frames that’s ~33 calls.
2. **terminal** — Most batches fall back to vision (Tesseract confidence often &lt; 65%). Another ~33 calls for 100 frames.
3. **Concurrency** — Only 2 concurrent OpenAI requests (`OPENAI_MAX_CONCURRENT=2`). Many requests queue and then hit 429 when they run.
4. **Retries** — Each 429 triggers up to 5 retries with backoff (1s → 2s → 4s → 8s → 16s), so one rate-limited call can take ~30+ seconds and still count as multiple attempts against the limit.

---

## How to get exact counts from a full run

Run transcript generation, then parse the saved terminal or log file:

```bash
cd server
node scripts/parse-transcript-logs.js /path/to/terminal-or-log.txt
```

Or pipe from stdin:

```bash
cat /path/to/log.txt | node scripts/parse-transcript-logs.js
```

The script prints: vision calls by model and by region, region-detection calls, 429 retry counts, and flush/Tesseract-only counts.
