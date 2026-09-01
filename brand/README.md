# Bridge brand assets

Exports of the Bridge mark and wordmark, plus the tokens that define them.
Everything in `logo/` and `wordmark/` is **derived** — regenerate with
`node brand/build.cjs` rather than editing a PNG by hand.

## What's here

| File | Size | Use |
|---|---|---|
| `logo/bridge-logo-ink.png` | 500×500 | The mark on light surfaces. Transparent, with the source file's own square padding — the drop-in replacement for `bridge-logo.svg`. |
| `logo/bridge-logo-pale.png` | 500×500 | Same, tinted for dark surfaces. |
| `logo/bridge-logo-ink-trimmed.png` | 302×206 | Mark with the padding cropped off, for when you want to control the margin yourself. |
| `logo/bridge-logo-pale-trimmed.png` | 302×206 | Same, dark-surface tint. |
| `logo/bridge-logo-ink-on-cream.png` | 1000×1000 | Mark on the cream field — avatars, favicons, anywhere a transparent PNG would land on an unknown background. |
| `wordmark/bridge-wordmark-ink.png` | 1463×537 | Mark + "Bridge" lockup, transparent. |
| `wordmark/bridge-wordmark-ink-on-cream.png` | 1463×537 | Lockup on cream. |
| `wordmark/bridge-wordmark-pale.png` | 1463×537 | Lockup for dark surfaces. |
| `source/bridge-logo.svg` | — | The source of truth, copied from `client/public/bridge-logo.svg`. |

## Tokens

| Token | Value | Where |
|---|---|---|
| Ink | `#21201C` | The mark and wordmark on light surfaces |
| Cream | `#FAF9F2` | The brand field |
| Pale | `#DEDFE3` | The mark and wordmark on dark surfaces |
| Wordmark type | Inter Medium (500), `-0.025em` tracking | The "Bridge" lettering |

These match the app's design system — see the "Bridge design system" section of
[`CLAUDE.md`](../CLAUDE.md), and `client/tailwind.config.js` for the full ramp.

## Two things to know before using these

**The mark is a raster, not a vector.** `source/bridge-logo.svg` is a 500×500 PNG
wrapped in an `<svg>` tag, so 500px is the real ceiling — the SVG buys you nothing
at larger sizes, and every export here inherits that limit. At poster scale you
can see it on the mark's edges. Anything print-sized needs the mark traced to
actual paths first.

**The lockup is generated, not an original file.** The product has never had a
wordmark asset — the header composes the mark with live `Bridge` text
(`client/src/pages/Landing.jsx`). `build.cjs` reproduces those proportions, so
the exports and the running site read as the same wordmark. If the header's
spacing or type ever changes, change it in `build.cjs` too or they will drift.

## Regenerating

```bash
node brand/build.cjs
```

`sharp` is resolved from `server/node_modules`, so `server/` must have its deps
installed. The wordmark needs Inter, which macOS does not ship; without it the
lettering silently falls back to a system face. The script warns when Inter is
missing, and the header comment in `build.cjs` has the one-time font setup.
