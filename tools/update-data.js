#!/usr/bin/env node
// Refreshes data.js and img/ from fortnite.gg's datamined sprite list.
//
//   node tools/update-data.js              update data.js and download new icons
//   node tools/update-data.js --dry-run    only report what would change
//   node tools/update-data.js --full       also re-fetch ability text for existing sprites
//   node tools/update-data.js --source page.html   parse a saved copy of fortnite.gg/sprites
//
// fortnite.gg serves its HTML pages only to real browsers (Cloudflare check), so a direct download
// usually fails. Then: open https://fortnite.gg/sprites in your browser, press Ctrl+S, and pass the
// saved file with --source. For a brand-new sprite you can also save its fortnite.gg page into the same
// folder; its ability text is picked up from there. Icons download directly (static files aren't blocked).
//
// Compatibility rules (saved progress, backups and share links depend on them):
//   * An existing sprite variant keeps its slug forever, even if fortnite.gg renames its URL.
//     Variants are matched by their permanent fortnite.gg id, not by name.
//   * Nothing is ever removed. Sprites that disappear from fortnite.gg stay in the tracker.
//   * Ids in window.SPRITE_IDS are never renumbered; new variants are only added.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data.js');
const IMG_DIR = path.join(ROOT, 'img');
const SITE = 'https://fortnite.gg';
const UA = 'SpriteMaxing-data-updater/1.0 (personal sprite tracker)';
const DEFAULT_SEASON = '42'; // fortnite.gg's data-season for Chapter 7 Season 4
const RARITY_ORDER = ['rare', 'epic', 'legendary', 'mythic'];

// fortnite.gg variant name -> our quality key (keys app.js knows how to style and describe).
const KNOWN_VARIANTS = {
  base: 'normal', gold: 'gold', cheatmaster: 'cheatmaster', hacker: 'loothacker',
  reaper: 'bountyhunter', tricktreat: 'trickortreat', quack: 'quack',
};

// ---------- args ----------
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('--dry-run');
const FULL = flag('--full');
const SOURCE = option('--source');

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

function loadExisting() {
  if (!fs.existsSync(DATA_FILE)) return { sprites: [], ids: {}, extras: [], meta: {} };
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(DATA_FILE, 'utf8'), sandbox, { filename: 'data.js' });
  const w = sandbox.window;
  return {
    sprites: JSON.parse(JSON.stringify(w.SPRITES || [])),
    ids: { ...(w.SPRITE_IDS || {}) },
    extras: JSON.parse(JSON.stringify(w.SPRITE_EXTRA_VARIANTS || [])),
    meta: { ...(w.SPRITE_META || {}) },
  };
}

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

const slugFromHref = href => href.split('/').pop().replace(/^\d+-/, '').replace(/-sprite$/, '');
const isWebp = buf => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

