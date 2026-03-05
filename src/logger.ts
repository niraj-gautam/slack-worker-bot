import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const RETENTION_DAYS = 3;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `bot-${date}.log`);
}

function timestamp(): string {
  return new Date().toISOString();
}

function write(level: string, ...args: unknown[]): void {
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
  const line = `[${timestamp()}] [${level}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(getLogFile(), line);
}

export const logger = {
  info: (...args: unknown[]) => write('INFO', ...args),
  error: (...args: unknown[]) => write('ERROR', ...args),
};

export function cleanOldLogs(): void {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(LOG_DIR)) {
    if (!file.startsWith('bot-') || !file.endsWith('.log')) continue;
    const filePath = path.join(LOG_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
    }
  }
}
