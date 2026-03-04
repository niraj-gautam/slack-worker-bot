import { ORG_ALIASES, ENV_ALIASES } from './config';
import { Organization, Environment, WorkerRequest, WorkerSpec } from './types';

/**
 * Supported formats:
 *   worker medlog prod SENDER RECEIVER
 *   worker medlog prod --connection 42
 *   worker medlog prod SENDER RECEIVER --test TEST_SENDER TEST_RECEIVER
 *   worker medlog prod --connection 42 --name my-carrier --branch RELEASE
 *   workers medlog prod
 *   --connection 42
 *   --connection 43
 *   ABCD EFGH --test XTEST YTEST
 *
 * Rules:
 *   - Message must start with "worker" or "workers" (after stripping mention).
 *   - Multi-line specs only allowed with "workers" (plural).
 *   - Connection IDs use --connection flag; plain tokens are ISA pairs.
 */
export function parseMessage(raw: string): WorkerRequest {
  const cleaned = raw
    .replace(/<@[A-Z0-9]+>/gi, '')
    .trim();

  const lines = cleaned
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new ParseError('Empty message. Usage: `worker <org> <env> <SENDER RECEIVER | --connection ID> [options]`');
  }

  const headerLine = lines[0];
  const headerTokens = tokenize(headerLine);

  const FILLER_WORDS = new Set(['create', 'make', 'add', 'new', 'please', 'pls', 'can', 'you', 'me', 'a', 'an', 'the', 'for', 'i', 'need', 'want']);
  let workerIdx = headerTokens.findIndex(t => /^workers?$/i.test(t));
  if (workerIdx === -1) {
    throw new ParseError('Message must contain `worker` or `workers`.');
  }
  for (let i = 0; i < workerIdx; i++) {
    if (!FILLER_WORDS.has(headerTokens[i].toLowerCase())) {
      throw new ParseError(`Unexpected word "${headerTokens[i]}" before \`worker\`. Only filler words are allowed.`);
    }
  }
  headerTokens.splice(0, workerIdx);

  const keyword = headerTokens[0].toLowerCase();
  const isMulti = keyword === 'workers';

  if (!isMulti && lines.length > 1) {
    throw new ParseError('Use `workers` (plural) for multi-line worker specs. `worker` only supports a single line.');
  }

  const { org, env, branch: headerBranch, specs: headerSpecs } = parseHeaderLine(headerTokens.slice(1));

  let allSpecs: WorkerSpec[];
  if (isMulti && lines.length > 1) {
    allSpecs = [...headerSpecs];
    for (let i = 1; i < lines.length; i++) {
      allSpecs.push(parseWorkerSpecLine(lines[i]));
    }
  } else {
    allSpecs = headerSpecs;
  }

  if (allSpecs.length === 0) {
    throw new ParseError('No worker specifications found. Provide `--connection ID` or `SENDER RECEIVER` ISAs.');
  }

  return { org, env, workers: allSpecs, branch: headerBranch };
}

interface HeaderResult {
  org: Organization;
  env: Environment;
  branch?: string;
  specs: WorkerSpec[];
}

function parseHeaderLine(tokens: string[]): HeaderResult {
  if (tokens.length > 0 && /^for$/i.test(tokens[0])) {
    tokens = tokens.slice(1);
  }

  let org: Organization | undefined;
  let env: Environment | undefined;

  const consumed: number[] = [];
  for (let i = 0; i < Math.min(tokens.length, 4); i++) {
    const lower = tokens[i].toLowerCase();
    if (!org && ORG_ALIASES[lower]) {
      org = ORG_ALIASES[lower];
      consumed.push(i);
    } else if (!env && ENV_ALIASES[lower]) {
      env = ENV_ALIASES[lower];
      consumed.push(i);
    }
    if (org && env) break;
  }

  if (!org) throw new ParseError('Could not identify organization. Use: medlog, med, universal, uni, forwardair, fa, us, portpro, pp');
  if (!env) throw new ParseError('Could not identify environment. Use: prod, production, sandbox, sand, pre');

  const remaining = tokens.filter((_, i) => !consumed.includes(i));

  const { specs, branch } = parseSpecTokens(remaining);

  return { org, env, branch, specs };
}

