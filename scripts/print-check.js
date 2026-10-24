/*
 * Finds out why printing isn't working: checks the print mode, lists the printers and their status,
 * sends a 4x6 test page and looks at the print queue afterwards.
 * Run with:  npm run print-check
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { listPrinters, sendToPrinter, buildTestPagePdf } = require('../printing');

const isWin = process.platform === 'win32';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
const powershell = (command) => run('powershell.exe', ['-NoProfile', '-Command', command]);
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Windows printer status codes (Win32_Printer.PrinterStatus)
const WIN_STATUS = { 1: 'other', 2: 'unknown', 3: 'ready', 4: 'printing', 5: 'warming up', 6: 'stopped', 7: 'OFFLINE' };

function printerDetails() {
  if (isWin) {
    const json = powershell('Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus,DriverName,PortName | ConvertTo-Json');
    if (!json) return [];
    const list = [].concat(JSON.parse(json));
    return list.map((p) => ({
      name: p.Name,
      isDefault: p.Default,
      status: p.WorkOffline ? 'OFFLINE ("Use printer offline" is on)' : WIN_STATUS[p.PrinterStatus] || 'unknown',
      extra: `driver: ${p.DriverName}, port: ${p.PortName}`,
    }));
  }
  const def = (/:\s*(\S+)\s*$/.exec(run('lpstat', ['-d'])) || [])[1];
  return run('lpstat', ['-p'])
    .split('\n')
    .filter((l) => l.startsWith('printer '))
    .map((l) => {
      const name = l.split(' ')[1];
      return { name, isDefault: name === def, status: /disabled/i.test(l) ? 'PAUSED / disabled' : /idle|printing/i.test(l) ? 'ready' : l, extra: '' };
    });
}

function queue(printer) {
  if (isWin) {
    const json = powershell(`Get-PrintJob -PrinterName ${psQuote(printer)} | Select-Object Id,DocumentName,JobStatus,PagesPrinted,TotalPages | ConvertTo-Json`);
    return json ? [].concat(JSON.parse(json)).map((j) => `#${j.Id} ${j.DocumentName} – status: ${j.JobStatus || 'waiting'}`) : [];
  }
  return run('lpstat', ['-o', printer]).split('\n').filter(Boolean);
}

async function main() {
  console.log('\n🖨️  Photobooth print check\n');
  const problems = [];

  // 1. print mode
  const mode = (process.env.PRINT_MODE || 'system').toLowerCase();
  if (mode === 'dry') problems.push('PRINT_MODE=dry in .env: the booth never prints. Change it to PRINT_MODE=system.');
  console.log(`1. Print mode in .env: ${mode === 'dry' ? '⚠ dry (test mode, never prints)' : '✓ system (prints)'}`);
  console.log('   Reminder: "npm run dev" is always test mode. Start the booth with "npm start" or the start-booth file.\n');

  // 2. printers
  const details = printerDetails();
  let printers = details.map((d) => d.name);
  let def = (details.find((d) => d.isDefault) || {}).name || null;
  if (!printers.length) ({ printers, default: def } = await listPrinters().catch(() => ({ printers: [], default: null })));
  console.log('2. Printers this computer knows about:');
  if (!printers.length) {
    console.log('   ⚠ none');
    problems.push('No printers are installed. Add the printer in the system settings first.');
  }
  printers.forEach((name, i) => {
    const d = details.find((x) => x.name === name) || {};
    console.log(`   [${i + 1}] ${name}${name === def ? '  (default)' : ''}  – ${d.status || 'status unknown'}${d.extra ? `  (${d.extra})` : ''}`);
    if (/OFFLINE|PAUSED/i.test(d.status || '')) problems.push(`"${name}" is ${d.status}. Turn the printer on / reconnect it${isWin ? ', and untick "Use printer offline" in its print queue window' : ', and resume it in System Settings'}.`);
  });
  console.log('');
  if (!printers.length) return finish(problems);

  // 3. which printer to test
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(`3. Which printer should get the test page? Type its number (Enter = ${def || printers[0]}): `, r));
  rl.close();
  const chosen = printers[Number(answer) - 1] || def || printers[0];
  if (/pdf|onenote|xps|fax/i.test(chosen)) problems.push(`"${chosen}" is not a real printer (it saves a file instead). Choose your photo printer in the booth's ⚙️ settings.`);

  // 4. send the test page
  const pdf = path.join(os.tmpdir(), `photobooth-test-${Date.now()}.pdf`);
  await buildTestPagePdf(pdf);
  console.log(`\n4. Sending a 4×6 test page to "${chosen}"…`);
  try {
    await sendToPrinter(pdf, 1, chosen);
    console.log('   ✓ The printer driver accepted the page.');
  } catch (err) {
    console.log(`   ✗ Failed: ${err.message}`);
    problems.push(`Sending to "${chosen}" failed: ${err.message}`);
  }

  // 5. what happened to it
  console.log('\n5. Checking the print queue in 10 seconds…');
  await wait(10000);
  const jobs = queue(chosen);
  if (jobs.length) {
    console.log('   Jobs still waiting:');
    jobs.forEach((j) => console.log(`   – ${j}`));
    if (jobs.some((j) => /error|paused|offline|blocked|user intervention/i.test(j))) {
      problems.push('A print job is stuck (error/paused). Check the printer for paper, ink or a paper-size message, then clear the queue.');
    } else {
      problems.push('The job is still in the queue after 10 seconds: the printer may be off, asleep, waiting for paper, or not reachable (check the cable / Wi-Fi).');
    }
  } else {
    console.log('   ✓ The queue is empty: the job was handed to the printer.');
  }
  fs.rm(pdf, () => {});
  finish(problems);
}

function finish(problems) {
  console.log('\n──────────── Result ────────────');
  if (!problems.length) {
    console.log('No problems found. If the page still didn’t come out, check the printer itself (paper loaded, 4×6 tray, no blinking error light),');
    console.log('and that the same printer is chosen in the booth: ⚙️ → Printer → Save.');
  } else {
    problems.forEach((p, i) => console.log(`${i + 1}. ${p}`));
  }
  console.log('\nIf you need help, copy everything above and send it over.\n');
}

main().catch((err) => {
  console.error(`\n❌  ${err.message}\n`);
  process.exitCode = 1;
});
