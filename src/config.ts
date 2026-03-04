import dotenv from 'dotenv';
import { Organization, Environment, OrgEnvMapping } from './types';

dotenv.config();

export const env = {
  slackBotToken: process.env.SLACK_BOT_TOKEN!,
  slackAppToken: process.env.SLACK_APP_TOKEN!,
  githubToken: process.env.GITHUB_TOKEN!,
  githubOwner: process.env.GITHUB_OWNER!,
  githubRepo: process.env.GITHUB_REPO!,
  repoLocalPath: process.env.REPO_LOCAL_PATH!,
};

export const ORG_ALIASES: Record<string, Organization> = {
  medlog: 'medlog',
  med: 'medlog',
  universal: 'universal',
  uni: 'universal',
  forwardair: 'forwardair',
  'forward-air': 'forwardair',
  fa: 'forwardair',
  us: 'portpro',
  portpro: 'portpro',
  pp: 'portpro',
};

export const ENV_ALIASES: Record<string, Environment> = {
  prod: 'production',
  production: 'production',
  live: 'production',
  sandbox: 'sandbox',
  sand: 'sandbox',
  pre: 'sandbox',
};

const mappingKey = (org: Organization, e: Environment) => `${org}:${e}`;

export const ORG_ENV_MAP: Record<string, OrgEnvMapping> = {
  [mappingKey('medlog', 'production')]: {
    file: 'worker.config.js',
    branch: 'PRODUCTION-MEDLOG',
    connectionApiUrl: process.env.CONN_API_URL_MEDLOG_PROD!,
    connectionApiToken: process.env.CONN_API_TOKEN_MEDLOG_PROD!,
  },
  [mappingKey('medlog', 'sandbox')]: {
    file: 'worker-medlog-pre.config.js',
    branch: '2.38.35-MEDLOG-rc',
    connectionApiUrl: process.env.CONN_API_URL_MEDLOG_SANDBOX!,
    connectionApiToken: process.env.CONN_API_TOKEN_MEDLOG_SANDBOX!,
  },
  [mappingKey('universal', 'production')]: {
    file: 'universal-worker.config.js',
    branch: 'PRODUCTION-UNIVERSAL',
    connectionApiUrl: process.env.CONN_API_URL_UNIVERSAL_PROD!,
    connectionApiToken: process.env.CONN_API_TOKEN_UNIVERSAL_PROD!,
  },
  [mappingKey('universal', 'sandbox')]: {
    file: 'worker-universal-worker-pre.config.js',
    branch: '2.38.35-UNIVERSAL-rc',
    connectionApiUrl: process.env.CONN_API_URL_UNIVERSAL_SANDBOX!,
    connectionApiToken: process.env.CONN_API_TOKEN_UNIVERSAL_SANDBOX!,
  },
  [mappingKey('forwardair', 'production')]: {
    file: 'forward-air-worker.config.js',
    branch: 'PRODUCTION-FORWARDAIR',
    connectionApiUrl: process.env.CONN_API_URL_FORWARDAIR_PROD!,
    connectionApiToken: process.env.CONN_API_TOKEN_FORWARDAIR_PROD!,
  },
  [mappingKey('portpro', 'production')]: {
    file: 'worker-us.config.js',
    branch: 'PRODUCTION',
    connectionApiUrl: process.env.CONN_API_URL_PORTPRO_PROD!,
    connectionApiToken: process.env.CONN_API_TOKEN_PORTPRO_PROD!,
  },
};

const INVALID_COMBOS = new Set([
  mappingKey('portpro', 'sandbox'),
  mappingKey('forwardair', 'sandbox'),
]);

export function getMapping(org: Organization, e: Environment): OrgEnvMapping {
  const key = mappingKey(org, e);
  if (INVALID_COMBOS.has(key)) {
    throw new Error(`No sandbox environment exists for ${org}. Only production is supported.`);
  }
  const mapping = ORG_ENV_MAP[key];
  if (!mapping) {
    throw new Error(`No configuration found for ${org} ${e}.`);
  }
  return mapping;
}
