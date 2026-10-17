# SpriteMaxing

A simple tracker for every Fortnite **Chapter 7 Season 4** Sprite and its variants.
Mark each one as **To be found**, **Indexed** or **Mastered**.

**Live:** https://schweppes-0x.github.io/SpriteMaxing/ (GitHub Pages, deployed from `main`). Share links made there open for anyone.

- 27 Sprites × 7 qualities: Normal, Gold, Cheat Master, Loot Hacker, Bounty Hunter, Trick or Treat and Quack. That makes 162 trackable entries.
- Mega Man has no special variants. Only Jonesy, Adventure, Bush, Klombo and Spooky Dash have a Quack variant. Missing combinations show as a striped "—" cell.
- Progress is saved in the browser's `localStorage`. Use **Backup** and **Restore** (JSON) to back it up or move it to another browser.
- **Export** saves your collection as a PNG image or an A4 PDF. You choose which statuses to include (To be found / Indexed / Mastered, all by default). Quality columns and sprite rows with nothing to show are left out. Sprite descriptions are not included.
  Export needs the page served over http (`node serve.js`), because browsers block canvas export for `file://` pages.
- **Share** creates a read-only link (`#share=1.<data>&by=<name>`). Opening it shows that collection in view-only mode. Nothing is saved while viewing, so the visitor's own progress is never changed. The data lives in the URL hash, which is never sent to a server. Statuses are packed 2 bits per permanent sprite ID (`window.SPRITE_IDS` in `data.js`), so **never renumber those IDs**. New sprites simply get new IDs, and old links keep working.

## Run

```bash
node serve.js 8095
```

Then open http://localhost:8095. Opening `index.html` directly also works.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The tracker UI (no build step, no dependencies) |
| `export.js` | PNG / PDF collection export (canvas renderer + a small built-in PDF writer) |
| `data.js` | Sprite roster: name, rarity, ability text, and the image slug per variant |
| `img/*.webp` | 512×512 transparent sprite icons |
| `serve.js` | Zero-dependency static server |

## Sources

- Roster, rarities, ability text and icons are datamined from the game files, via [fortnite.gg/sprites](https://fortnite.gg/sprites).
- Cross-checked against the [Fortnite Wiki – Sprites](https://fortnite.fandom.com/wiki/Sprites) (system and variant perks, including Quack) and the [Chapter 7: Season 4](https://fortnite.fandom.com/wiki/Chapter_7:_Season_4) page.
- Also checked against [spritelocker.com](https://spritelocker.com/) and the [accountshark checklist](https://accountshark.net/fortnite-sprite-checklist). All 27 base Sprites match across sources.

Fortnite is a trademark of Epic Games. This is an unofficial fan tool.
