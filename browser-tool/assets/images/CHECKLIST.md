# Production images needed

Check items off as you drop the file in and add its line to
[`image-manifest.json`](image-manifest.json). Nothing below is required
for the site to work today - every item gracefully falls back to a
placeholder/default until supplied (see the top-level
[`README.md`](README.md)). This list is a starting point, not a hard
ceiling: any future plan tier, coverage amount, or room rate just needs
its own new line in the manifest, no code changes.

## Confirmed needed (seen in real parsed quotations so far)

- [ ] Plan 200 (`plans["200"]`) - the only plan tier seen in the one real sample PDF processed to date
- [ ] Coverage RM200,000 (`coverage["200000"]`)
- [ ] Room & Board RM200/day (`roomBoard["200"]`)

## One-time images (used on every quotation, regardless of plan)

- [ ] Hero Image (`hero.default`)
- [ ] Hospital Admission (`hospital.default`)
- [ ] Accident (`accident.default`)
- [ ] Surgery (`surgery.default`)
- [ ] Recovery (`recovery.default`)
- [ ] Financial Protection (`financial.default`)
- [ ] Waiting Period (`waitingPeriod.default`)
- [ ] Cash Value (`cashValue.default`)
- [ ] Guarantee (`guarantee.default`)

## Likely-needed variants (not yet confirmed from a real quotation - prepare if you expect these plans/amounts to come up)

- [ ] Plan 150 (`plans["150"]`)
- [ ] Plan 300 (`plans["300"]`)
- [ ] Plan 500 (`plans["500"]`)
- [ ] Coverage RM1,200,000 (`coverage["1200000"]`)
- [ ] Coverage RM1,500,000 (`coverage["1500000"]`)
- [ ] Room & Board RM150 (`roomBoard["150"]`)
- [ ] Room & Board RM300 (`roomBoard["300"]`)

## Optional site-wide fallback

- [ ] `default.jpg` at `browser-tool/assets/images/default.jpg` - the
      absolute last resort if a specific image AND its category's own
      default are both missing. Until this exists, that last-resort case
      falls back to `misc.default` if you've set one, or the renderer's
      built-in placeholder panel - never a broken image either way.
