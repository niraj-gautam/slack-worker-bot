import { App } from '@slack/bolt';
import { env, getMapping } from './config';
import { parseMessage, ParseError } from './parser';
import { fetchConnection, extractISAs } from './services/connection';
import { addWorkersToFile } from './services/worker';
import {
  prepareBaseBranch,
  resolveUniqueBranchName,
  createFeatureBranch,
  commitAndPush,
  branchExistsOnRemote,
  ensureBranchExists,
  findOpenPR,
  addPRComment,
  createPullRequest,
  cleanupLocalBranch,
  resetLocalRepo,
} from './services/git';
import { ResolvedWorker, WorkerResult } from './types';
import path from 'path';
import { logger, cleanOldLogs } from './logger';

const app = new App({
  token: env.slackBotToken,
  appToken: env.slackAppToken,
  socketMode: true,
});

const ALLOWED_USERS = process.env.ALLOWED_SLACK_USERS
  ? process.env.ALLOWED_SLACK_USERS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

let busy = false;

const HELP_TEXT = `Hey there! I'm the *Worker Bot* — I create PM2 worker entries, commit them, and open a PR for you.

*Single worker:*
\`worker <org> <env> SENDER_ISA RECEIVER_ISA\`
\`worker <org> <env> --connection 42\`

*Multiple workers:*
\`workers <org> <env>\`
\`--connection 42\`
\`--connection 43\`
\`ABCD EFGH\`

*Options:*
  \`--test SENDER RECEIVER\` — different ISAs for the TEST worker
  \`--name my-carrier\` — custom worker name
  \`--branch RELEASE-v1\` — commit directly on this branch

*Org shortcuts:* medlog/med, universal/uni, forwardair/fa, us/portpro/pp
*Env shortcuts:* prod/production, sandbox/sand/pre

*Examples:*
  \`worker medlog prod ABCD EFGH\`
  \`worker uni sandbox --connection 42\`
  \`worker us prod --connection 24 --branch RELEASE-branch\`
  \`worker fa prod HUBG CSAC --name hubgroup\``;


const say = (channel: string, thread_ts: string, text: string) =>
  app.client.chat.postMessage({ channel, thread_ts, text });

