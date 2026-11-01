# SpriteMaxing

A simple tracker for every Fortnite **Chapter 7** Sprite and its variants, with a tab per season (the newest opens by default).
Mark each one as **To be found**, **Indexed** or **Mastered**.

**Live:** https://schweppes-0x.github.io/SpriteMaxing/ (GitHub Pages, deployed from `main`). Share links made there open for anyone.

- **Season 5 · Treasure Hunters** (default tab): 13 Sprites in Normal, Fortune and Cursed (Gold arrives Nov 12), 37 entries. Sweet Dreams' Fortune and Cursed versions are announced but not datamined yet; until then they show the sprite's silhouette in the quality colour, and you can already track them.
- **Season 4 · Override:** 27 Sprites × 7 qualities (Normal, Gold, Cheat Master, Loot Hacker, Bounty Hunter, Trick or Treat, Quack), 162 entries. Mega Man has no special variants. Only Jonesy, Adventure, Bush, Klombo and Spooky Dash have a Quack variant.
- Each season shows only its own quality columns. Missing combinations show as a striped "—" cell.
- Progress is saved per season in the browser's `localStorage` (`spritesmaxing.<season>.v1`; Season 4 keeps the key it always had). **Backup** saves all seasons in one JSON file. **Restore** replaces the seasons in that file, and older single-season backups restore into Season 4. **Reset** only clears the season you are viewing.
  - It survives browser restarts in a normal window. After the first change the app asks the browser to mark the site's storage as *persistent* (`navigator.storage.persist()`), so it isn't evicted when disk space runs low.
  - Open tabs stay in sync, so editing in one tab never overwrites changes made in another.
  - If the browser blocks saving entirely, a warning banner says so. Private/incognito windows and "clear site data on exit" settings still wipe it on close; no website can prevent that, so use Backup there.
  - Storage is per address. Progress on `localhost:8095` and on the live site are separate; move it with Backup → Restore.
- **Export** saves your collection as a PNG image or an A4 PDF. You choose which statuses to include (To be found / Indexed / Mastered, all by default). Quality columns and sprite rows with nothing to show are left out. Sprite descriptions are not included.
  Export needs the page served over http (`node serve.js`), because browsers block canvas export for `file://` pages.
- **Share** creates a read-only link for the season you are viewing (`#share=1.<data>&s=<season>&by=<name>`; links without `s` are Season 4). Opening it shows that collection in view-only mode. Nothing is saved while viewing, so the visitor's own progress is never changed. The data lives in the URL hash, which is never sent to a server. Statuses are packed 2 bits per permanent sprite ID (`ids` in each `data/<season>.js`), so **never renumber those IDs**. New sprites simply get new IDs, and old links keep working. A season whose sprites have no IDs yet (Season 5 until its data update) can't be shared; the Share dialog explains this.

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
| `data/<season>.js` | One file per season (`c7s4`, `c7s5`, …): roster, rarity, ability text, image slug per variant, permanent IDs, and icons still missing. Listed in `index.html` |
| `img/*.webp` | 512×512 transparent sprite icons |
| `serve.js` | Zero-dependency static server (sends `Cache-Control: no-cache` so updates never mix with stale files) |
| `tools/update-data.js` | Refreshes a season file and `img/` from fortnite.gg (see below) |
| `tools/season-file.js` | Reads/writes the season files (shared by the update script) |

## Updating sprite data

New sprites and variants arrive mid-season. fortnite.gg only serves its pages to real browsers, so:

1. Open https://fortnite.gg/sprites in your browser and press **Ctrl+S** (any "Webpage" option works).
2. Optionally save the fortnite.gg page of each **new** sprite into the same folder, so its ability text is picked up.
3. Preview, then apply:

```bash
node tools/update-data.js --source "path/to/Fortnite Sprites Tracker - Fortnite.GG.html" --dry-run
```

```bash
node tools/update-data.js --source "path/to/Fortnite Sprites Tracker - Fortnite.GG.html"
```

It updates the **newest season** by default; add `--season c7s4` for another one. A season added by hand (like Season 5, before fortnite.gg had it) is linked automatically to the newest fortnite.gg season no other file claims. Until fortnite.gg lists it, the script just says so and writes nothing.

The script reports new sprites, new variants, rarity changes and anything renamed or delisted on fortnite.gg. It downloads missing icons directly, and placeholders disappear once a sprite has its icon. Without `--source` it tries to download the page itself and explains these steps if that's blocked.

**Adding a new season:** create `data/<id>.js` (copy the Season 5 file's shape: `id`, `label`, `name`, `title`, `order`, `ggSeason: null`, roster with `variants`, `ids: {}`, `missingIcons`), add a `<script>` tag for it in `index.html`, then run the update script once fortnite.gg lists the season.

**Compatibility guarantees:** saved progress, backups and share links keep working across updates.
- Variants are matched by their **permanent fortnite.gg ID**. If fortnite.gg renames a sprite's URL, our slug stays the same. Entries added by hand before fortnite.gg had them (no ID yet) are matched once by sprite name + quality, then adopt the ID and keep their slug, so progress tracked on placeholders carries over.
- **Nothing is removed.** Sprites that drop off fortnite.gg stay in the tracker.
- **New quality types** (like Trick or Treat was mid-season) appear automatically with a generic lavender style. Add a colour (`--v-<key>` in `styles.css`) and perk text (`QUALITIES` in `app.js`) when the details are known.
- **Backups (format 3)** hold every season and store each entry's permanent ID next to its slug. Restore matches by slug first, then by ID, so a backup made before or after a rename still restores. Older backups without IDs keep working, and entries that match nothing are skipped and reported.

## Sources

- Roster, rarities, ability text and icons are datamined from the game files, via [fortnite.gg/sprites](https://fortnite.gg/sprites).
- Season 5 (Treasure Hunters) roster, abilities and quality perks: Epic's [Treasure Hunters announcement](https://communities.epicgames.com/thread/set-sail-for-fortnite-treasure-hunters-the-greatest-adventure-of-all-time/Pmud) (Nov 1, 2026), until fortnite.gg datamines it.
- Cross-checked against the [Fortnite Wiki – Sprites](https://fortnite.fandom.com/wiki/Sprites) (system and variant perks, including Quack) and the [Chapter 7: Season 4](https://fortnite.fandom.com/wiki/Chapter_7:_Season_4) page.
- Also checked against [spritelocker.com](https://spritelocker.com/) and the [accountshark checklist](https://accountshark.net/fortnite-sprite-checklist). All 27 base Sprites match across sources.

Fortnite is a trademark of Epic Games. This is an unofficial fan tool.
