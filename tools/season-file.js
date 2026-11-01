// Reads and writes the per-season data files in data/ (one file per Fortnite season).
// Each file registers itself in the browser with:
//   (window.SPRITE_SEASONS = window.SPRITE_SEASONS || []).push({ id, ..., sprites, ids, extras, missingIcons, meta });
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA_DIR = path.resolve(__dirname, '..', 'data');

function loadSeasons() {
  const sandbox = { window: {} };
  if (!fs.existsSync(DATA_DIR)) return [];
  for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.js')).sort()) {
    vm.runInNewContext(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'), sandbox, { filename: f });
  }
  return JSON.parse(JSON.stringify(sandbox.window.SPRITE_SEASONS || []));
}

const fileFor = id => path.join(DATA_DIR, `${id}.js`);

function writeSeason(season) {
  const { sprites, ids, extras, missingIcons, ...info } = season;
  const sortedIds = Object.fromEntries(Object.entries(ids || {}).sort((a, b) => a[1] - b[1]));
  const out = [
    `// ${info.title || info.id}: sprite data for SpriteMaxing.`,
    '// Generated and maintained by tools/update-data.js (data datamined by fortnite.gg).',
    '// Do not hand-edit slugs or ids: saved progress, backups and share links depend on them.',
    '(window.SPRITE_SEASONS = window.SPRITE_SEASONS || []).push({',
    ...Object.entries(info).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`),
    `  sprites: ${JSON.stringify(sprites || [], null, 2).replace(/\n/g, '\n  ')},`,
    '  // Permanent fortnite.gg sprite IDs (share links + backups). Never renumber; new sprites just get new IDs.',
    `  ids: ${JSON.stringify(sortedIds)},`,
    '  // Qualities found after app.js was written; shown with a generic style.',
    `  extras: ${JSON.stringify(extras || [])},`,
    '  // Variants whose icon is not available yet (shown with placeholder art).',
    `  missingIcons: ${JSON.stringify(missingIcons || [])},`,
    '});',
    '',
  ].join('\n');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fileFor(season.id), out);
  return fileFor(season.id);
}

module.exports = { DATA_DIR, loadSeasons, writeSeason, fileFor };
