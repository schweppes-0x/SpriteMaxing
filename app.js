(() => {
  const STORAGE_KEY = 'spritesmaxing.c7s4.v1';

  // perk: the variant's bonus (also used in card tooltips). detail: extra context shown in the header panel.
  const VARIANTS = [
    { key: 'normal', label: 'Normal', perk: null,
      bonus: 'The standard Sprite, with no extra bonus.',
      detail: 'Its only power is the Sprite\'s own ability (shown on each row), which gets stronger with every Level Up.' },
    { key: 'gold', label: 'Gold', perk: 'Gain 3x bonus Sprite XP from eliminations.',
      detail: 'Levels up much faster when you get eliminations, which makes it the quickest to master.' },
    { key: 'cheatmaster', label: 'Cheat Master', perk: 'Button mash! All inputs are correct when entering cheat codes found in the world.',
      detail: 'Any input opens the cheat code arrows hidden around the island, and those give you a random Sprite.' },
    { key: 'loothacker', label: 'Loot Hacker', perk: 'Increases chances of spawning items from your Loot Hacks.',
      detail: 'Loot Hacks are the items you add to your personal loot pool with Sprite Dust in the lobby\'s Override tab.' },
    { key: 'bountyhunter', label: 'Bounty Hunter', perk: 'Chance to find Sprites when eliminating opponents.',
      detail: 'Catch: it only earns Sprite XP from eliminations (unless the Sprite has its own special XP rules).' },
    { key: 'trickortreat', label: 'Trick or Treat', perk: 'Chance to find Halloween candy when opening containers.',
      detail: 'A limited Fortnitemares variant. Look for it in Pumpkin Chests, rare chests and vaults, or from cheat codes.' },
    { key: 'quack', label: 'Quack', perk: 'Gives 50% of the Sprite XP it earns to the other Sprites in your inventory.',
      detail: 'Great for levelling several Sprites at once. This season only Jonesy, Adventure, Bush, Klombo and Spooky Dash have one.' },
  ];

  // Highest rarity first; used for the row order and the rarity filter chips.
  const RARITIES = ['mythic', 'legendary', 'epic', 'rare'];

  const STATUSES = [
    { value: 0, key: 'missing',  label: 'To be found', short: '?' },
    { value: 1, key: 'indexed',  label: 'Indexed',     short: '✓' },
    { value: 2, key: 'mastered', label: 'Mastered',    short: '★' },
  ];

  const sprites = (window.SPRITES || []).slice().sort((a, b) =>
    RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || a.name.localeCompare(b.name));
  const allSlugs = sprites.flatMap(s => Object.values(s.variants));

  // ---------- share links ----------
  // Format: #share=1.<base64url>&by=<name>. Two bits per permanent sprite ID (0 = to be found,
  // 1 = indexed, 2 = mastered), so links keep working when new sprites are added later.
  const SHARE_VERSION = '1';
  const SPRITE_IDS = window.SPRITE_IDS || {};
  const ID_TO_SLUG = Object.fromEntries(Object.entries(SPRITE_IDS).map(([slug, id]) => [id, slug]));

  function toBase64Url(bytes) {
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  function encodeShare(p) {
    const entries = Object.entries(p)
      .map(([slug, st]) => [SPRITE_IDS[slug], st])
      .filter(([id, st]) => id != null && (st === 1 || st === 2));
    const maxId = entries.reduce((m, [id]) => Math.max(m, id), -1);
    const bytes = new Uint8Array(Math.ceil((maxId + 1) / 4));
    for (const [id, st] of entries) bytes[id >> 2] |= st << ((id & 3) * 2);
    return `${SHARE_VERSION}.${toBase64Url(bytes)}`;
  }
  function decodeShare(code) {
    const [version, data = ''] = code.split('.');
    if (version !== SHARE_VERSION) throw new Error('version');
    if (!/^[A-Za-z0-9_-]*$/.test(data)) throw new Error('format');
    const out = {};
    fromBase64Url(data).forEach((b, i) => {
      for (let k = 0; k < 4; k++) {
        const st = (b >> (k * 2)) & 3;
        const slug = ID_TO_SLUG[i * 4 + k];
        if (slug && (st === 1 || st === 2)) out[slug] = st;
      }
    });
    return out;
  }
  // Returns { progress, by } when the page was opened from a share link, otherwise null.
  function readShareFromUrl() {
    const params = new URLSearchParams(location.hash.slice(1));
    const code = params.get('share');
    if (!code) return null;
    try {
      return { progress: decodeShare(code), by: (params.get('by') || '').trim().slice(0, 24) };
    } catch {
      return { error: true };
    }
  }

  // ---------- state ----------
  // While viewing someone's shared link, `progress` holds THEIR statuses and nothing is ever saved,
  // so the visitor's own tracked progress in localStorage is never touched.
  const shared = readShareFromUrl();
  const viewing = !!(shared && !shared.error);
  let progress = viewing ? shared.progress : load();
  const filters = { q: '', rarity: new Set(), status: 'all' };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return typeof data === 'object' && data ? data : {};
    } catch { return {}; }
  }
  function save() {
    if (viewing) return; // read-only: never overwrite the visitor's own progress
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
    catch { toast('Could not save — browser storage is unavailable.'); }
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
    for (const v of VARIANTS) {
      const th = el('th', `col-variant v-${v.key}`);
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
    $('#gridHead').append(tr);
  }

  // ---------- quality info pop-up ----------
  const SAMPLE_ORDER = ['jonesy', 'klombo', 'sonic', 'crown', 'bush', 'spooky-dash', 'adventure'];
  function openInfo(key) {
    const i = VARIANTS.findIndex(v => v.key === key);
    const v = VARIANTS[i];
    const dlg = $('#infoDialog');
    const withIt = sprites.filter(s => s.variants[v.key]);
    const samples = SAMPLE_ORDER.map(id => sprites.find(s => s.id === id)).filter(s => s && s.variants[v.key]).slice(0, 3);

    dlg.className = `info-dialog v-${v.key}`;
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
      const img = el('img');
      img.src = `img/${s.variants[v.key]}.webp`;
      img.alt = displayName(s, v);
      img.title = displayName(s, v);
      art.append(img);
    }
    body.append(art);

    const bonus = el('div', 'info-bonus');
    bonus.append(el('span', 'info-tag', v.perk ? 'Bonus' : 'Base'), el('p', null, v.perk || v.bonus));
    body.append(bonus);
    if (v.detail) body.append(el('p', 'info-detail', v.detail));
    if (v.perk) body.append(el('p', 'info-plus', '+ Keeps the Sprite\'s normal ability on top of this bonus.'));
    body.append(el('p', 'info-count', `${withIt.length} of ${sprites.length} Sprites come in ${v.label} this season.`));

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
    for (const s of sprites) {
      const tr = el('tr', `row r-${s.rarity}`);
      tr.dataset.id = s.id;

      const th = el('th', 'row-head');
      th.scope = 'row';
      const name = el('div', 'row-name', s.name);
      if (s.isNew) name.append(el('span', 'new-tag', 'New'));
      const meta = el('div', 'row-meta');
      meta.append(el('span', `rarity-badge rb-${s.rarity}`, cap(s.rarity)), el('span', 'row-count'));
      const ability = el('p', 'row-ability', s.ability.join(' '));
      th.append(name, meta, ability);
      tr.append(th);

      for (const v of VARIANTS) {
        const td = el('td', 'cell');
        const slug = s.variants[v.key];
        if (!slug) {
          td.classList.add('cell-na');
          td.append(el('div', 'card card-na', '—'));
          td.title = `${s.name} has no ${v.label} variant this season.`;
        } else {
          td.append(buildCard(s, v, slug));
        }
        tr.append(td);
      }
      body.append(tr);
    }
  }

  function buildCard(sprite, variant, slug) {
    const card = el('div', `card v-${variant.key} rc-${sprite.rarity}`);
    card.dataset.slug = slug;

    const art = el('button', 'card-art');
    art.type = 'button';
    const full = displayName(sprite, variant);
    art.setAttribute('aria-label', `${full}: cycle status`);
    art.title = [full, variant.perk, sprite.ability.join(' ')].filter(Boolean).join('\n\n');
    const img = el('img');
    img.src = `img/${slug}.webp`;
    img.alt = full;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 256; img.height = 256;
    art.append(img, el('span', 'badge'));
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
    for (const v of VARIANTS) {
      const slugs = sprites.map(s => s.variants[v.key]).filter(Boolean);
      const idx = slugs.filter(sl => statusOf(sl) >= 1).length;
      const th = document.querySelector(`th[data-variant="${v.key}"] .v-count`);
      if (th) th.textContent = `${idx}/${slugs.length}`;
    }
    // per-row counts
    for (const s of sprites) {
      const slugs = Object.values(s.variants);
      const idx = slugs.filter(sl => statusOf(sl) >= 1).length;
      const mas = slugs.filter(sl => statusOf(sl) === 2).length;
      const row = document.querySelector(`tr[data-id="${s.id}"]`);
      row.querySelector('.row-count').textContent = `${idx}/${slugs.length} indexed · ${mas} ★`;
      row.classList.toggle('row-complete', mas === slugs.length);
    }
  }

  // ---------- filters ----------
  function buildFilters() {
    const rc = $('#rarityChips');
    for (const r of RARITIES) {
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
    for (const s of sprites) {
      const row = document.querySelector(`tr[data-id="${s.id}"]`);
      const rarityOk = !filters.rarity.size || filters.rarity.has(s.rarity);
      const qOk = !filters.q || s.name.toLowerCase().includes(filters.q) ||
        VARIANTS.some(v => s.variants[v.key] && displayName(s, v).toLowerCase().includes(filters.q));
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

  // ---------- import / export / reset ----------
  function exportProgress() {
    const blob = new Blob([JSON.stringify({ app: 'SpriteMaxing', season: 'C7S4', exported: new Date().toISOString(), progress }, null, 2)], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `spritemaxing-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // Reads a backup file, then asks before replacing the current progress.
  function importProgress(file) {
    if (viewing) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); } catch { data = null; }
      const incoming = data && typeof data === 'object'
        ? (data.progress && typeof data.progress === 'object' ? data.progress : data)
        : null;
      const known = new Set(allSlugs);
      const meta = new Set(['app', 'season', 'exported', 'progress']);
      const clean = {};
      let skipped = 0;
      if (incoming) {
        for (const [slug, raw] of Object.entries(incoming)) {
          const v = Number(raw);
          if (known.has(slug) && (v === 1 || v === 2)) clean[slug] = v;
          else if (!known.has(slug) && !meta.has(slug)) skipped++;
        }
      }
      const looksLikeBackup = incoming && (Object.keys(clean).length || /^Sprites?Maxing$/.test(data.app || ''));
      if (!looksLikeBackup) { toast(`"${file.name}" is not a SpriteMaxing backup.`); return; }

      const body = el('div');
      const exported = data.exported ? new Date(data.exported) : null;
      const when = exported && !isNaN(exported)
        ? ` (saved ${exported.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })})`
        : '';
      body.append(el('p', 'info-detail', `Restoring "${file.name}"${when} will replace your current progress.`));
      body.append(compareStats(progress, clean));
      if (skipped) {
        body.append(el('p', 'info-count',
          `${skipped} ${skipped === 1 ? 'entry' : 'entries'} in the file didn't match a current sprite and will be skipped.`));
      }

      const ok = await confirmAction({
        kicker: 'Restore backup', title: 'Replace progress?', body,
        confirmLabel: 'Restore', tone: 'primary',
      });
      if (!ok) { toast('Restore cancelled.'); return; }
      progress = clean;
      save();
      rerenderAll();
      toast(`Restored ${Object.keys(clean).length} tracked sprites.`);
    };
    reader.onerror = () => toast('Could not read that file.');
    reader.readAsText(file);
  }

  function statsOf(p) {
    const vals = Object.values(p);
    return { indexed: vals.filter(v => v >= 1).length, mastered: vals.filter(v => v === 2).length };
  }
  // Two small stat boxes: what you have now vs. what the file contains.
  function compareStats(now, next) {
    const wrap = el('div', 'compare');
    for (const [label, p] of [['Current', now], ['From file', next]]) {
      const s = statsOf(p);
      const box = el('div', 'compare-box');
      box.append(
        el('span', 'compare-label', label),
        el('span', 'compare-stat s-indexed', `${s.indexed} indexed`),
        el('span', 'compare-stat s-mastered', `${s.mastered} mastered`),
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
    const tracked = Object.keys(progress).length;
    const ok = await confirmAction({
      kicker: 'Careful', title: 'Reset progress?',
      body: tracked
        ? `This clears ${tracked} tracked sprite${tracked === 1 ? '' : 's'}. It can't be undone, so make a Backup first if you might want them back.`
        : 'Nothing is tracked yet, so there is nothing to reset.',
      confirmLabel: 'Reset everything', tone: 'danger', disabled: !tracked,
    });
    if (!ok) return;
    progress = {};
    save();
    rerenderAll();
    toast('Progress reset.');
  });

  // ---------- sharing ----------
  const NAME_KEY = 'spritemaxing.shareName';
  const shareDlg = $('#shareDialog');
  const baseUrl = () => location.href.split('#')[0];

  function buildShareLink() {
    const name = $('#shareName').value.trim().slice(0, 24);
    const params = new URLSearchParams({ share: encodeShare(progress) });
    if (name) params.set('by', name);
    $('#shareLink').value = `${baseUrl()}#${params}`;
    try { localStorage.setItem(NAME_KEY, name); } catch {}
  }
  $('#shareBtn').addEventListener('click', () => {
    try { $('#shareName').value = localStorage.getItem(NAME_KEY) || ''; } catch {}
    const s = statsOf(progress);
    $('#shareStats').textContent =
      `Includes your ${s.indexed} indexed and ${s.mastered} mastered sprites. It's a snapshot, so make a new link after you track more.`;
    $('#shareWarn').hidden = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && location.protocol !== 'file:';
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
    const who = shared.by ? `${shared.by}'s collection` : 'A shared collection';
    $('#viewWho').textContent = who;
    $('#viewBanner').hidden = false;
    document.title = `${who} · SpriteMaxing`;
    $('#viewExit').addEventListener('click', leaveSharedView);
  } else if (shared && shared.error) {
    history.replaceState(null, '', baseUrl());
    setTimeout(() => toast('That share link is broken or from a newer version of SpriteMaxing.'), 300);
  }
  // Pasting a different share link into the address bar of an open tab: start over cleanly.
  window.addEventListener('hashchange', () => location.reload());

  // ---------- init ----------
  const syncToolbarHeight = () =>
    document.documentElement.style.setProperty('--toolbar-h', $('.toolbar').offsetHeight + 'px');
  window.addEventListener('resize', syncToolbarHeight);
  syncToolbarHeight();

  buildHead();
  buildBody();
  buildFilters();
  refreshCounts();
  applyFilters();

  // Shared with export.js (PNG/PDF collection export).
  window.SpriteMaxing = { sprites, VARIANTS, STATUSES, statusOf, toast };
})();