// ---------- main ----------
async function main() {
  const existing = loadExisting();
  const season = existing.meta.season || DEFAULT_SEASON;
  const report = { newSprites: [], newVariants: [], renamedUpstream: [], rarityChanges: [], kept: [], images: [], warnings: [], extras: [] };

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
  const cards = all.filter(c => c.season === season);
  if (!cards.length) {
    const seen = [...new Set(all.map(c => c.season))].join(', ');
    throw new Error(`fortnite.gg lists no sprites for season ${season} (found seasons: ${seen}). A new season probably started; nothing was written.`);
  }

  // Lookups from the current data.
  const slugById = Object.fromEntries(Object.entries(existing.ids).map(([slug, id]) => [id, slug]));
  const spriteBySlug = new Map();
  for (const s of existing.sprites) for (const slug of Object.values(s.variants)) spriteBySlug.set(slug, s);
  const usedSlugs = new Set(Object.keys(existing.ids));
  for (const s of existing.sprites) for (const slug of Object.values(s.variants)) usedSlugs.add(slug);
  const usedSpriteIds = new Set(existing.sprites.map(s => s.id));
  const extras = existing.extras;
  const ids = existing.ids;
  const sprites = existing.sprites;
  const imgUrlBySlug = {};

  function qualityKey(card) {
    if (KNOWN_VARIANTS[card.variant]) return KNOWN_VARIANTS[card.variant];
    const key = slugify(card.variant).replace(/-/g, '');
    if (!extras.some(e => e.key === key)) {
      const label = card.name.replace(card.parentName, '').replace(/\bSprite\b/, '').replace(/\s+/g, ' ').trim()
        || key[0].toUpperCase() + key.slice(1);
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
    // Match an existing sprite through any of its variants' permanent ids.
    let sprite = group.map(c => slugById[c.id]).filter(Boolean).map(slug => spriteBySlug.get(slug)).find(Boolean);
    const displayName = base.parentName.replace(/ Sprite$/, '');
    if (!sprite) {
      let id = slugify(displayName) || `sprite-${base.id}`;
      while (usedSpriteIds.has(id)) id = `${id}-${base.id}`;
      usedSpriteIds.add(id);
      sprite = { id, name: displayName, rarity: base.rarity, isNew: base.isNew, ability: [], variants: {} };
      sprites.push(sprite);
      report.newSprites.push(displayName);
      needAbility.push([sprite, base]);
    } else {
      if (FULL) needAbility.push([sprite, base]);
      if (base.variant === 'base' && RARITY_ORDER.includes(base.rarity) && sprite.rarity !== base.rarity) {
        report.rarityChanges.push(`${sprite.name}: ${sprite.rarity} -> ${base.rarity}`);
        sprite.rarity = base.rarity;
      }
      sprite.isNew = base.isNew;
    }
    listed.add(sprite);

    for (const card of group) {
      const key = qualityKey(card);
      let slug = slugById[card.id];
      const upstream = slugFromHref(card.href);
      if (slug) {
        if (slug !== upstream) report.renamedUpstream.push(`${slug} (fortnite.gg now calls it ${upstream}; kept ours)`);
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
      report.warnings.push(err instanceof BlockedError
        ? `${sprite.name}: no ability text yet. Save ${SITE}${base.href} next to your --source file and re-run to add it.`
        : `${sprite.name}: ability fetch failed (${err.message}).`);
    }
    if (!saved) await sleep(400);
  }

  // Icons: download any that are missing locally.
  const missingImgs = sprites.flatMap(s => Object.values(s.variants)).filter(slug => !fs.existsSync(path.join(IMG_DIR, `${slug}.webp`)));
  for (const slug of missingImgs) {
    const url = imgUrlBySlug[slug];
    if (!url) { report.warnings.push(`${slug}: icon missing and fortnite.gg no longer lists it.`); continue; }
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

  // ---------- write ----------
  sprites.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
  const sortedIds = Object.fromEntries(Object.entries(ids).sort((a, b) => a[1] - b[1]));
  const meta = { season, source: 'fortnite.gg', updated: new Date().toISOString().slice(0, 10) };
  const out = [
    '// Generated by tools/update-data.js from datamined Chapter 7 Season 4 sprite data (fortnite.gg),',
    '// cross-checked with fortnite.fandom.com. Images: img/<slug>.webp (512x512).',
    '// Do not hand-edit slugs or ids: saved progress, backups and share links depend on them.',
    `window.SPRITES = ${JSON.stringify(sprites, null, 2)};`,
    '',
    '// Permanent fortnite.gg sprite IDs, used by share links and backups. Never renumber; new sprites just get new IDs.',
    `window.SPRITE_IDS = ${JSON.stringify(sortedIds)};`,
    '',
    '// Qualities that appeared after the app was written (app.js shows them with a generic style).',
    `window.SPRITE_EXTRA_VARIANTS = ${JSON.stringify(extras)};`,
    '',
    `window.SPRITE_META = ${JSON.stringify(meta)};`,
    '',
  ].join('\n');

  // ---------- report ----------
  const list = (title, items) => { if (items.length) console.log(`\n${title} (${items.length}):\n  - ${items.join('\n  - ')}`); };
  const total = sprites.reduce((n, s) => n + Object.keys(s.variants).length, 0);
  console.log(`\nSeason ${season}: ${cards.length} entries on fortnite.gg -> ${sprites.length} sprites, ${total} tracked variants.`);
  list('New sprites', report.newSprites);
  list('New variants of existing sprites', report.newVariants);
  list('New quality types (shown with a generic style; add colours/perk text in app.js)', report.extras);
  list('Rarity changes', report.rarityChanges);
  list('Renamed on fortnite.gg (our slug kept so progress stays linked)', report.renamedUpstream);
  list('No longer listed on fortnite.gg (kept in the tracker)', report.kept);
  list(DRY ? 'Icons to download' : 'Icons downloaded', report.images);
  list('Warnings', report.warnings);

  if (DRY) { console.log('\nDry run: nothing written.'); return; }
  fs.writeFileSync(DATA_FILE, out);
  console.log(`\nWrote ${path.relative(process.cwd(), DATA_FILE) || DATA_FILE}.`);
}

main().catch(err => { console.error(`\nUpdate failed: ${err.message}`); process.exit(1); });
