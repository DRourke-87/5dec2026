# Guestbook export

Turns every guestbook signature into print-ready PDFs in the same style as the
site's guestbook.

| File | What it is |
| --- | --- |
| `guestbook-interior.pdf` | Title page, thank-you page, the signatures (numbered pages), "With love" closing page |
| `guestbook-cover.pdf` | Front cover on its own (most printers take the cover as a separate file) |
| `guestbook.json` / `guestbook.csv` | A backup of every name, message and time signed |

## Easiest: run it on GitHub

1. Open the repo's **Actions** tab → **Export guestbook** → **Run workflow**.
2. Pick a size (`a5`, `a4`, `8x10in`, `8x8in`, `210sq`, or your printer's size such as `150x200mm`),
   the bleed your printer asks for (usually `3`; `0` to print at home), and white or cream pages.
3. When the run finishes (about 2 minutes), download the zip from the bottom of the run page.

## On your own computer

```sh
cd tools/guestbook-export
npm install
npx playwright install chromium
node export.mjs --size a5 --bleed 3 --paper white
```

Other options: `--order newest`, `--multiple 4` (pad the page count for printers that need it),
`--input guestbook.json` (rebuild from a saved backup, no Cloudinary needed), `--out folder`.

## Notes for the printer

- Pages are the trim size plus the bleed on every edge. For example, A5 with 3 mm bleed gives a
  154 × 216 mm PDF. Text stays well inside the safe area.
- Fonts are embedded (Licorice, Playfair Display, Open Sans, all under the SIL Open Font License;
  licences are in `fonts/`).
- Check your printer's spec sheet for trim size, bleed, minimum pages and page multiple. Then
  re-run with the matching options.
- To remove a signature before printing, delete it in Cloudinary's Media Library (tag
  `wedding_guestbook`) and run the export again.
