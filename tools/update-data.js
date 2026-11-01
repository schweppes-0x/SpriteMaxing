#!/usr/bin/env node
// Refreshes a season's data file (data/<season>.js) and img/ from fortnite.gg's datamined sprite list.
//
//   node tools/update-data.js --source page.html             update the newest season
//   node tools/update-data.js --source page.html --season c7s4   update a specific season
//   node tools/update-data.js ... --dry-run                  only report what would change
//   node tools/update-data.js ... --full                     also re-fetch ability text for existing sprites
//
// fortnite.gg serves its HTML pages only to real browsers (Cloudflare check), so a direct download
// usually fails. Then: open https://fortnite.gg/sprites in your browser, press Ctrl+S, and pass the
// saved file with --source. For a brand-new sprite you can also save its fortnite.gg page into the same
// folder; its ability text is picked up from there. Icons download directly (static files aren't blocked).
//
// Seasons: each data/<id>.js file is one season, linked to fortnite.gg's data-season number (ggSeason).
// A new season added by hand (ggSeason: null) is linked automatically to the newest fortnite.gg season
// that no other data file claims yet.
//
// Compatibility rules (saved progress, backups and share links depend on them):
//   * An existing sprite variant keeps its slug forever, even if fortnite.gg renames its URL.
//     Variants are matched by their permanent fortnite.gg id; entries added by hand before fortnite.gg
//     listed them (no id yet) are matched once by sprite name + quality and then adopt that id.
//   * Nothing is ever removed. Sprites that disappear from fortnite.gg stay in the tracker.
//   * Ids are never renumbered; new variants are only added.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSeasons, writeSeason, fileFor } = require('./season-file');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'img');
const SITE = 'https://fortnite.gg';
const UA = 'SpriteMaxing-data-updater/1.0 (personal sprite tracker)';
const RARITY_ORDER = ['rare', 'epic', 'legendary', 'mythic'];

// fortnite.gg variant name -> our quality key (keys app.js knows how to style and describe).
// Unknown names get a key derived from the label in the sprite's name ("Fortune Kelper Sprite" -> fortune).
const KNOWN_VARIANTS = {
  base: 'normal', gold: 'gold', cheatmaster: 'cheatmaster', hacker: 'loothacker',
  reaper: 'bountyhunter', tricktreat: 'trickortreat', quack: 'quack', fortune: 'fortune', cursed: 'cursed',
};
const APP_QUALITIES = new Set(['normal', 'gold', 'fortune', 'cursed', 'cheatmaster', 'loothacker', 'bountyhunter', 'trickortreat', 'quack']);

// ---------- args ----------
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('--dry-run');
const FULL = flag('--full');
const SOURCE = option('--source');
const SEASON_ARG = option('--season');

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
const slugify = s => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// For matching names across sources: "Lil' Squibbly Sprite" == "lil squibbly"
const nameKey = s => String(s || '').toLowerCase().replace(/\bsprite\b/g, '').replace(/[^a-z0-9]/g, '');

class BlockedError extends Error {}

async function fetchBytes(url, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      // A Cloudflare browser check: retrying won't help, the user has to save the page instead.
      if (res.headers.get('cf-mitigated') === 'challenge') throw new BlockedError(`${url} needs a real browser (Cloudflare check)`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (err instanceof BlockedError || attempt >= tries) throw err instanceof BlockedError ? err : new Error(`${url}: ${err.message}`);
      await sleep(1000 * attempt);
    }
  }
}
const fetchText = async url => (await fetchBytes(url)).toString('utf8');

function parseAttrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3]);
  return out;
}
// Icons are always served from /img/x/sprites/icons/<file>. A page saved with "Webpage, Complete"
// rewrites img src to a local "_files" folder, so rebuild the canonical URL from the file name.
function iconUrl(src = '') {
  const file = src.split(/[\\/]/).pop().split('?')[0];
  return /^T_Icon_/i.test(file) ? `${SITE}/img/x/sprites/icons/${file}` : new URL(src, SITE).href;
}