function parseWorkerSpecLine(line: string): WorkerSpec {
  const tokens = tokenize(line);
  const { specs } = parseSpecTokens(tokens);
  if (specs.length === 0) {
    throw new ParseError(`Could not parse worker line: "${line}"`);
  }
  return specs[0];
}

interface SpecResult {
  specs: WorkerSpec[];
  branch?: string;
}

function parseSpecTokens(tokens: string[]): SpecResult {
  let branch: string | undefined;
  let name: string | undefined;
  let connectionId: number | undefined;
  let testISA: { customerISA: string; companyISA: string } | undefined;

  const extractFlag = (flag: string, argCount: number): string[] | null => {
    const idx = tokens.findIndex(t => t.toLowerCase() === flag);
    if (idx === -1) return null;
    if (idx + argCount >= tokens.length) throw new ParseError(`${flag} requires ${argCount} value(s)`);
    const args = tokens.slice(idx + 1, idx + 1 + argCount);
    tokens.splice(idx, 1 + argCount);
    return args;
  };

  const branchArgs = extractFlag('--branch', 1);
  if (branchArgs) {
    validateSafeString(branchArgs[0], '--branch');
    branch = branchArgs[0];
  }

  const nameArgs = extractFlag('--name', 1);
  if (nameArgs) {
    validateSafeString(nameArgs[0], '--name');
    name = nameArgs[0];
  }

  const connArgs = extractFlag('--connection', 1);
  if (connArgs) {
    const id = parseInt(connArgs[0], 10);
    if (isNaN(id)) throw new ParseError(`--connection value must be a number, got "${connArgs[0]}"`);
    connectionId = id;
  }

  const testArgs = extractFlag('--test', 2);
  if (testArgs) {
    validateISA(testArgs[0], '--test sender');
    validateISA(testArgs[1], '--test receiver');
    testISA = { customerISA: testArgs[0].toUpperCase(), companyISA: testArgs[1].toUpperCase() };
  }

  const specs: WorkerSpec[] = [];

  if (connectionId != null) {
    specs.push({ connectionId, name });
  }

  let i = 0;
  while (i < tokens.length) {
    if (/^[A-Za-z0-9]+$/.test(tokens[i]) && i + 1 < tokens.length && /^[A-Za-z0-9]+$/.test(tokens[i + 1])) {
      validateISA(tokens[i], 'sender ISA');
      validateISA(tokens[i + 1], 'receiver ISA');
      const liveISA = { customerISA: tokens[i].toUpperCase(), companyISA: tokens[i + 1].toUpperCase() };
      specs.push({
        liveISA,
        testISA: testISA ?? liveISA,
        name,
      });
      i += 2;
    } else {
      i++;
    }
  }

  return { specs, branch };
}

function tokenize(line: string): string[] {
  return line.split(/\s+/).filter(Boolean);
}

const SAFE_STRING_RE = /^[A-Za-z0-9._\-/]+$/;
const ISA_RE = /^[A-Za-z0-9]+$/;
const MAX_INPUT_LENGTH = 64;

function validateSafeString(value: string, label: string): void {
  if (value.length > MAX_INPUT_LENGTH) {
    throw new ParseError(`${label} value is too long (max ${MAX_INPUT_LENGTH} chars).`);
  }
  if (!SAFE_STRING_RE.test(value)) {
    throw new ParseError(`${label} contains invalid characters. Only alphanumeric, dots, hyphens, underscores, and slashes are allowed.`);
  }
}

function validateISA(value: string, label: string): void {
  if (value.length > MAX_INPUT_LENGTH) {
    throw new ParseError(`${label} is too long (max ${MAX_INPUT_LENGTH} chars).`);
  }
  if (!ISA_RE.test(value)) {
    throw new ParseError(`${label} contains invalid characters. Only alphanumeric characters are allowed.`);
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}
