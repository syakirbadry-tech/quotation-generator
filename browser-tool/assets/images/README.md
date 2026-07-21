# Image assets

This folder is the single physical home for every production image the
quotation renderer can display. **The renderer never hardcodes an image
filename or path anywhere** - it only ever calls a function on
`renderer/AssetManager.js` (e.g. `getHospitalImage()`,
`getPlanImage(planTier)`), and that module is the only thing that reads
[`image-manifest.json`](image-manifest.json) to decide which actual file
to use.

## How it works

```
Renderer  →  AssetManager.js  →  image-manifest.json  →  a real file in this folder
```

- `image-manifest.json` maps a **category** (`hero`, `plans`, `coverage`,
  `roomBoard`, `hospital`, `accident`, `surgery`, `recovery`, `financial`,
  `waitingPeriod`, `cashValue`, `guarantee`, `misc`) and, for categories
  that vary by product data, a **key** (a plan tier number, an annual
  limit amount, a room & board rate) to a relative path under this
  folder.
- If a specific key isn't in the manifest yet (e.g. a brand-new plan
  tier nobody's added an image for), `AssetManager.js` falls back to
  that category's own `"default"` entry if one exists, and finally to
  the site-wide fallback - **never a broken `<img>` tag, never a crash**.
  A warning is logged (`console.warn`) whenever a fallback is used, so
  a missing image is visible in the browser console during review,
  never silently wrong in front of a client.
- Until a real image exists for something, the renderer shows a
  tasteful placeholder panel instead of an empty/broken image - see
  `renderer/renderNarrativeQuotation.js`'s `kenBurnsMedia()`.

## Adding a new image (no code changes, ever)

1. Drop the file in the right subfolder below (see that subfolder's own
   `README.md` for exactly what it should show and recommended sizing).
2. Add one line to `image-manifest.json` pointing at it.
3. Done - the next generated quotation picks it up automatically.

## Subfolders

| Folder | Manifest category | Varies by |
|---|---|---|
| [`hero/`](hero/README.md) | `hero` | nothing - one image |
| [`plans/`](plans/README.md) | `plans` | plan tier number (150/200/300/500/...) |
| [`coverage/`](coverage/README.md) | `coverage` | annual limit amount |
| [`room-board/`](room-board/README.md) | `roomBoard` | room & board daily rate |
| [`hospital/`](hospital/README.md) | `hospital` | nothing - one image |
| [`accident/`](accident/README.md) | `accident` | nothing - one image |
| [`surgery/`](surgery/README.md) | `surgery` | nothing - one image |
| [`recovery/`](recovery/README.md) | `recovery` | nothing - one image |
| [`financial/`](financial/README.md) | `financial` | nothing - one image |
| [`waiting-period/`](waiting-period/README.md) | `waitingPeriod` | nothing - one image |
| [`cash-value/`](cash-value/README.md) | `cashValue` | nothing - one image |
| [`guarantee/`](guarantee/README.md) | `guarantee` | nothing - one image |
| [`misc/`](misc/README.md) | `misc` | free-form, for anything added later |

## Sizing guidance (applies to every category)

Every image renders full-bleed behind dark text in a `min-height: 88-92vh`
mobile-first section (`object-fit: cover`, so cropping happens
automatically - compose your shot with the subject roughly centred, not
tight against the edges). Recommended:

- **Aspect ratio:** portrait or near-square (e.g. 4:5 or 3:4) - these
  sections are tallest on mobile, which is the primary viewing device for
  a client opening a link on their phone.
- **Minimum resolution:** 1200×1500px (scales down cleanly for smaller
  screens; upscaling a smaller source image will look soft).
- **Format:** `.jpg` for photos (smaller file size, no transparency
  needed - these are full-bleed backgrounds, not logos/icons).
- **Exposure:** a dark gradient overlay is applied automatically on top
  of every image for text legibility - a shot that's a little brighter
  than you'd otherwise pick usually reads better once the overlay is on.

## Site-wide fallback

`AssetManager.js` falls all the way back to `assets/images/default.jpg`
(this exact path, not yet present) only when a category has **no**
`"default"` entry of its own either. No file is checked into this repo
yet under that name - until one exists, the renderer's own placeholder
panel is used instead, which is graceful and expected, not an error.
