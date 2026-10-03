#!/usr/bin/env node
/*
  Guestbook → print-ready PDF

  Reads every signature from the public Cloudinary list (or a saved JSON
  backup) and lays it out as a printable book in the same style as the
  site's guestbook. Writes, into ./out:

    guestbook-interior.pdf   inside pages (title, thank-you, entries, closing page)
    guestbook-cover.pdf      front cover on its own page
    guestbook.json           raw backup of every entry
    guestbook.csv            the same, for a spreadsheet

  Usage:
    npm install && npx playwright install chromium
    node export.mjs [--size a5|a4|8x10in|8x8in|210sq|<W>x<H>mm] [--bleed 3]
                    [--paper white|cream] [--order oldest|newest]
                    [--multiple 2] [--input guestbook.json] [--out out]
*/
import { chromium } from 'playwright';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ── Options ─────────────────────────────────────────────────────────── */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, [])
);

const CLOUD_NAME = args.cloud || process.env.CLOUD_NAME || 'pzlb8o6s';
const TAG        = args.tag   || process.env.GUESTBOOK_TAG || 'wedding_guestbook';
const OUT        = path.resolve(args.out || 'out');
const BLEED      = Number(args.bleed ?? 3);                 // mm added on every edge
const PAPER      = (args.paper || 'white') === 'cream' ? '#f5f2eb' : '#ffffff';
const ORDER      = args.order === 'newest' ? 'newest' : 'oldest';
const MULTIPLE   = Math.max(1, Number(args.multiple ?? 2)); // pad page count (printers often want 2 or 4)

const SIZES = {               // trim size in mm, width × height
  a5:      [148, 210],
  a4:      [210, 297],
  '8x10in': [203.2, 254],
  '8x8in':  [203.2, 203.2],
  '210sq':  [210, 210],
};
function parseSize(s = 'a5') {
  if (SIZES[s]) return SIZES[s];
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2])];
  throw new Error(`Unknown --size "${s}". Use one of ${Object.keys(SIZES).join(', ')} or e.g. 150x200mm`);
}
const [TRIM_W, TRIM_H] = parseSize(args.size);

