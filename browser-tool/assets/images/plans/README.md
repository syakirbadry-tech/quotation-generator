# Plan tier images

Used on the section introducing the client's specific medical plan tier (e.g. Medic TotalCare Plan 200). One image per tier number, keyed by the plan's bare tier number - manifest keys: `plans.150`, `plans.200`, `plans.300`, `plans.500`, etc. If a client's plan tier has no image yet, the renderer falls back to `plans.default` if you've set one, or the site-wide default. Consider: a hospital reception/lobby shot that subtly conveys "tier" through setting quality, without needing any text/numbers baked into the image itself (the real numbers are rendered as real text elsewhere on the page).

See the [top-level assets README](../README.md) for sizing guidance,
how the manifest/fallback system works, and how to add a new image
without touching any code.
