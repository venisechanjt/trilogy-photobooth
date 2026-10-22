/*
 * Sets up email for the photobooth: asks for a Gmail address and App Password,
 * saves them to .env and sends a test email.   Run with:  npm run setup-email
 */
const readline = require('readline');
const nodemailer = require('nodemailer');
const { updateEnvFile } = require('./env-file');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();

// While a secret is being typed, show * instead of the letters.
let masked = false;
const writeOut = rl._writeToOutput;
rl._writeToOutput = (s) => writeOut.call(rl, masked ? s.replace(/[^\r\n]/g, '*') : s);

async function ask(question, secret = false) {
  process.stdout.write(question);
  masked = secret;
  const { value, done } = await lines.next();
  masked = false;
  if (done) throw new Error('Setup cancelled.');
  return value.trim();
}
const askSecret = (question) => ask(question, true);

async function main() {
  console.log('\n📧  Photobooth email setup\n');
  console.log('You need a Gmail address and a Gmail "App Password" (a 16-letter password just for the booth).');
  console.log('To get one:');
  console.log('  1. Turn on 2-Step Verification:  https://myaccount.google.com/signinoptions/twosv');
  console.log('  2. Create an App Password:       https://myaccount.google.com/apppasswords');
  console.log('     (name it "photobooth", then copy the 16 letters Google shows you)\n');

  const user = await ask('Gmail address the photos are sent from: ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) throw new Error('That doesn’t look like an email address.');
  const pass = (await askSecret('App Password (16 letters, spaces are fine): ')).replace(/\s+/g, '');
  if (pass.length < 16) throw new Error('App Passwords are 16 letters long. Copy it again from Google.');
  const name = (await ask('Name shown as the sender [trilogy photobooth]: ')) || 'trilogy photobooth';

  console.log('\nSending a test email to yourself…');
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user, pass } });
  try {
    await transport.sendMail({
      from: `"${name}" <${user}>`,
      to: user,
      subject: 'Photobooth email is set up ✔',
      text: 'Email from your photobooth works. Guests will receive their photos like this.',
    });
  } catch (err) {
    if (err.code === 'EAUTH') {
      throw new Error('Gmail rejected the login. Check the address, make sure 2-Step Verification is on, and create a new App Password.');
    }
    throw new Error(`Couldn’t send the test email: ${err.message}`);
  }

  updateEnvFile({
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: user,
    SMTP_PASS: pass,
    MAIL_FROM: `"${name} <${user}>"`,
  });
  console.log(`\n✅  Done! A test email was sent to ${user} (check spam if you don't see it).`);
  console.log('    Settings saved to .env. Restart the booth (Ctrl + C, then npm run dev) to use them.\n');
}

main()
  .catch((err) => {
    console.error(`\n❌  ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