/* ── Entries ─────────────────────────────────────────────────────────── */
async function loadEntries() {
  let resources;
  if (args.input) {
    const data = JSON.parse(await readFile(path.resolve(args.input), 'utf8'));
    resources = Array.isArray(data) ? data : data.resources || data.entries || [];
  } else {
    const url = `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${TAG}.json?t=${Date.now()}`;
    const res = await fetch(url);
    if (res.status === 404) resources = [];
    else if (!res.ok) throw new Error(`Cloudinary list failed (${res.status}): ${url}`);
    else resources = (await res.json()).resources || [];
  }
  const entries = resources
    .map(r => r.context?.custom ? {
      id: r.public_id,
      name: r.context.custom.name,
      message: r.context.custom.message || '',
      signedAt: r.created_at,
      kind: r.context.custom.kind,
    } : r)                                   // already-flattened backup entries
    .filter(e => e && e.name && (e.kind === undefined || e.kind === 'guestbook'))
    .map(({ kind, ...e }) => e);
  entries.sort((a, b) => new Date(a.signedAt) - new Date(b.signedAt));
  if (ORDER === 'newest') entries.reverse();
  return entries;
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCsv = entries => ['name,message,signed_at', ...entries.map(e =>
  [e.name, e.message, e.signedAt].map(csvCell).join(','))].join('\n') + '\n';

/* ── Layout ──────────────────────────────────────────────────────────── */
const font = f => pathToFileURL(path.join(here, 'fonts', f)).href;
const NAMES_IMG = pathToFileURL(path.join(here, '..', '..', 'assets', 'names.png')).href;

function baseCss() {
  const u = TRIM_W / 148;                 // scale type with page width (A5 = 1)
  const pw = TRIM_W + 2 * BLEED, ph = TRIM_H + 2 * BLEED;
  const side = TRIM_W * 0.11, top = TRIM_H * 0.085, bottom = TRIM_H * 0.1;
  return `
    @font-face { font-family: 'Licorice'; src: url('${font('Licorice-400.ttf')}'); }
    @font-face { font-family: 'Playfair Display'; font-style: normal; font-weight: 400; src: url('${font('PlayfairDisplay-400.ttf')}'); }
    @font-face { font-family: 'Playfair Display'; font-style: italic; font-weight: 400; src: url('${font('PlayfairDisplay-400Italic.ttf')}'); }
    @font-face { font-family: 'Playfair Display'; font-style: italic; font-weight: 500; src: url('${font('PlayfairDisplay-500Italic.ttf')}'); }
    @font-face { font-family: 'Open Sans'; font-weight: 300; src: url('${font('OpenSans-300.ttf')}'); }
    @font-face { font-family: 'Open Sans'; font-weight: 400; src: url('${font('OpenSans-400.ttf')}'); }

    @page { size: ${pw}mm ${ph}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #2b2b2b; }

    .p { position: relative; width: ${pw}mm; height: ${ph}mm; overflow: hidden; break-after: page; background: ${PAPER}; }
    .p:last-child { break-after: auto; }
    .safe { position: absolute; top: ${BLEED + top}mm; bottom: ${BLEED + bottom}mm; left: ${BLEED + side}mm; right: ${BLEED + side}mm;
            display: flex; flex-direction: column; overflow: hidden; }
    .centre { justify-content: center; align-items: center; text-align: center; }

    .names { width: ${TRIM_W * 0.42}mm; height: auto; }
    .names--ink { filter: invert(1) brightness(0.2); }
    .script { font-family: 'Licorice', cursive; font-size: ${34 * u}pt; line-height: 1.1; letter-spacing: 0.03em; margin: 0; }
    .lead { font-family: 'Playfair Display', serif; font-style: italic; font-size: ${12.5 * u}pt; line-height: 1.6; color: #555; margin: 7% 0 0; }
    .small { font-family: 'Open Sans', sans-serif; font-weight: 400; font-size: ${6.5 * u}pt; letter-spacing: 0.3em; text-transform: uppercase; color: #8d897f; margin: 6% 0 0; }
    .date { font-family: 'Playfair Display', serif; font-size: ${9 * u}pt; letter-spacing: 0.3em; color: #8d897f; margin: 5% 0 0; }

    .entry { padding: ${4.2 * u}mm 0; break-inside: avoid; }
    .entry + .entry { border-top: 0.25pt solid rgba(0, 0, 0, 0.18); }
    .entry__message { font-family: 'Playfair Display', serif; font-style: italic; font-size: ${11 * u}pt; line-height: 1.55; color: #474747; margin: 0; overflow-wrap: anywhere; }
    .entry__name { font-family: 'Licorice', cursive; font-size: ${24 * u}pt; line-height: 1.1; letter-spacing: 0.03em; color: #1f1f1f; text-align: right; margin: 1.5mm 0 0; overflow-wrap: anywhere; }

    .num { position: absolute; left: 0; right: 0; bottom: ${BLEED + bottom * 0.45}mm; text-align: center;
           font-family: 'Playfair Display', serif; font-style: italic; font-size: ${8 * u}pt; color: #9a968e; }

    /* Cover */
    .cover { background: #2a2a2c; color: #fff; }
    .cover .frame { position: absolute; inset: ${BLEED + TRIM_W * 0.05}mm; border: 0.5pt solid rgba(255,255,255,0.35); }
    .cover .frame::after { content: ''; position: absolute; inset: ${TRIM_W * 0.012}mm; border: 0.5pt solid rgba(255,255,255,0.12); }
    .cover .script { font-size: ${44 * u}pt; margin-top: 6%; }
    .cover .date { color: #b5b5b7; }
  `;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function interiorHtml(entries) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss()}</style></head><body>
    <section class="p"><div class="safe centre">
      <img class="names names--ink" src="${NAMES_IMG}" alt="">
      <p class="script" style="margin-top:6%">Guestbook</p>
      <p class="date">05 | 12 | 26</p>
      <p class="small">Abbey House Hotel &amp; Gardens</p>
    </div></section>
    <section class="p"><div class="safe centre">
      <p class="lead" style="margin:0">Thank you for sharing our day with us.</p>
    </div></section>
    <div id="flow"></div>
    <script>
      const entries = ${JSON.stringify(entries).replace(/</g, '\\u003c')};
      const MULTIPLE = ${MULTIPLE};
      const flow = document.getElementById('flow');
      const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
      let num = 0;
      function newPage() {
        const p = el('section', 'p'), safe = el('div', 'safe');
        p.appendChild(safe); p.appendChild(el('span', 'num', String(++num)));
        flow.appendChild(p);
        return safe;
      }
      // Fill each page until it overflows, then start the next
      let safe = entries.length ? newPage() : null;
      for (const e of entries) {
        const n = el('div', 'entry');
        n.appendChild(el('p', 'entry__message', e.message));
        n.appendChild(el('p', 'entry__name', e.name));
        safe.appendChild(n);
        if (safe.scrollHeight > safe.clientHeight + 1 && safe.children.length > 1) {
          safe.removeChild(n);
          safe = newPage();
          safe.appendChild(n);
        }
      }
      const end = el('section', 'p'); end.innerHTML = '<div class="safe centre"><p class="script">With love</p><p class="lead">Faron &amp; Darren</p><p class="date">05 | 12 | 26</p></div>';
      flow.appendChild(end);
      while (document.querySelectorAll('.p').length % MULTIPLE) flow.appendChild(el('section', 'p'));
      window.__pages = document.querySelectorAll('.p').length;
    </script>
  </body></html>`;
}

function coverHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss()}</style></head><body>
    <section class="p cover"><div class="frame"></div><div class="safe centre">
      <img class="names" src="${NAMES_IMG}" alt="">
      <p class="script">Guestbook</p>
      <p class="date">05 | 12 | 26</p>
    </div></section>
  </body></html>`;
}

/* ── Render ──────────────────────────────────────────────────────────── */
async function renderPdf(browser, html, file) {
  const page = await browser.newPage();
  const tmp = path.join(OUT, `.${path.basename(file)}.html`);
  await writeFile(tmp, html);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  const pages = await page.evaluate(() => window.__pages || document.querySelectorAll('.p').length);
  await page.close();
  return pages;
}

const entries = await loadEntries();
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'guestbook.json'), JSON.stringify(entries, null, 2) + '\n');
await writeFile(path.join(OUT, 'guestbook.csv'), toCsv(entries));

const browser = await chromium.launch();
const interiorPages = await renderPdf(browser, interiorHtml(entries), path.join(OUT, 'guestbook-interior.pdf'));
await renderPdf(browser, coverHtml(), path.join(OUT, 'guestbook-cover.pdf'));
await browser.close();

for (const f of ['.guestbook-interior.pdf.html', '.guestbook-cover.pdf.html']) await rm(path.join(OUT, f), { force: true });

console.log(`${entries.length} signature${entries.length === 1 ? '' : 's'} → ${interiorPages} interior pages`);
console.log(`Trim ${TRIM_W} × ${TRIM_H} mm, bleed ${BLEED} mm (PDF page ${TRIM_W + 2 * BLEED} × ${TRIM_H + 2 * BLEED} mm), paper ${PAPER}`);
console.log(`Files in ${OUT}`);
if (!entries.length) console.warn('Warning: no signatures found — the book only has its title and closing pages.');
