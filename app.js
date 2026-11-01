(() => {
  // ---------- qualities ----------
  // Every quality any season uses, in column order. A season shows only the ones its sprites have.
  // perk: the bonus (also used in card tooltips). detail: extra context for the info pop-up.
  const QUALITIES = [
    { key: 'normal', label: 'Normal', perk: null,
      bonus: 'The standard Sprite, with no extra bonus.',
      detail: 'Its only power is the Sprite\'s own ability (shown on each row), which gets stronger with every Level Up.' },
    { key: 'gold', label: 'Gold', perk: 'Gain bonus Sprite XP from eliminations (3x in Season 4).',
      detail: 'Levels up much faster when you get eliminations, which makes it the quickest to master.' },
    { key: 'fortune', label: 'Fortune', perk: 'Reveals nearby Chests.',
      detail: 'A Treasure Hunters quality. Great for finding loot (and more Sprite Chests) faster.' },
    { key: 'cursed', label: 'Cursed', perk: 'Higher chance of finding rare Sprite variants, but water damages you.',
      detail: 'A Treasure Hunters quality. Stay out of the water while it is equipped.' },
    { key: 'cheatmaster', label: 'Cheat Master', perk: 'Button mash! All inputs are correct when entering cheat codes found in the world.',
      detail: 'Any input opens the cheat code arrows hidden around the island, and those give you a random Sprite.' },
    { key: 'loothacker', label: 'Loot Hacker', perk: 'Increases chances of spawning items from your Loot Hacks.',
      detail: 'Loot Hacks are the items you add to your personal loot pool with Sprite Dust in the lobby\'s Override tab.' },
    { key: 'bountyhunter', label: 'Bounty Hunter', perk: 'Chance to find Sprites when eliminating opponents.',
      detail: 'Catch: it only earns Sprite XP from eliminations (unless the Sprite has its own special XP rules).' },
    { key: 'trickortreat', label: 'Trick or Treat', perk: 'Chance to find Halloween candy when opening containers.',
      detail: 'A limited Fortnitemares variant. Look for it in Pumpkin Chests, rare chests and vaults, or from cheat codes.' },
    { key: 'quack', label: 'Quack', perk: 'Gives 50% of the Sprite XP it earns to the other Sprites in your inventory.',
      detail: 'Great for levelling several Sprites at once. Only a few Sprites have one.' },
  ];
  // Qualities tools/update-data.js found after this list was written get a generic look and text.
  const genericQuality = (key, label) => ({
    key, label, extra: true,
    perk: `A new ${label} quality added during the season.`,
    detail: 'Its exact bonus isn\'t documented in SpriteMaxing yet. Check the in-game Sprite details.',
  });
  // CSS classes for a quality; unknown (extra) ones share the generic .v-extra colour.
  const vClass = v => (v.extra ? `v-${v.key} v-extra` : `v-${v.key}`);

  // Highest rarity first; used for the row order and the rarity filter chips.
  const RARITIES = ['mythic', 'legendary', 'epic', 'rare'];

  const STATUSES = [
    { value: 0, key: 'missing',  label: 'To be found', short: '?' },
    { value: 1, key: 'indexed',  label: 'Indexed',     short: '✓' },
    { value: 2, key: 'mastered', label: 'Mastered',    short: '★' },
  ];

  // ---------- seasons ----------
  // Each data/<id>.js file registers one season. Progress is stored per season; Season 4 keeps the
  // key it always had (spritesmaxing.c7s4.v1). Old share links and backups had no season: Season 4.
  const LEGACY_SEASON = 'c7s4';
  const storageKeyFor = id => `spritesmaxing.${id}.v1`;
  const rarityRank = r => (RARITIES.includes(r) ? RARITIES.indexOf(r) : RARITIES.length);

  function prepareSeason(raw) {
    const present = new Set(raw.sprites.flatMap(s => Object.keys(s.variants)));
    const variants = QUALITIES.filter(q => present.has(q.key));
    for (const x of raw.extras || []) {
      if (!variants.some(v => v.key === x.key)) variants.push(genericQuality(x.key, x.label));
    }
    for (const key of present) {
      if (!variants.some(v => v.key === key)) variants.push(genericQuality(key, key[0].toUpperCase() + key.slice(1)));
    }
    // In-game numbered order when we have it, otherwise rarest first, then by name.
    const sprites = raw.sprites.slice().sort((a, b) =>
      (a.order ?? Infinity) - (b.order ?? Infinity) || rarityRank(a.rarity) - rarityRank(b.rarity) || a.name.localeCompare(b.name));
    const ids = raw.ids || {};
    return {
      ...raw, variants, sprites, ids,
      allSlugs: sprites.flatMap(s => Object.values(s.variants)),
      idToSlug: Object.fromEntries(Object.entries(ids).map(([slug, id]) => [id, slug])),
      missing: new Set(raw.missingIcons || []),
      storageKey: storageKeyFor(raw.id),
    };
  }
  const SEASONS = (window.SPRITE_SEASONS || []).map(prepareSeason).sort((a, b) => b.order - a.order); // newest first
  const seasonById = id => SEASONS.find(s => s.id === id);
  const legacySeasonId = name => (seasonById(String(name || '').toLowerCase()) ? String(name).toLowerCase() : LEGACY_SEASON);

  // ---------- share links ----------
  // Format: #share=1.<base64url>&s=<season>&by=<name>. Two bits per permanent sprite ID (0 = to be
  // found, 1 = indexed, 2 = mastered), so links keep working when new sprites are added later.
  const SHARE_VERSION = '1';

  function toBase64Url(bytes) {
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  function encodeShare(p, s) {
    const entries = Object.entries(p)
      .map(([slug, st]) => [s.ids[slug], st])
      .filter(([id, st]) => id != null && (st === 1 || st === 2));
    const maxId = entries.reduce((m, [id]) => Math.max(m, id), -1);
    const bytes = new Uint8Array(Math.ceil((maxId + 1) / 4));
    for (const [id, st] of entries) bytes[id >> 2] |= st << ((id & 3) * 2);
    return `${SHARE_VERSION}.${toBase64Url(bytes)}`;
  }
  function decodeShare(code, s) {
    const [version, data = ''] = code.split('.');
    if (version !== SHARE_VERSION) throw new Error('version');
    if (!/^[A-Za-z0-9_-]*$/.test(data)) throw new Error('format');
    const out = {};
    fromBase64Url(data).forEach((b, i) => {
      for (let k = 0; k < 4; k++) {
        const st = (b >> (k * 2)) & 3;
        const slug = s.idToSlug[i * 4 + k];
        if (slug && (st === 1 || st === 2)) out[slug] = st;
      }
    });
    return out;
  }
  // Returns { seasonId, progress, by } when opened from a share link, { error } if broken, else null.
  function readShareFromUrl() {
    const params = new URLSearchParams(location.hash.slice(1));
    const code = params.get('share');
    if (!code) return null;
    const s = seasonById(params.get('s') || LEGACY_SEASON);
    if (!s) return { error: true };
    try {
      return { seasonId: s.id, progress: decodeShare(code, s), by: (params.get('by') || '').trim().slice(0, 24) };
    } catch {
      return { error: true };
    }
  }

  // ---------- state ----------
  // While viewing someone's shared link, `progress` holds THEIR statuses and nothing is ever saved,
  // so the visitor's own tracked progress in localStorage is never touched.
  const shared = readShareFromUrl();
  const viewing = !!(shared && !shared.error);
  const ownProgress = {}; // season id -> progress object, loaded lazily from localStorage
  let season = null;      // the season shown now (prepared)
  let progress = {};      // that season's statuses: slug -> 1 (indexed) | 2 (mastered)
  const filters = { q: '', rarity: new Set(), status: 'all' };

  function load(id) {
    try {
      const raw = localStorage.getItem(storageKeyFor(id));
      const data = raw ? JSON.parse(raw) : {};
      return typeof data === 'object' && data ? data : {};
    } catch { return {}; }
  }
  const progressFor = id => (ownProgress[id] ||= load(id));
  function save(id = season.id) {
    if (viewing) return; // read-only: never overwrite the visitor's own progress
    try {
      localStorage.setItem(storageKeyFor(id), JSON.stringify(progressFor(id)));
      requestPersistence();
    } catch {
      showStorageWarning();
      toast('Could not save. This browser is blocking saved data for this site.');
    }
  }

  // ---------- keeping progress across restarts ----------
  // Progress lives in this browser's localStorage, which survives restarts in a normal window.
  // Browsers may still evict site data under disk pressure unless it is marked persistent, so ask
  // once, after the first real save (Chrome/Edge decide silently; Firefox may show a prompt).
  let persistenceRequested = false;
  function requestPersistence() {
    if (persistenceRequested || !navigator.storage || !navigator.storage.persist) return;
    persistenceRequested = true;
    navigator.storage.persisted()
      .then(already => already || navigator.storage.persist())
      .catch(() => {});
  }
  // A write/read round trip: fails when storage is disabled (strict privacy settings, some embedded browsers).
  function storageWorks() {
    try {
      const k = '__spritemaxing_test';
      localStorage.setItem(k, '1');
      const ok = localStorage.getItem(k) === '1';
      localStorage.removeItem(k);
      return ok;
    } catch { return false; }
  }
  function showStorageWarning() {
    const w = document.getElementById('storageWarn');
    if (w && !viewing) w.hidden = false;
  }
  const statusOf = slug => progress[slug] || 0;
  function setStatus(slug, value) {
    if (viewing) return;
    if (value) progress[slug] = value; else delete progress[slug];
    save();
  }

  // ---------- helpers ----------
  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const cap = s => s[0].toUpperCase() + s.slice(1);
  function displayName(sprite, variant) {
    return variant.key === 'normal' ? `${sprite.name} Sprite` : `${variant.label} ${sprite.name} Sprite`;
  }
  // Two-letter monogram for placeholder art: initials of two words, else the first two letters.
  function monogram(name) {
    const words = name.replace(/['’]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  }
  // Icon for a variant, or placeholder art when the icon hasn't been datamined yet.
  function spriteArt(sprite, slug, alt, lazy = true) {
    if (season.missing.has(slug)) {
      const ph = el('span', 'ph');
      ph.setAttribute('role', 'img');
      ph.setAttribute('aria-label', `${alt} (art not available yet)`);
      ph.append(el('span', 'ph-mono', monogram(sprite.name)), el('span', 'ph-note', 'Art soon'));
      return ph;
    }
    const img = el('img');
    img.src = `img/${slug}.webp`;
    img.alt = alt;
    if (lazy) { img.loading = 'lazy'; img.decoding = 'async'; }
    img.width = 256; img.height = 256;
    return img;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- build ----------
  function buildHead() {
    const tr = el('tr');
    tr.append(el('th', 'col-sprite', 'Sprite'));
    for (const v of season.variants) {
      const th = el('th', `col-variant ${vClass(v)}`);
      th.dataset.variant = v.key;
      const top = el('span', 'v-top');
      const info = el('button', 'v-info-btn', 'i');
      info.type = 'button';
      info.title = `What does ${v.label} do?`;
      info.setAttribute('aria-label', `About the ${v.label} quality`);
      info.setAttribute('aria-haspopup', 'dialog');
      info.addEventListener('click', () => openInfo(v.key));
      top.append(el('span', 'v-dot'), el('span', 'v-label', v.label), info);
      th.append(top, el('span', 'v-count'));
      tr.append(th);
    }
    $('#gridHead').replaceChildren(tr);
  }

  // ---------- quality info pop-up ----------
  const SAMPLE_ORDER = ['jonesy', 'klombo', 'sonic', 'crown', 'bush', 'spooky-dash', 'adventure'];
  function openInfo(key) {
    const VARIANTS = season.variants;
    const i = VARIANTS.findIndex(v => v.key === key);
    const v = VARIANTS[i];
    const dlg = $('#infoDialog');
    const withIt = season.sprites.filter(s => s.variants[v.key]);
    // Prefer well-known sprites that already have art, then any with art, then placeholders.
    const hasArt = s => !season.missing.has(s.variants[v.key]);
    const preferred = SAMPLE_ORDER.map(id => withIt.find(s => s.id === id)).filter(Boolean);
    const samples = [...new Set([...preferred.filter(hasArt), ...withIt.filter(hasArt), ...withIt])].slice(0, 3);

    dlg.className = `info-dialog ${vClass(v)}`;
    const body = $('#infoBody');
    body.innerHTML = '';

    const head = el('div', 'info-head');
    const titleWrap = el('div');
    const title = el('h2', 'info-title', v.label);
    title.id = 'infoTitle';
    titleWrap.append(el('span', 'info-kicker', v.perk ? 'Sprite quality' : 'Base quality'), title);
    head.append(titleWrap);
    body.append(head);

    const art = el('div', 'info-art');
    for (const s of samples) {
      const node = spriteArt(s, s.variants[v.key], displayName(s, v), false);
      node.title = displayName(s, v);
      art.append(node);
    }
    body.append(art);

    const bonus = el('div', 'info-bonus');
    bonus.append(el('span', 'info-tag', v.perk ? 'Bonus' : 'Base'), el('p', null, v.perk || v.bonus));
    body.append(bonus);
    if (v.detail) body.append(el('p', 'info-detail', v.detail));
    if (v.perk) body.append(el('p', 'info-plus', '+ Keeps the Sprite\'s normal ability on top of this bonus.'));
    body.append(el('p', 'info-count', `${withIt.length} of ${season.sprites.length} Sprites come in ${v.label} in ${season.label}.`));

    const prev = VARIANTS[(i - 1 + VARIANTS.length) % VARIANTS.length];
    const next = VARIANTS[(i + 1) % VARIANTS.length];
    $('#infoPrev').textContent = '← ' + prev.label;
    $('#infoPrev').onclick = () => openInfo(prev.key);
    $('#infoNext').textContent = next.label + ' →';
    $('#infoNext').onclick = () => openInfo(next.key);

    if (!dlg.open) dlg.showModal();
  }
  $('#infoClose').addEventListener('click', () => $('#infoDialog').close());
  // Clicking the dimmed backdrop (the dialog element itself, outside its panel) closes it.
  $('#infoDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  try { localStorage.removeItem('spritesmaxing.openBonuses'); } catch {} // left over from the old collapsible headers

  function buildBody() {
    const body = $('#gridBody');
    body.replaceChildren();
    for (const s of season.sprites) {
      const rarity = s.rarity || 'unknown';
      const tr = el('tr', `row r-${rarity}`);
      tr.dataset.id = s.id;

      const th = el('th', 'row-head');
      th.scope = 'row';
      const name = el('div', 'row-name', s.name);
      if (s.isNew) name.append(el('span', 'new-tag', 'New'));
      const meta = el('div', 'row-meta');
      if (s.rarity) meta.append(el('span', `rarity-badge rb-${s.rarity}`, cap(s.rarity)));
      meta.append(el('span', 'row-count'));
      const ability = el('p', 'row-ability', (s.ability || []).join(' '));
      th.append(name, meta, ability);
      tr.append(th);

      for (const v of season.variants) {
        const td = el('td', 'cell');
        const slug = s.variants[v.key];
        if (!slug) {
          td.classList.add('cell-na');
          td.append(el('div', 'card card-na', '—'));
          td.title = `${s.name} has no ${v.label} variant in ${season.label}.`;
        } else {
          td.append(buildCard(s, v, slug));
        }
        tr.append(td);
      }
      body.append(tr);
    }
  }

  function buildCard(sprite, variant, slug) {
    const card = el('div', `card ${vClass(variant)} rc-${sprite.rarity || 'unknown'}`);
    card.dataset.slug = slug;

    const art = el('button', 'card-art');
    art.type = 'button';
    const full = displayName(sprite, variant);
    art.setAttribute('aria-label', `${full}: cycle status`);
    art.title = [full, variant.perk, (sprite.ability || []).join(' ')].filter(Boolean).join('\n\n');
    art.append(spriteArt(sprite, slug, full), el('span', 'badge'));
    if (viewing) art.setAttribute('aria-disabled', 'true');
    art.addEventListener('click', () => {
      if (viewing) return;
      setStatus(slug, (statusOf(slug) + 1) % STATUSES.length);
      refreshCard(card);
      refreshCounts();
      if (filters.status !== 'all') applyFilters();
    });

    const seg = el('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', `${full} status`);
    for (const st of STATUSES) {
      const b = el('button', `seg-btn s-${st.key}`, st.short);
      b.type = 'button';
      b.title = st.label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', st.label);
      b.addEventListener('click', () => {
        if (viewing) return;
        setStatus(slug, st.value);
        refreshCard(card);
        refreshCounts();
        if (filters.status !== 'all') applyFilters();
      });
      seg.append(b);
    }

    card.append(art, el('div', 'card-status'), seg);
    refreshCard(card);
    return card;
  }

  function refreshCard(card) {
    const st = STATUSES[statusOf(card.dataset.slug)];
    card.dataset.status = st.key;
    card.querySelector('.card-status').textContent = st.label;
    card.querySelector('.badge').textContent = st.value ? st.short : '';
    card.querySelectorAll('.seg-btn').forEach((b, i) => b.setAttribute('aria-checked', String(i === st.value)));
  }

  // ---------- counts ----------
  function refreshCounts() {
    const allSlugs = season.allSlugs;
    const total = allSlugs.length;
    let indexed = 0, mastered = 0;
    for (const slug of allSlugs) {
      const s = statusOf(slug);
      if (s >= 1) indexed++;
      if (s === 2) mastered++;
    }
    const pct = n => total ? Math.round((n / total) * 100) : 0;
    $('#totals').innerHTML = '';
    for (const [label, n, cls] of [['Indexed', indexed, 'indexed'], ['Mastered', mastered, 'mastered']]) {
      const box = el('div', `total total-${cls}`);
      const top = el('div', 'total-top');
      top.append(el('span', 'total-label', label), el('span', 'total-num', `${n} / ${total}`));
      const bar = el('div', 'bar');
      const fill = el('span');
      fill.style.width = pct(n) + '%';
      bar.append(fill);
      box.append(top, bar, el('span', 'total-pct', pct(n) + '%'));
      $('#totals').append(box);
    }

    // per-variant column counts
    for (const v of season.variants) {
      const slugs = season.sprites.map(s => s.variants[v.key]).filter(Boolean);
      const idx = slugs.filter(sl => statusOf(sl) >= 1).length;
      const th = document.querySelector(`th[data-variant="${v.key}"] .v-count`);
      if (th) th.textContent = `${idx}/${slugs.length}`;
    }
    // per-row counts
    for (const s of season.sprites) {
      const slugs = Object.values(s.variants);
      const idx = slugs.filter(sl => statusOf(sl) >= 1).length;
      const mas = slugs.filter(sl => statusOf(sl) === 2).length;
      const row = document.querySelector(`tr[data-id="${CSS.escape(s.id)}"]`);
      row.querySelector('.row-count').textContent = `${idx}/${slugs.length} indexed · ${mas} ★`;
      row.classList.toggle('row-complete', mas === slugs.length);
    }
  }

  // ---------- filters ----------
  // Rarity chips depend on the season (a brand-new season may not have rarities yet).
  function buildRarityChips() {
    const rc = $('#rarityChips');
    rc.replaceChildren();
    filters.rarity.clear();
    const present = RARITIES.filter(r => season.sprites.some(s => s.rarity === r));
    rc.hidden = !present.length;
    for (const r of present) {
      const b = el('button', `chip chip-${r}`, cap(r));
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        filters.rarity.has(r) ? filters.rarity.delete(r) : filters.rarity.add(r);
        b.setAttribute('aria-pressed', String(filters.rarity.has(r)));
        applyFilters();
      });
      rc.append(b);
    }
  }
  function buildFilters() {
    const sc = $('#statusChips');
    const opts = [{ key: 'all', label: 'All' }, ...STATUSES.map(s => ({ key: s.key, label: s.label }))];
    for (const o of opts) {
      const b = el('button', `chip chip-status s-${o.key}`, o.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(o.key === filters.status));
      b.addEventListener('click', () => {
        filters.status = o.key;
        sc.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        applyFilters();
      });
      sc.append(b);
    }
    $('#search').addEventListener('input', e => { filters.q = e.target.value.trim().toLowerCase(); applyFilters(); });
  }

  function applyFilters() {
    let visibleRows = 0;
    for (const s of season.sprites) {
      const row = document.querySelector(`tr[data-id="${CSS.escape(s.id)}"]`);
      const rarityOk = !filters.rarity.size || filters.rarity.has(s.rarity);
      const qOk = !filters.q || s.name.toLowerCase().includes(filters.q) ||
        season.variants.some(v => s.variants[v.key] && displayName(s, v).toLowerCase().includes(filters.q));
      let anyCard = false;
      row.querySelectorAll('.card[data-slug]').forEach(card => {
        const match = filters.status === 'all' || card.dataset.status === filters.status;
        card.classList.toggle('dim', !match);
        if (match) anyCard = true;
      });
      const show = rarityOk && qOk && anyCard;
      row.hidden = !show;
      if (show) visibleRows++;
    }
    $('#empty').hidden = visibleRows > 0;
  }

  // ---------- seasons: tabs & switching ----------
  function buildSeasonTabs() {
    const nav = $('#seasonTabs');
    nav.replaceChildren();
    nav.hidden = viewing || SEASONS.length < 2;
    SEASONS.forEach((s, i) => {
      const b = el('button', 'season-tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.season = s.id;
      b.append(el('span', 'season-tab-label', s.label), el('span', 'season-tab-name', s.name));
      if (i === 0) b.append(el('span', 'new-tag', 'New'));
      b.addEventListener('click', () => switchSeason(s.id));
      nav.append(b);
    });
  }

  function switchSeason(id) {
    const next = seasonById(id) || SEASONS[0];
    if (season && season.id === next.id) return;
    season = next;
    progress = viewing ? shared.progress : progressFor(season.id);
    document.querySelectorAll('.season-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.season === season.id)));
    // A season whose art hasn't been datamined yet gets a short explanation above the grid.
    const note = $('#seasonNote');
    note.hidden = !season.missing.size;
    if (season.missing.size) {
      note.textContent = `${season.label} just dropped. Art for its sprites isn't datamined yet, so they show placeholders. ` +
        'Real icons (and new qualities like Gold) are added in the next data update, and your progress is kept.';
    }
    buildHead();
    buildBody();
    buildRarityChips();
    refreshCounts();
    applyFilters();
  }

  // ---------- backup / restore / reset ----------
  // Backup format 3: every season with progress, as seasons[id] = { progress, ids }. `ids` maps each slug
  // to its permanent sprite ID, so restore can fall back to the ID when a slug has changed.
  // Formats 1-2 (single season, before seasons existed) restore into Season 4.
  function exportProgress() {
    const seasons = {};
    for (const s of SEASONS) {
      const p = progressFor(s.id);
      if (!Object.keys(p).length) continue;
      const ids = {};
      for (const slug of Object.keys(p)) if (s.ids[slug] != null) ids[slug] = s.ids[slug];
      seasons[s.id] = { progress: p, ids };
    }
    const backup = { app: 'SpriteMaxing', format: 3, exported: new Date().toISOString(), seasons };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `spritemaxing-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Clean one season's entries from a file: keep known slugs (or ID matches), count the rest as skipped.
  function cleanEntries(s, incoming, fileIds) {
    const meta = new Set(['app', 'format', 'season', 'exported', 'progress', 'ids', 'seasons']);
    const known = new Set(s.allSlugs);
    const clean = {};
    let skipped = 0;
    for (const [slug, raw] of Object.entries(incoming || {})) {
      if (meta.has(slug)) continue;
      const v = Number(raw);
      if (v !== 1 && v !== 2) continue;
      // Same name as today, or the same sprite under a newer/older name (matched by permanent ID).
      const target = known.has(slug) ? slug : s.idToSlug[fileIds[slug]];
      if (target && known.has(target)) clean[target] = v;
      else skipped++;
    }
    return { clean, skipped };
  }

  // Reads a backup file, then asks before replacing progress for the seasons it contains.
  function importProgress(file) {
    if (viewing) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); } catch { data = null; }
      if (!data || typeof data !== 'object') { toast(`"${file.name}" is not a SpriteMaxing backup.`); return; }

      // season id -> { incoming, fileIds }
      const parts = {};
      if (data.seasons && typeof data.seasons === 'object') {
        for (const [id, entry] of Object.entries(data.seasons)) {
          if (entry && typeof entry === 'object') parts[id] = { incoming: entry.progress, fileIds: entry.ids || {} };
        }
      } else {
        const incoming = data.progress && typeof data.progress === 'object' ? data.progress : data;
        parts[legacySeasonId(data.season)] = { incoming, fileIds: data.ids && typeof data.ids === 'object' ? data.ids : {} };
      }

      const result = []; // [{ season, clean }]
      let skipped = 0;
      for (const [id, { incoming, fileIds }] of Object.entries(parts)) {
        const s = seasonById(id);
        if (!s) { skipped += Object.keys(incoming || {}).length; continue; }
        const r = cleanEntries(s, incoming, fileIds);
        skipped += r.skipped;
        result.push({ season: s, clean: r.clean });
      }
      const anyEntries = result.some(r => Object.keys(r.clean).length);
      if (!result.length || (!anyEntries && !/^Sprites?Maxing$/.test(data.app || ''))) {
        toast(`"${file.name}" is not a SpriteMaxing backup.`);
        return;
      }

      const body = el('div');
      const exported = data.exported ? new Date(data.exported) : null;
      const when = exported && !isNaN(exported)
        ? ` (saved ${exported.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })})`
        : '';
      const names = result.map(r => r.season.label).join(' and ');
      body.append(el('p', 'info-detail', `Restoring "${file.name}"${when} will replace your ${names} progress.`));
      for (const r of result) {
        if (result.length > 1) body.append(el('p', 'compare-season', r.season.label));
        body.append(compareStats(r.season, progressFor(r.season.id), r.clean));
      }
      if (skipped) {
        body.append(el('p', 'info-count',
          `${skipped} ${skipped === 1 ? 'entry' : 'entries'} in the file didn't match a current sprite and will be skipped.`));
      }

      const ok = await confirmAction({
        kicker: 'Restore backup', title: 'Replace progress?', body,
        confirmLabel: 'Restore', tone: 'primary',
      });
      if (!ok) { toast('Restore cancelled.'); return; }
      let restored = 0;
      for (const r of result) {
        ownProgress[r.season.id] = r.clean;
        save(r.season.id);
        restored += Object.keys(r.clean).length;
      }
      progress = progressFor(season.id);
      rerenderAll();
      toast(`Restored ${restored} tracked sprites.`);
    };
    reader.onerror = () => toast('Could not read that file.');
    reader.readAsText(file);
  }

  function statsOf(s, p) {
    const vals = s.allSlugs.map(slug => p[slug]).filter(Boolean);
    return { indexed: vals.filter(v => v >= 1).length, mastered: vals.filter(v => v === 2).length };
  }
  // Two small stat boxes: what you have now vs. what the file contains.
  function compareStats(s, now, next) {
    const wrap = el('div', 'compare');
    for (const [label, p] of [['Current', now], ['From file', next]]) {
      const st = statsOf(s, p);
      const box = el('div', 'compare-box');
      box.append(
        el('span', 'compare-label', label),
        el('span', 'compare-stat s-indexed', `${st.indexed} indexed`),
        el('span', 'compare-stat s-mastered', `${st.mastered} mastered`),
      );
      wrap.append(box);
    }
    return wrap;
  }

  function rerenderAll() {
    document.querySelectorAll('.card[data-slug]').forEach(refreshCard);
    refreshCounts();
    applyFilters();
  }

  // ---------- confirmation dialog ----------
  // In-app replacement for window.confirm(), which some embedded/mobile browsers silently block.
  const confirmDlg = $('#confirmDialog');
  let confirmResolve = null;
  function confirmAction({ kicker, title, body, confirmLabel, tone = 'danger', disabled = false }) {
    settleConfirm(false);
    confirmDlg.className = `info-dialog confirm-dialog tone-${tone}`;
    $('#confirmKicker').textContent = kicker;
    $('#confirmTitle').textContent = title;
    const holder = $('#confirmBody');
    holder.innerHTML = '';
    holder.append(typeof body === 'string' ? el('p', 'info-detail', body) : body);
    const ok = $('#confirmOk');
    ok.textContent = confirmLabel;
    ok.className = `btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}`;
    ok.disabled = disabled;
    confirmDlg.showModal();
    (disabled ? confirmDlg.querySelector('.info-nav [data-close]') : ok).focus();
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  function settleConfirm(result) {
    if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(result); }
    if (confirmDlg.open) confirmDlg.close();
  }
  $('#confirmOk').addEventListener('click', () => settleConfirm(true));
  confirmDlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => settleConfirm(false)));
  confirmDlg.addEventListener('click', e => { if (e.target === confirmDlg) settleConfirm(false); });
  confirmDlg.addEventListener('close', () => settleConfirm(false)); // Esc key

  $('#backupBtn').addEventListener('click', exportProgress);
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importProgress(e.target.files[0]); e.target.value = ''; });
  $('#resetBtn').addEventListener('click', async () => {
    if (viewing) return;
    const tracked = statsOf(season, progress).indexed;
    const ok = await confirmAction({
      kicker: 'Careful', title: `Reset ${season.label}?`,
      body: tracked
        ? `This clears ${tracked} tracked ${season.label} sprite${tracked === 1 ? '' : 's'}. Other seasons are not affected. It can't be undone, so make a Backup first if you might want them back.`
        : `Nothing is tracked in ${season.label} yet, so there is nothing to reset.`,
      confirmLabel: `Reset ${season.label}`, tone: 'danger', disabled: !tracked,
    });
    if (!ok) return;
    ownProgress[season.id] = {};
    progress = ownProgress[season.id];
    save();
    rerenderAll();
    toast(`${season.label} progress reset.`);
  });

  // ---------- sharing ----------
  const NAME_KEY = 'spritemaxing.shareName';
  const shareDlg = $('#shareDialog');
  const baseUrl = () => location.href.split('#')[0];

  function buildShareLink() {
    const name = $('#shareName').value.trim().slice(0, 24);
    const params = new URLSearchParams({ share: encodeShare(progress, season), s: season.id });
    if (name) params.set('by', name);
    $('#shareLink').value = `${baseUrl()}#${params}`;
    try { localStorage.setItem(NAME_KEY, name); } catch {}
  }
  $('#shareBtn').addEventListener('click', () => {
    try { $('#shareName').value = localStorage.getItem(NAME_KEY) || ''; } catch {}
    const s = statsOf(season, progress);
    $('#shareStats').textContent =
      `Includes your ${s.indexed} indexed and ${s.mastered} mastered ${season.label} sprites. It's a snapshot, so make a new link after you track more.`;
    $('#shareWarn').hidden = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && location.protocol !== 'file:';
    // Sprites without a permanent ID (a brand-new season before its data update) can't go in a link yet.
    const tracked = Object.keys(progress).filter(slug => season.allSlugs.includes(slug));
    const noId = tracked.filter(slug => season.ids[slug] == null).length;
    const idNote = $('#shareIdNote');
    idNote.hidden = !noId;
    idNote.textContent = noId === tracked.length
      ? `${season.label} sprites can't be shared yet: their permanent IDs arrive with the next data update. Share links work again after that.`
      : `${noId} of your ${season.label} sprites aren't in the link yet: their permanent IDs arrive with the next data update.`;
    $('#shareCopy').disabled = !!noId && noId === tracked.length;
    $('#shareCopy').textContent = 'Copy';
    buildShareLink();
    shareDlg.showModal();
  });
  $('#shareName').addEventListener('input', () => { buildShareLink(); $('#shareCopy').textContent = 'Copy'; });
  $('#shareLink').addEventListener('focus', e => e.target.select());
  $('#shareCopy').addEventListener('click', async () => {
    const link = $('#shareLink');
    try { await navigator.clipboard.writeText(link.value); }
    catch { link.select(); document.execCommand('copy'); }
    $('#shareCopy').textContent = 'Copied ✓';
    toast('Share link copied.');
  });
  shareDlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => shareDlg.close()));
  shareDlg.addEventListener('click', e => { if (e.target === shareDlg) shareDlg.close(); });

  function leaveSharedView() {
    history.replaceState(null, '', baseUrl());
    location.reload();
  }
  if (viewing) {
    document.body.classList.add('viewing');
    const s = seasonById(shared.seasonId);
    const who = shared.by ? `${shared.by}'s collection` : 'A shared collection';
    $('#viewWho').textContent = `${who} · ${s.label}`;
    $('#viewBanner').hidden = false;
    document.title = `${who} · SpriteMaxing`;
    $('#viewExit').addEventListener('click', leaveSharedView);
  } else if (shared && shared.error) {
    history.replaceState(null, '', baseUrl());
    setTimeout(() => toast('That share link is broken or from a newer version of SpriteMaxing.'), 300);
  }
  // Pasting a different share link into the address bar of an open tab: start over cleanly.
  window.addEventListener('hashchange', () => location.reload());

  // ---------- storage checks & multi-tab sync ----------
  if (!viewing && !storageWorks()) showStorageWarning();
  // Another tab saved: adopt its progress so this tab's next save can't overwrite those changes.
  window.addEventListener('storage', e => {
    if (viewing) return;
    const s = SEASONS.find(x => x.storageKey === e.key);
    if (!s) return;
    ownProgress[s.id] = load(s.id);
    if (s.id === season.id) {
      progress = ownProgress[s.id];
      rerenderAll();
    }
  });

  // ---------- init ----------
  const syncToolbarHeight = () =>
    document.documentElement.style.setProperty('--toolbar-h', $('.toolbar').offsetHeight + 'px');
  window.addEventListener('resize', syncToolbarHeight);
  syncToolbarHeight();

  buildSeasonTabs();
  buildFilters();
  // Always open on the newest season, or on the season a share link is for.
  switchSeason(viewing ? shared.seasonId : SEASONS[0].id);

  // Shared with export.js (PNG/PDF collection export). Getters, so it always sees the current season.
  window.SpriteMaxing = {
    get season() { return season; },
    get sprites() { return season.sprites; },
    get VARIANTS() { return season.variants; },
    STATUSES, statusOf, toast,
    hasArt: slug => !season.missing.has(slug),
  };
})();
