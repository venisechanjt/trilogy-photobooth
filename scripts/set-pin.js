/*
 * Sets the PIN that locks the booth settings (saved as ADMIN_PIN in .env).
 * Run with:  npm run set-pin        Leave it empty to remove the PIN.
 */
const readline = require('readline');
const { updateEnvFile } = require('./env-file');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();

async function main() {
  process.stdout.write('\n🔒  New settings PIN (4–8 digits, leave empty to remove the PIN): ');
  const { value = '', done } = await lines.next();
  if (done && !value) throw new Error('Setup cancelled.');
  const pin = value.trim();
  if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('Use 4 to 8 digits, numbers only.');
  updateEnvFile({ ADMIN_PIN: pin });
  console.log(pin ? '\n✅  PIN saved.' : '\n✅  PIN removed. Settings are unlocked.');
  console.log('    Restart the booth (Ctrl + C, then npm run dev) to use it.\n');
}

main()
  .catch((err) => {
    console.error(`\n❌  ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
