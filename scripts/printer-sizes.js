/*
 * Mac / Linux: finds the name your printer uses for 4x6 paper and saves it as PRINT_MEDIA in .env.
 * Run with:  npm run printer-sizes
 */
const { execFileSync } = require('child_process');
const readline = require('readline');
const { updateEnvFile } = require('./env-file');

const FOUR_BY_SIX = /4x6|w288h432|postcard|10x15|100x150|102x152|4r\b/i;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

async function main() {
  if (process.platform === 'win32') {
    console.log('\nOn Windows, set the paper size in the printer’s Printing preferences instead (see README → Printing).\n');
    return;
  }
  const printers = run('lpstat', ['-e']).split('\n').map((s) => s.trim()).filter(Boolean);
  if (!printers.length) {
    console.log('\nNo printers found. Add the printer in System Settings → Printers & Scanners first.\n');
    return;
  }

  const suggestions = [];
  for (const printer of printers) {
    // e.g. "PageSize/Media Size: Letter *4x6 A4 ..."  (the * marks the current default)
    const line = run('lpoptions', ['-p', printer, '-l']).split('\n').find((l) => /^(PageSize|media)\b/i.test(l));
    console.log(`\n🖨️  ${printer}`);
    if (!line) {
      console.log('   (no paper size list reported)');
      continue;
    }
    const sizes = line.split(':')[1].trim().split(/\s+/).map((s) => s.replace(/^\*/, ''));
    // plain 4x6 names first, printer-specific variants (e.g. Postcard.Fullbleed) after
    const matches = sizes.filter((s) => FOUR_BY_SIX.test(s)).sort((a, b) => /^(4x6|w288h432)$/i.test(b) - /^(4x6|w288h432)$/i.test(a));
    console.log(`   4×6 paper size name: ${matches.length ? matches.join(', ') : 'none found'}`);
    if (matches.length) suggestions.push({ printer, media: matches[0] });
  }

  if (!suggestions.length) {
    console.log('\nNo 4×6 size found. Check the printer supports 4×6 / 10×15 cm paper, or ask for help with the list above.\n');
    return;
  }
  const { printer, media } = suggestions[0];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`\nUse "${media}" (from ${printer}) for the booth? [Y/n] `, resolve));
  rl.close();
  if (/^n/i.test(answer.trim())) {
    console.log('Nothing changed.\n');
    return;
  }
  updateEnvFile({ PRINT_MEDIA: media });
  console.log(`\n✅  Saved PRINT_MEDIA=${media} to .env. Restart the booth, then use ⚙️ → Print test page.\n`);
}

main().catch((err) => {
  console.error(`\n❌  ${err.message}\n`);
  process.exitCode = 1;
});