app.event('app_mention', async ({ event, client }) => {
  const channel = event.channel;
  const ts = event.ts;

  try {
    if (ALLOWED_USERS.length > 0 && (!event.user || !ALLOWED_USERS.includes(event.user))) {
      await say(channel, ts, `You are not authorized to use this bot. Contact an admin to be added.`);
      return;
    }

    const cleaned = event.text.replace(/<@[A-Z0-9]+>/gi, '').trim().toLowerCase();
    if (/^(hi|hello|hey|sup|yo|greetings|howdy|what's up|help)\b/.test(cleaned)) {
      await say(channel, ts, HELP_TEXT);
      return;
    }

    if (busy) {
      await say(channel, ts, `Bot is currently processing another request. Please wait and try again.`);
      return;
    }
    busy = true;
    logger.info(`Parsing message: "${event.text}"`);
    const request = parseMessage(event.text);
    const mapping = getMapping(request.org, request.env);
    const baseBranch = mapping.branch;
    const configFile = mapping.file;
    logger.info(`Parsed: org=${request.org} env=${request.env} workers=${request.workers.length} file=${configFile} baseBranch=${baseBranch}${request.branch ? ` commitBranch=${request.branch}` : ''}`);

    await say(channel, ts, `Processing *${request.org} ${request.env}* worker request...`);

    // 1. Resolve all worker specs (fetch connections where needed)
    const resolved: ResolvedWorker[] = [];
    for (const spec of request.workers) {
      if (spec.connectionId != null) {
        logger.info(`Fetching connection ${spec.connectionId} from ${mapping.connectionApiUrl}`);
        await say(channel, ts, `Fetching connection ${spec.connectionId} from ${request.org} ${request.env} API...`);
        const conn = await fetchConnection(spec.connectionId, mapping.connectionApiUrl, mapping.connectionApiToken);
        const isas = extractISAs(conn);
        logger.info(`Connection ${spec.connectionId} resolved: live=${isas.liveISA.customerISA}.${isas.liveISA.companyISA} test=${isas.testISA.customerISA}.${isas.testISA.companyISA}`);
        resolved.push({ ...isas, name: spec.name });
      } else if (spec.liveISA && spec.testISA) {
        logger.info(`Direct ISAs: live=${spec.liveISA.customerISA}.${spec.liveISA.companyISA} test=${spec.testISA.customerISA}.${spec.testISA.companyISA}`);
        resolved.push({
          liveISA: spec.liveISA,
          testISA: spec.testISA,
          name: spec.name,
        });
      } else {
        logger.info(`Skipping invalid spec: ${JSON.stringify(spec)}`);
        await say(channel, ts, `Skipping invalid worker spec (no connection ID or ISAs).`);
      }
    }

    if (resolved.length === 0) {
      await say(channel, ts, `No valid worker specifications to process.`);
      return;
    }

    // 2. Prepare git: checkout and pull latest
    const checkoutBranch = request.branch ?? baseBranch;
    if (request.branch) {
      logger.info(`Checking if branch ${request.branch} exists on remote`);
      const exists = await branchExistsOnRemote(request.branch);
      if (!exists) {
        logger.info(`Branch ${request.branch} not found, creating from ${baseBranch}`);
        await say(channel, ts, `Branch \`${request.branch}\` not found — creating it from \`${baseBranch}\`...`);
        await ensureBranchExists(request.branch, baseBranch);
      }
    }
    logger.info(`Git: checking out ${checkoutBranch}`);
    await say(channel, ts, `Checking out branch \`${checkoutBranch}\` and pulling latest...`);
    await prepareBaseBranch(checkoutBranch);
    logger.info(`Git: branch ${checkoutBranch} ready`);

    // 3. Add workers to config file (with duplicate detection)
    const filePath = path.resolve(env.repoLocalPath, configFile);
    logger.info(`Adding workers to ${filePath}`);
    await say(channel, ts, `Adding workers to \`${configFile}\`...`);

    const results = addWorkersToFile({
      filePath,
      org: request.org,
      env: request.env,
      resolvedWorkers: resolved,
    });

    const created = results.filter(r => r.status === 'created');
    const duplicates = results.filter(r => r.status === 'duplicate');
    logger.info(`Workers: ${created.length} created, ${duplicates.length} duplicates`);

    if (created.length === 0) {
      await say(channel, ts, `Worker topic(s) already exist in \`${configFile}\`, no changes needed.\n${formatDuplicates(duplicates)}`);
      return;
    }

    // 4. Build commit info
    const isaLabel = resolved.length === 1
      ? `${resolved[0].liveISA.customerISA}-${resolved[0].liveISA.companyISA}`
      : `batch-${Date.now()}`;
    const isaList = created.map(r => {
      return r.topic.replace('EDI.', '').replace('.204_MOTOR_CARRIER_LOAD_TENDER.TEST', '').replace('.204_MOTOR_CARRIER_LOAD_TENDER.LIVE', '');
    });
    const uniqueISAs = [...new Set(isaList)].join(', ');
    const commitMsg = `Add ${request.org} ${request.env} worker(s)\n\nISAs: ${uniqueISAs}`;
    const prTitle = `[Worker] Add ${request.org} ${request.env} worker(s): ${isaLabel}`;
    const prBody = buildPRBody(request.org, request.env, configFile, results);

    let prUrl: string;

    if (request.branch) {
      // --branch mode: commit directly on the specified branch, PR to env base branch
      logger.info(`Committing and pushing to ${request.branch}`);
      await say(channel, ts, `Committing and pushing to \`${request.branch}\`...`);
      await commitAndPush(configFile, request.branch, commitMsg);
      logger.info(`Pushed to origin/${request.branch}`);

      const existingPR = await findOpenPR(request.branch, baseBranch);
      if (existingPR) {
        logger.info(`Found existing PR #${existingPR.number}, adding comment`);
        await say(channel, ts, `Found existing PR #${existingPR.number}, adding comment...`);
        await addPRComment(existingPR.number, prBody);
        prUrl = existingPR.html_url;
      } else {
        logger.info(`Creating PR: ${request.branch} -> ${baseBranch}`);
        await say(channel, ts, `Creating PR to \`${baseBranch}\`...`);
        prUrl = await createPullRequest(request.branch, baseBranch, prTitle, prBody);
        logger.info(`PR created: ${prUrl}`);
      }

      await cleanupLocalBranch(baseBranch, request.branch);
      logger.info(`Cleanup done, back on ${baseBranch}`);
    } else {
      // Default mode: create feature branch, PR to base branch
      const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const now = new Date();
      const dateSuffix = `${now.getDate()}-${months[now.getMonth()]}`;
      const baseBranchName = `worker/${request.org}-${isaLabel}-${dateSuffix}`.toLowerCase();
      const featureBranch = await resolveUniqueBranchName(baseBranchName);
      logger.info(`Feature branch: ${featureBranch}`);

      await createFeatureBranch(featureBranch);

      logger.info(`Committing and pushing: ${commitMsg}`);
      await say(channel, ts, `Committing and pushing to \`${featureBranch}\`...`);
      await commitAndPush(configFile, featureBranch, commitMsg);
      logger.info(`Pushed to origin/${featureBranch}`);

      logger.info(`Creating PR: ${featureBranch} -> ${baseBranch}`);
      await say(channel, ts, `Creating PR to \`${baseBranch}\`...`);
      prUrl = await createPullRequest(featureBranch, baseBranch, prTitle, prBody);
      logger.info(`PR created: ${prUrl}`);

      await cleanupLocalBranch(baseBranch, featureBranch);
      logger.info(`Cleanup done, back on ${baseBranch}`);
    }

    // 7. Report back — in thread, broadcast to channel, mention user
    const userMention = event.user ? `<@${event.user}>` : '';
    const summary = formatSummary(results, prUrl);
    await app.client.chat.postMessage({
      channel,
      thread_ts: ts,
      text: `${userMention} ${summary}`,
      reply_broadcast: true,
    });

  } catch (err: any) {
    let msg: string;
    if (err instanceof ParseError) {
      msg = `Parse error: ${err.message}`;
    } else if (isGitHubAuthError(err)) {
      msg = `:warning: *GitHub token is expired or invalid.* The bot cannot push code or create PRs until the token is replaced.`;
    } else {
      msg = `Something went wrong. Please check the request and try again.`;
    }
    await say(channel, ts, msg);
    logger.error('Worker bot error:', err);
    try { await resetLocalRepo(); } catch { /* best-effort cleanup */ }
  } finally {
    busy = false;
  }
});

function isGitHubAuthError(err: any): boolean {
  const isOctokitAuth =
    (err?.status === 401 || err?.status === 403) &&
    (err?.response?.url?.includes('github.com') || err?.documentation_url?.includes('github'));

  if (isOctokitAuth) return true;

  const message = (err?.message ?? '').toLowerCase();
  return (
    message.includes('bad credentials') ||
    message.includes('authentication failed for') && message.includes('github.com') ||
    message.includes('could not read username') ||
    /fatal:.*https:\/\/.*github\.com.*40[13]/.test(message)
  );
}

function formatSummary(results: WorkerResult[], prUrl: string): string {
  const lines = ['*Worker creation complete!*', ''];

  const created = results.filter(r => r.status === 'created');
  const duplicates = results.filter(r => r.status === 'duplicate');

  if (created.length > 0) {
    lines.push('*Created:*');
    for (const r of created) {
      lines.push(`  - \`${r.topic}\``);
    }
  }

  if (duplicates.length > 0) {
    lines.push('');
    lines.push('*Skipped (already exists):*');
    for (const r of duplicates) {
      lines.push(`  - \`${r.name}\` - \`${r.topic}\``);
    }
  }

  lines.push('');
  lines.push(`*PR:* ${prUrl}`);

  return lines.join('\n');
}

function formatDuplicates(duplicates: WorkerResult[]): string {
  return duplicates.map(r => `  - \`${r.topic}\``).join('\n');
}

function buildPRBody(org: string, environment: string, configFile: string, results: WorkerResult[]): string {
  const created = results.filter(r => r.status === 'created');

  const isaSet = new Set(created.map(r =>
    r.topic.replace('EDI.', '').replace('.204_MOTOR_CARRIER_LOAD_TENDER.TEST', '').replace('.204_MOTOR_CARRIER_LOAD_TENDER.LIVE', '')
  ));

  const lines = [
    `## Worker Addition - ${org} ${environment}`,
    '',
    `**Config file:** \`${configFile}\``,
    `**ISAs:** ${[...isaSet].join(', ')}`,
    '',
  ];

  return lines.join('\n');
}

(async () => {
  cleanOldLogs();
  setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);
  await app.start();
  logger.info('Slack Worker Bot is running!');
})();