// Tolerant of both the raw page (single-quoted attributes) and browser-saved copies (re-serialized HTML).
function parseCards(html) {
  const cards = [];
  for (const m of html.matchAll(/<div\b[^>]*\bdata-sprite\s*=[^>]*>/gi)) {
    const a = parseAttrs(m[0]);
    if (!(a.class || '').split(/\s+/).includes('sprite-card')) continue;
    const rest = html.slice(m.index + m[0].length, m.index + m[0].length + 2000);
    const link = rest.match(/<a\b[^>]*>/i);
    const img = rest.match(/<img\b[^>]*>/i);
    if (!link || !img) continue;
    const la = parseAttrs(link[0]);
    const ia = parseAttrs(img[0]);
    cards.push({
      id: Number(a['data-sprite']),
      parent: a['data-parent'],
      parentName: a['data-parent-name'],
      rarity: a['data-rarity'],
      variant: a['data-variant'],
      season: a['data-season'],
      isNew: a['data-is-new'] === '1',
      href: new URL(la.href || '', SITE).pathname,
      img: iconUrl(ia.src),
      name: ia.alt || '',
    });
  }
  return cards.filter(c => Number.isInteger(c.id) && c.parent && c.parentName && c.variant);
}

// Saved fortnite.gg sprite pages next to the --source file, keyed by sprite name from their <title>.
function savedDetailPages(dir) {
  const pages = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!/\.html?$/i.test(f)) continue;
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const t = html.match(/<title>([^<]*?) - Fortnite Sprite - Fortnite\.GG/i);
    if (t) pages.set(decode(t[1]).toLowerCase(), html);
  }
  return pages;
}

// The ability lines sit between the rarity/"0%" header and the "Location" heading on a detail page.
function parseAbility(html) {
  const t = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n').split('\n').map(decode).filter(Boolean);
  const i = t.indexOf('All Sprites');
  const j = t.indexOf('Location', i);
  return i >= 0 && j > i ? t.slice(i + 4, j) : [];
}

// fortnite.gg URL -> slug, e.g. "/sprites/308-lil'-uzi-vert-jr." -> "lil-uzi-vert-jr" (safe as a file name).
const slugFromHref = href => decodeURIComponent(href.split('/').pop()).replace(/^\d+-/, '').replace(/-sprite$/, '')
  .toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isWebp = buf => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
const hasIcon = slug => fs.existsSync(path.join(IMG_DIR, `${slug}.webp`));

