// Collection export: draws the tracker grid onto a canvas and saves it as a PNG or a multi-page A4 PDF.
// No dependencies: the PDF is assembled by hand from one JPEG per page.
(() => {
  const { sprites, VARIANTS, STATUSES, statusOf, toast } = window.SpriteMaxing;
  const $ = sel => document.querySelector(sel);
  const PREF_KEY = 'spritemaxing.exportPrefs';

  // Layout in CSS pixels. PDF pages are drawn at 2x; the PNG at 1.5x to keep the file shareable (~9 MB).
  const PDF_SCALE = 2, PNG_SCALE = 1.5;
  const PAD = 40, LABEL_W = 230, CELL_W = 132, CELL_H = 158, GAP = 10, IMG = 112;
  const TITLE_H = 120, COLHEAD_H = 46, FOOT_H = 34;
  const ROW_H = CELL_H + GAP;
  const MIN_W = 780;
  const A4_RATIO = 841.89 / 595.28;

  const keyOf = slug => STATUSES[statusOf(slug)].key;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function rgba(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  // ---------- what to export ----------
  // Keep the grid shape, but drop quality columns and sprite rows that end up with nothing in them.
  function selection(include) {
    const has = (s, v) => s.variants[v.key] && include.has(keyOf(s.variants[v.key]));
    const cols = VARIANTS.filter(v => sprites.some(s => has(s, v)));
    const rows = sprites.filter(s => cols.some(v => has(s, v)));
    const cards = rows.reduce((n, s) => n + cols.filter(v => has(s, v)).length, 0);
    return { include, cols, rows, cards, has };
  }

  const sheetWidth = sel => Math.max(MIN_W, PAD * 2 + LABEL_W + sel.cols.length * (CELL_W + GAP));

  function paginate(sel) {
    const pageH = Math.round(sheetWidth(sel) * A4_RATIO);
    const pages = [];
    for (let i = 0, first = true; i < sel.rows.length; first = false) {
      const room = pageH - PAD * 2 - (first ? TITLE_H : 0) - COLHEAD_H - FOOT_H;
      const n = Math.max(1, Math.floor((room + GAP) / ROW_H));
      pages.push(sel.rows.slice(i, i + n));
      i += n;
    }
    return pages;
  }

  // ---------- assets ----------
  const imgCache = new Map();
  function loadImg(src) {
    if (!imgCache.has(src)) {
      imgCache.set(src, new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      }));
    }
    return imgCache.get(src);
  }
  const loaded = new Map(); // src -> HTMLImageElement (or null if it failed), filled by prepare()
  async function prepare(sel) {
    const srcs = ['img/klombo.webp'];
    for (const s of sel.rows) for (const v of sel.cols) if (sel.has(s, v)) srcs.push(`img/${s.variants[v.key]}.webp`);
    const fonts = ['700 20px "Chakra Petch"', '600 12px "Space Grotesk"', '400 12px "Space Grotesk"']
      .map(f => document.fonts.load(f).catch(() => null));
    const imgs = await Promise.all(srcs.map(loadImg));
    srcs.forEach((src, i) => loaded.set(src, imgs[i]));
    await Promise.all(fonts);
  }

  // ---------- drawing ----------
  function theme() {
    return {
      bg: css('--bg'), bg2: css('--bg-2'), panel: css('--panel'), line: css('--line'),
      text: css('--text'), muted: css('--muted'), accent: css('--accent'),
      indexed: css('--indexed'), mastered: css('--mastered'),
      rarity: { rare: css('--rare'), epic: css('--epic'), legendary: css('--legendary'), mythic: css('--mythic') },
      variant: Object.fromEntries(VARIANTS.map(v => [v.key, css(`--v-${v.key}`)])),
    };
  }
  const DISPLAY = '"Chakra Petch", "Segoe UI", sans-serif';
  const BODY = '"Space Grotesk", "Segoe UI", sans-serif';

  function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

  function drawBackground(ctx, W, H, t) {
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, 700);
    g.addColorStop(0, rgba(t.indexed, 0.12)); g.addColorStop(1, rgba(t.indexed, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(W, 0, 0, W, 0, 600);
    g.addColorStop(0, rgba(t.accent, 0.14)); g.addColorStop(1, rgba(t.accent, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  function drawTitle(ctx, W, y, sel, t) {
    const logo = loaded.get('img/klombo.webp');
    if (logo) ctx.drawImage(logo, PAD - 6, y - 4, 72, 72);
    const x = PAD + 76;
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 38px ${DISPLAY}`;
    setSpacing(ctx, 0.5);
    ctx.fillStyle = t.text;
    ctx.fillText('SPRITE', x, y + 38);
    const w1 = ctx.measureText('SPRITE').width;
    const w2 = ctx.measureText('MAXING').width;
    const g = ctx.createLinearGradient(x + w1, 0, x + w1 + w2, 0);
    g.addColorStop(0, t.indexed); g.addColorStop(1, t.accent);
    ctx.fillStyle = g;
    ctx.fillText('MAXING', x + w1, y + 38);
    setSpacing(ctx, 0);

    ctx.font = `500 14px ${BODY}`;
    ctx.fillStyle = t.muted;
    ctx.fillText('Fortnite Chapter 7 · Season 4 Sprite collection', x, y + 62);
    const shown = STATUSES.filter(s => sel.include.has(s.key)).map(s => s.label).join(', ');
    ctx.font = `600 12px ${BODY}`;
    ctx.fillText(`Showing: ${shown}  ·  ${sel.cards} card${sel.cards === 1 ? '' : 's'}`, x, y + 84);

    // totals over the whole collection, right aligned
    const all = sprites.flatMap(s => Object.values(s.variants));
    const idx = all.filter(sl => statusOf(sl) >= 1).length;
    const mas = all.filter(sl => statusOf(sl) === 2).length;
    ctx.textAlign = 'right';
    ctx.font = `700 15px ${DISPLAY}`;
    setSpacing(ctx, 1);
    ctx.fillStyle = t.indexed;
    ctx.fillText(`INDEXED ${idx} / ${all.length}`, W - PAD, y + 28);
    ctx.fillStyle = t.mastered;
    ctx.fillText(`MASTERED ${mas} / ${all.length}`, W - PAD, y + 52);
    setSpacing(ctx, 0);
    ctx.font = `500 12px ${BODY}`;
    ctx.fillStyle = t.muted;
    ctx.fillText(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), W - PAD, y + 76);
    ctx.textAlign = 'left';
  }

  function cellX(x0, i) { return x0 + LABEL_W + GAP + i * (CELL_W + GAP); }

  function drawColHeads(ctx, x0, y, sel, t) {
    const h = COLHEAD_H - GAP;
    ctx.textBaseline = 'middle';
    const box = (x, w) => {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 10);
      ctx.fillStyle = t.bg2; ctx.fill();
      ctx.strokeStyle = t.line; ctx.lineWidth = 1; ctx.stroke();
    };
    box(x0, LABEL_W);
    ctx.font = `700 13px ${DISPLAY}`;
    setSpacing(ctx, 0.6);
    ctx.fillStyle = t.text;
    ctx.fillText('SPRITE', x0 + 14, y + h / 2 + 1);
    sel.cols.forEach((v, i) => {
      const x = cellX(x0, i);
      const vc = t.variant[v.key];
      box(x, CELL_W);
      ctx.beginPath(); ctx.arc(x + 15, y + h / 2, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = vc; ctx.shadowColor = vc; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = vc;
      fitText(ctx, v.label.toUpperCase(), x + 26, y + h / 2 + 1, CELL_W - 34, 13, 9, DISPLAY, 700);
    });
    setSpacing(ctx, 0);
    ctx.textBaseline = 'alphabetic';
  }

  // Draw text, shrinking the font until it fits maxW.
  function fitText(ctx, text, x, y, maxW, size, min, family, weight) {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (s > min && ctx.measureText(text).width > maxW) { s -= 0.5; ctx.font = `${weight} ${s}px ${family}`; }
    ctx.fillText(text, x, y);
  }

  function drawRow(ctx, x0, y, s, sel, t) {
    const rc = t.rarity[s.rarity];
    // label panel with a rarity strip on the left
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x0, y, LABEL_W, CELL_H, 14);
    ctx.fillStyle = t.panel; ctx.fill();
    ctx.clip();
    ctx.fillStyle = rc; ctx.fillRect(x0, y, 4, CELL_H);
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(x0, y, LABEL_W, CELL_H, 14);
    ctx.strokeStyle = t.line; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = t.text;
    setSpacing(ctx, 0.4);
    fitText(ctx, s.name.toUpperCase(), x0 + 18, y + 34, LABEL_W - 32, 20, 13, DISPLAY, 700);
    setSpacing(ctx, 0.6);
    ctx.font = `700 10px ${BODY}`;
    const label = s.rarity.toUpperCase();
    const pw = ctx.measureText(label).width + 14;
    ctx.beginPath(); ctx.roundRect(x0 + 18, y + 46, pw, 18, 5);
    ctx.fillStyle = rc; ctx.fill();
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x0 + 25, y + 55.5);
    ctx.textBaseline = 'alphabetic';
    setSpacing(ctx, 0);

    const slugs = Object.values(s.variants);
    const idx = slugs.filter(sl => statusOf(sl) >= 1).length;
    const mas = slugs.filter(sl => statusOf(sl) === 2).length;
    ctx.font = `600 12px ${BODY}`;
    ctx.fillStyle = t.muted;
    ctx.fillText(`${idx}/${slugs.length} indexed · ${mas} mastered`, x0 + 18, y + 86);

    sel.cols.forEach((v, i) => {
      const x = cellX(x0, i);
      const slug = s.variants[v.key];
      if (!slug) return; // this sprite has no such quality
      if (sel.has(s, v)) drawCard(ctx, x, y, s, v, slug, t);
      else drawEmptySlot(ctx, x, y, t);
    });
  }

  function drawEmptySlot(ctx, x, y, t) {
    ctx.beginPath(); ctx.roundRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1, 14);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = rgba(t.muted, 0.25); ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCard(ctx, x, y, s, v, slug, t) {
    const st = keyOf(slug);
    const vc = v.key === 'normal' ? t.rarity[s.rarity] : t.variant[v.key];

    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, CELL_W, CELL_H, 14);
    ctx.fillStyle = t.panel; ctx.fill();
    ctx.clip();
    // art area
    const lg = ctx.createLinearGradient(x, y, x + CELL_W * 0.4, y + IMG + 20);
    lg.addColorStop(0, st === 'missing' ? '#24211d' : rgba(vc, 0.35));
    lg.addColorStop(1, '#100f0d');
    ctx.fillStyle = lg;
    ctx.fillRect(x, y, CELL_W, IMG + 20);
    if (st !== 'missing') {
      const rg = ctx.createRadialGradient(x + CELL_W / 2, y + IMG * 0.45, 0, x + CELL_W / 2, y + IMG * 0.45, IMG * 0.62);
      rg.addColorStop(0, rgba(vc, 0.5)); rg.addColorStop(1, rgba(vc, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(x, y, CELL_W, IMG + 20);
    }
    const img = loaded.get(`img/${slug}.webp`);
    if (img) {
      if (st === 'missing') ctx.filter = 'grayscale(0.85) brightness(0.7)';
      ctx.drawImage(img, x + (CELL_W - IMG) / 2, y + 8, IMG, IMG);
      ctx.filter = 'none';
    }
    ctx.restore();

    // border
    ctx.beginPath(); ctx.roundRect(x, y, CELL_W, CELL_H, 14);
    if (st === 'mastered') {
      ctx.shadowColor = rgba(t.mastered, 0.45); ctx.shadowBlur = 14;
      ctx.strokeStyle = t.mastered; ctx.lineWidth = 2; ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = rgba(vc, 0.35); ctx.lineWidth = 1; ctx.stroke();
    }

    // status label
    const color = st === 'indexed' ? t.indexed : st === 'mastered' ? t.mastered : t.muted;
    const label = STATUSES.find(x2 => x2.key === st).label.toUpperCase();
    ctx.textAlign = 'center';
    ctx.font = `700 11px ${BODY}`;
    setSpacing(ctx, 0.6);
    ctx.fillStyle = color;
    ctx.fillText(label, x + CELL_W / 2, y + IMG + 38);
    setSpacing(ctx, 0);

    // corner badge
    if (st !== 'missing') {
      ctx.beginPath(); ctx.arc(x + CELL_W - 17, y + 17, 11, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = st === 'indexed' ? '#152200' : '#241800';
      ctx.font = `800 13px ${BODY}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(st === 'indexed' ? '✓' : '★', x + CELL_W - 17, y + 18);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.textAlign = 'left';
  }

  function drawFooter(ctx, W, H, page, t) {
    ctx.font = `500 11px ${BODY}`;
    ctx.fillStyle = rgba(t.muted, 0.8);
    ctx.fillText('SpriteMaxing · unofficial Fortnite fan tool · sprite art © Epic Games', PAD, H - PAD + 18);
    if (page) {
      ctx.textAlign = 'right';
      ctx.fillText(`Page ${page[0]} of ${page[1]}`, W - PAD, H - PAD + 18);
      ctx.textAlign = 'left';
    }
  }

  function renderSheet(sel, rows, { title, page, a4, scale = PDF_SCALE }) {
    const t = theme();
    const W = sheetWidth(sel);
    const contentH = PAD + (title ? TITLE_H : 0) + COLHEAD_H + rows.length * ROW_H - GAP + FOOT_H + PAD;
    const H = a4 ? Math.round(W * A4_RATIO) : contentH;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    drawBackground(ctx, W, H, t);
    const tableW = LABEL_W + sel.cols.length * (CELL_W + GAP);
    const x0 = Math.round((W - tableW) / 2);
    let y = PAD;
    if (title) { drawTitle(ctx, W, y, sel, t); y += TITLE_H; }
    drawColHeads(ctx, x0, y, sel, t);
    y += COLHEAD_H;
    for (const s of rows) { drawRow(ctx, x0, y, s, sel, t); y += ROW_H; }
    drawFooter(ctx, W, H, page, t);
    return canvas;
  }

  // ---------- output ----------
  const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
    try { canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality); }
    catch (e) { reject(e); }
  });

  // Minimal PDF 1.4: one A4 page per JPEG, image stretched to the full page.
  function buildPdf(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let len = 0;
    const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; chunks.push(b); len += b.length; };
    const obj = (id, write) => { offsets[id] = len; push(`${id} 0 obj\n`); write(); push('\nendobj\n'); };
    const PW = 595.28, PH = 841.89;
    const pageId = i => 3 + i * 3, contentId = i => 4 + i * 3, imageId = i => 5 + i * 3;
    const count = 2 + pages.length * 3;

    push('%PDF-1.4\n');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`));
    pages.forEach((p, i) => {
      obj(pageId(i), () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${imageId(i)} 0 R >> >> /Contents ${contentId(i)} 0 R >>`));
      const draw = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
      obj(contentId(i), () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
      obj(imageId(i), () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
        push(p.jpeg);
        push('\nendstream');
      });
    });
    const xref = len;
    let table = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    push(`${table}trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function exportCollection(include, format) {
    const sel = selection(include);
    await prepare(sel);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'png') {
      const canvas = renderSheet(sel, sel.rows, { title: true, page: null, a4: false, scale: PNG_SCALE });
      download(await toBlob(canvas, 'image/png'), `spritemaxing-collection-${stamp}.png`);
      return { kind: 'image', pages: 1 };
    }
    const chunks = paginate(sel);
    const pages = [];
    for (let i = 0; i < chunks.length; i++) {
      const canvas = renderSheet(sel, chunks[i], { title: i === 0, page: [i + 1, chunks.length], a4: true });
      const jpeg = await toBlob(canvas, 'image/jpeg', 0.92);
      pages.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), w: canvas.width, h: canvas.height });
    }
    download(buildPdf(pages), `spritemaxing-collection-${stamp}.pdf`);
    return { kind: 'PDF', pages: pages.length };
  }

  // ---------- dialog ----------
  const dlg = $('#exportDialog');
  const form = $('#exportForm');
  const go = $('#exportGo');
  const include = () => new Set([...form.querySelectorAll('input[name="inc"]:checked')].map(i => i.value));
  const format = () => form.querySelector('input[name="fmt"]:checked').value;

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ include: [...include()], format: format() })); } catch {}
  }

  function updateSummary() {
    const all = sprites.flatMap(s => Object.values(s.variants));
    for (const st of STATUSES) {
      form.querySelector(`[data-count="${st.key}"]`).textContent = all.filter(sl => keyOf(sl) === st.key).length;
    }
    const inc = include();
    const sel = selection(inc);
    const out = $('#exportSummary');
    if (!inc.size) {
      out.textContent = 'Pick at least one status to export.';
      go.disabled = true;
    } else if (!sel.cards) {
      out.textContent = 'No sprites have the selected status yet.';
      go.disabled = true;
    } else {
      const pages = format() === 'pdf' ? ` · ${paginate(sel).length} A4 page${paginate(sel).length === 1 ? '' : 's'}` : '';
      out.textContent = `${sel.cards} card${sel.cards === 1 ? '' : 's'} from ${sel.rows.length} sprite${sel.rows.length === 1 ? '' : 's'}${pages}`;
      go.disabled = false;
    }
  }

  $('#exportBtn').addEventListener('click', () => {
    const prefs = loadPrefs();
    if (Array.isArray(prefs.include)) {
      form.querySelectorAll('input[name="inc"]').forEach(i => { i.checked = prefs.include.includes(i.value); });
    }
    if (prefs.format) {
      const r = form.querySelector(`input[name="fmt"][value="${prefs.format}"]`);
      if (r) r.checked = true;
    }
    updateSummary();
    dlg.showModal();
  });
  form.addEventListener('change', updateSummary);
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (go.disabled) return;
    savePrefs();
    go.disabled = true;
    go.textContent = 'Rendering…';
    try {
      const res = await exportCollection(include(), format());
      dlg.close();
      toast(res.kind === 'PDF' ? `PDF saved (${res.pages} page${res.pages === 1 ? '' : 's'}).` : 'Image saved.');
    } catch (err) {
      console.error(err);
      toast(err && err.name === 'SecurityError'
        ? 'Export needs the app served over http. Run: node serve.js'
        : 'Export failed. Please try again.');
    } finally {
      go.textContent = 'Export';
      updateSummary();
    }
  });

  // Exposed for testing in the console.
  window.SpriteMaxing.exportCollection = exportCollection;
  window.SpriteMaxing.renderSheet = (include, opts = {}) => {
    const sel = selection(new Set(include));
    return prepare(sel).then(() => renderSheet(sel, sel.rows, { title: true, ...opts }));
  };
})();
