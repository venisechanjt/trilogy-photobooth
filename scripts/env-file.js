// Small helpers the setup commands use to update the .env file without touching other settings.
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const EXAMPLE_PATH = path.join(__dirname, '..', '.env.example');

// Replaces KEY=... lines in the .env text, adding any keys that are missing.
function setEnv(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    out = re.test(out) ? out.replace(re, line) : `${out.replace(/\s*$/, '')}\n${line}\n`;
  }
  return out;
}

function updateEnvFile(values) {
  const base = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : fs.readFileSync(EXAMPLE_PATH, 'utf8');
  fs.writeFileSync(ENV_PATH, setEnv(base, values));
}

module.exports = { updateEnvFile };