// ---------- main ----------
async function main() {
  const seasons = loadSeasons();
  if (!seasons.length) throw new Error('No season files found in data/.');
  const target = SEASON_ARG
    ? seasons.find(s => s.id === SEASON_ARG)
    : seasons.slice().sort((a, b) => b.order - a.order)[0];
  if (!target) throw new Error(`Unknown season "${SEASON_ARG}". Known: ${seasons.map(s => s.id).join(', ')}.`);
  const report = { newSprites: [], newVariants: [], adopted: [], renamedUpstream: [], rarityChanges: [], kept: [], images: [], warnings: [], extras: [] };

  console.log(SOURCE ? `Reading ${SOURCE}` : `Fetching ${SITE}/sprites`);
  let html;
  try {
    html = SOURCE ? fs.readFileSync(SOURCE, 'utf8') : await fetchText(`${SITE}/sprites`);
  } catch (err) {
    if (!(err instanceof BlockedError)) throw err;
    throw new Error([
      'fortnite.gg only serves its pages to real browsers, so it cannot be downloaded directly. Instead:',
      '  1. Open https://fortnite.gg/sprites in your browser.',
      '  2. Press Ctrl+S (Cmd+S on Mac) and save it, e.g. as sprites.html.',
      '  3. Run: node tools/update-data.js --source path/to/sprites.html',
      '  (Optional) For new sprites, also save their fortnite.gg page into the same folder to get their ability text.',
    ].join('\n'));
  }
  const detailPages = SOURCE ? savedDetailPages(path.dirname(path.resolve(SOURCE))) : new Map();
  const all = parseCards(html);
  if (!all.length) throw new Error('No sprite cards found. fortnite.gg may have changed its page layout; nothing was written.');
  const listedSeasons = [...new Set(all.map(c => c.season))].sort((a, b) => Number(b) - Number(a));

  // Which fortnite.gg season is this? Known for existing seasons; a new one claims the newest unclaimed number.
  let ggSeason = target.ggSeason;
  if (!ggSeason) {
    const claimed = new Set(seasons.map(s => s.ggSeason).filter(Boolean));
    ggSeason = listedSeasons.find(n => !claimed.has(n));
    if (!ggSeason) {
      console.log(`\nfortnite.gg doesn't list ${target.label} (${target.name}) yet: it only has seasons ${listedSeasons.join(', ')}, which are already tracked.`);
      console.log('Nothing was written. Try again in a day or two.');
      return;
    }
    console.log(`Linking ${target.label} (${target.name}) to fortnite.gg season ${ggSeason}.`);
  }
  const cards = all.filter(c => c.season === ggSeason);
  if (!cards.length) throw new Error(`fortnite.gg lists no sprites for season ${ggSeason} (found seasons: ${listedSeasons.join(', ')}); nothing was written.`);

  // Lookups. Slugs and icon files are shared by all seasons, so avoid collisions across all of them.
  const ids = target.ids || {};
  const sprites = target.sprites;
  const extras = target.extras || [];
  const slugById = Object.fromEntries(Object.entries(ids).map(([slug, id]) => [id, slug]));
  const spriteBySlug = new Map();
  for (const s of sprites) for (const slug of Object.values(s.variants)) spriteBySlug.set(slug, s);
  const usedSlugs = new Set(fs.existsSync(IMG_DIR) ? fs.readdirSync(IMG_DIR).map(f => f.replace(/\.webp$/, '')) : []);
  for (const season of seasons) for (const s of season.sprites) for (const slug of Object.values(s.variants)) usedSlugs.add(slug);
  const usedSpriteIds = new Set(sprites.map(s => s.id));
  const usesOrder = sprites.some(s => s.order != null);
  const imgUrlBySlug = {};

  function qualityKey(card) {
    if (KNOWN_VARIANTS[card.variant]) return KNOWN_VARIANTS[card.variant];
    const label = card.name.replace(card.parentName, '').replace(/\bSprite\b/, '').replace(/\s+/g, ' ').trim()
      || card.variant[0].toUpperCase() + card.variant.slice(1);
    const key = slugify(label).replace(/-/g, '') || slugify(card.variant).replace(/-/g, '');
    if (!APP_QUALITIES.has(key) && !extras.some(e => e.key === key)) {
      extras.push({ key, label });
      report.extras.push(`${label} (${key})`);
    }
    return key;
  }

  // Group the season's cards by their parent sprite.
  const groups = new Map();
  for (const c of cards) {
    if (!groups.has(c.parent)) groups.set(c.parent, []);
    groups.get(c.parent).push(c);
  }

  const listed = new Set();
  const needAbility = [];
  for (const group of groups.values()) {
    const base = group.find(c => c.variant === 'base') || group[0];
    const displayName = base.parentName.replace(/ Sprite$/, '');
    // Match an existing sprite through its variants' permanent ids, else (entries added by hand) by name.
    let sprite = group.map(c => slugById[c.id]).filter(Boolean).map(slug => spriteBySlug.get(slug)).find(Boolean)
      || sprites.find(s => nameKey(s.name) === nameKey(displayName));
    if (!sprite) {
      let id = slugify(displayName) || `sprite-${base.id}`;
      while (usedSpriteIds.has(id)) id = `${id}-${base.id}`;
      usedSpriteIds.add(id);
      sprite = { id, name: displayName, rarity: base.rarity, isNew: base.isNew, ability: [], variants: {} };
      if (usesOrder) sprite.order = Math.max(0, ...sprites.map(s => s.order || 0)) + 1;
      sprites.push(sprite);
      report.newSprites.push(displayName);
      needAbility.push([sprite, base]);
    } else {
      if (FULL || !(sprite.ability || []).length) needAbility.push([sprite, base]);
      if (base.variant === 'base' && RARITY_ORDER.includes(base.rarity) && sprite.rarity !== base.rarity) {
        report.rarityChanges.push(`${sprite.name}: ${sprite.rarity || 'unknown'} -> ${base.rarity}`);
        sprite.rarity = base.rarity;
      }
      sprite.isNew = base.isNew;
    }
    listed.add(sprite);

    for (const card of group) {
      const key = qualityKey(card);
      const upstream = slugFromHref(card.href);
      let slug = slugById[card.id];
      if (slug) {
        if (slug !== upstream) report.renamedUpstream.push(`${slug} (fortnite.gg now calls it ${upstream}; kept ours)`);
      } else if (sprite.variants[key] && ids[sprite.variants[key]] == null) {
        // Added by hand before fortnite.gg had it: adopt the permanent id, keep our slug.
        slug = sprite.variants[key];
        ids[slug] = card.id;
        slugById[card.id] = slug;
        report.adopted.push(`${slug} -> id ${card.id}`);
      } else {
        slug = upstream;
        if (usedSlugs.has(slug)) slug = `${slug}-${card.id}`;
        usedSlugs.add(slug);
        ids[slug] = card.id;
        slugById[card.id] = slug;
      }
      imgUrlBySlug[slug] = card.img;
      if (!sprite.variants[key]) {
        sprite.variants[key] = slug;
        if (!report.newSprites.includes(displayName)) report.newVariants.push(card.name);
      } else if (sprite.variants[key] !== slug) {
        report.warnings.push(`${card.name}: ${sprite.name} already has a "${key}" variant (${sprite.variants[key]}); ignored id ${card.id}.`);
      }
    }
  }
  for (const s of sprites) if (!listed.has(s)) report.kept.push(s.name);

  // Ability text for new sprites (or all, with --full).
  for (const [sprite, base] of needAbility) {
    const saved = detailPages.get(base.name.toLowerCase());
    try {
      if (!saved && SOURCE) throw new BlockedError('no saved page');
      const lines = parseAbility(saved || await fetchText(`${SITE}${base.href}`));
      if (lines.length) sprite.ability = lines;
      else report.warnings.push(`${sprite.name}: could not read ability text from its fortnite.gg page.`);
    } catch (err) {
      if (!(sprite.ability || []).length) {
        report.warnings.push(err instanceof BlockedError
          ? `${sprite.name}: no ability text yet. Save ${SITE}${base.href} next to your --source file and re-run to add it.`
          : `${sprite.name}: ability fetch failed (${err.message}).`);
      }
    }
    if (!saved && !SOURCE) await sleep(400);
  }

  // Icons: download any that are missing locally.
  const missing = sprites.flatMap(s => Object.values(s.variants)).filter(slug => !hasIcon(slug));
  for (const slug of missing) {
    const url = imgUrlBySlug[slug];
    if (!url) { report.warnings.push(`${slug}: icon missing and fortnite.gg doesn't list it.`); continue; }
    if (DRY) { report.images.push(`${slug} (would download)`); continue; }
    try {
      const buf = await fetchBytes(url);
      if (!isWebp(buf)) throw new Error('not a WebP image');
      fs.writeFileSync(path.join(IMG_DIR, `${slug}.webp`), buf);
      report.images.push(slug);
    } catch (err) {
      report.warnings.push(`${slug}: icon download failed (${err.message}).`);
    }
    await sleep(250);
  }

  // ---------- report ----------
  const list = (title, items) => { if (items.length) console.log(`\n${title} (${items.length}):\n  - ${items.join('\n  - ')}`); };
  const total = sprites.reduce((n, s) => n + Object.keys(s.variants).length, 0);
  console.log(`\n${target.label} (fortnite.gg season ${ggSeason}): ${cards.length} entries on fortnite.gg -> ${sprites.length} sprites, ${total} tracked variants.`);
  list('New sprites', report.newSprites);
  list('New variants of existing sprites', report.newVariants);
  list('Hand-added entries linked to their permanent fortnite.gg id (slug kept)', report.adopted);
  list('New quality types (shown with a generic style; add colours/perk text in app.js)', report.extras);
  list('Rarity changes', report.rarityChanges);
  list('Renamed on fortnite.gg (our slug kept so progress stays linked)', report.renamedUpstream);
  list('No longer listed on fortnite.gg (kept in the tracker)', report.kept);
  list(DRY ? 'Icons to download' : 'Icons downloaded', report.images);
  list('Warnings', report.warnings);
  if (DRY) { console.log('\nDry run: nothing written.'); return; }

  // ---------- write ----------
  const out = writeSeason({
    ...target,
    ggSeason,
    meta: { ...(target.meta || {}), source: 'fortnite.gg', updated: new Date().toISOString().slice(0, 10) },
    sprites, ids, extras,
    missingIcons: sprites.flatMap(s => Object.values(s.variants)).filter(slug => !hasIcon(slug)),
  });
  console.log(`\nWrote ${path.relative(process.cwd(), out) || fileFor(target.id)}.`);
}

main().catch(err => { console.error(`\nUpdate failed: ${err.message}`); process.exit(1); });
