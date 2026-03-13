import fs from 'fs';
import path from 'path';
import { Organization, Environment, ISAPair, ResolvedWorker, WorkerResult } from '../types';

const TOPIC_PREFIX = 'EDI.';
const TOPIC_MIDDLE = '.204_MOTOR_CARRIER_LOAD_TENDER.';

function buildTopic(isa: ISAPair, envSuffix: 'TEST' | 'LIVE'): string {
  return `${TOPIC_PREFIX}${isa.customerISA}.${isa.companyISA}${TOPIC_MIDDLE}${envSuffix}`;
}

function buildWorkerName(org: Organization, isa: ISAPair, envSuffix: 'test' | 'live', customName?: string): string {
  const middle = customName ?? `${isa.customerISA}-${isa.companyISA}`;
  return `${org}-${middle}-${envSuffix}`;
}

function buildWorkerBlock(
  workerName: string,
  topic: string,
  port: number,
  includeNodeEnv: boolean,
): string {
  const envEntries = [
    `        ENABLE_WORKER: "true"`,
    `        WORKER_TOPIC: "${topic}"`,
    `        PORT: "${port}"`,
  ];
  if (includeNodeEnv) {
    envEntries.push(`        NODE_ENV: "production"`);
  }

  const logName = workerName.toLowerCase();

  return [
    `    {`,
    `      name: "${workerName}",`,
    `      script: "src/app.ts",`,
    `      interpreter: "node",`,
    `      node_args: [`,
    `        "-r",`,
    `        "ts-node/register/transpile-only",`,
    `        "-r",`,
    `        "module-alias/register"`,
    `      ],`,
    `      instances: 1,`,
    `      exec_mode: "fork",`,
    `      watch: false,`,
    `      merge_logs: true,`,
    `      env: {`,
    ...envEntries.map(e => e + ','),
    `      },`,
    `      out_file: "logs/${logName}.out.log",`,
    `      error_file: "logs/${logName}.err.log"`,
    `    }`,
  ].join('\n');
}

function findMaxPort(content: string): number {
  const portRegex = /PORT:\s*"(\d+)"/g;
  let max = 8079;
  let match: RegExpExecArray | null;
  while ((match = portRegex.exec(content)) !== null) {
    const p = parseInt(match[1], 10);
    if (p > max) max = p;
  }
  return max;
}

function topicExists(content: string, topic: string): boolean {
  return content.includes(`"${topic}"`);
}

export interface AddWorkersParams {
  filePath: string;
  org: Organization;
  env: Environment;
  resolvedWorkers: ResolvedWorker[];
}

export function addWorkersToFile(params: AddWorkersParams): WorkerResult[] {
  const { filePath, org, env: environment, resolvedWorkers } = params;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf-8');
  const includeNodeEnv = org === 'forwardair';
  let currentMaxPort = findMaxPort(content);
  const results: WorkerResult[] = [];
  const blocksToInsert: string[] = [];

  for (const worker of resolvedWorkers) {
    const isProd = environment === 'production';

    const testTopic = buildTopic(worker.testISA, 'TEST');
    const testName = buildWorkerName(org, worker.testISA, 'test', worker.name);

    if (topicExists(content, testTopic)) {
      results.push({ name: testName, topic: testTopic, port: '-', status: 'duplicate' });
    } else {
      currentMaxPort++;
      const block = buildWorkerBlock(testName, testTopic, currentMaxPort, includeNodeEnv);
      blocksToInsert.push(block);
      results.push({ name: testName, topic: testTopic, port: String(currentMaxPort), status: 'created' });
    }

    if (isProd) {
      const liveTopic = buildTopic(worker.liveISA, 'LIVE');
      const liveName = buildWorkerName(org, worker.liveISA, 'live', worker.name);

      if (topicExists(content, liveTopic)) {
        results.push({ name: liveName, topic: liveTopic, port: '-', status: 'duplicate' });
      } else {
        currentMaxPort++;
        const block = buildWorkerBlock(liveName, liveTopic, currentMaxPort, includeNodeEnv);
        blocksToInsert.push(block);
        results.push({ name: liveName, topic: liveTopic, port: String(currentMaxPort), status: 'created' });
      }
    }
  }

  if (blocksToInsert.length === 0) {
    return results;
  }

  const lastBracketIdx = content.lastIndexOf(']');
  if (lastBracketIdx === -1) {
    throw new Error('Could not find closing ] in config file.');
  }

  const contentBeforeBracket = content.slice(0, lastBracketIdx);
  const needsComma = !contentBeforeBracket.trimEnd().endsWith(',');

  const insertionText = blocksToInsert
    .map((b, i) => (i === 0 && !needsComma ? '\n' + b : ',\n' + b))
    .join('');

  content = content.slice(0, lastBracketIdx) + insertionText + '\n  ' + content.slice(lastBracketIdx);

  fs.writeFileSync(filePath, content, 'utf-8');

  return results;
}
