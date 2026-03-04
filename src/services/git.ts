import simpleGit, { SimpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
import { env } from '../config';

const octokit = new Octokit({ auth: env.githubToken });
const owner = env.githubOwner;
const repo = env.githubRepo;

function git(): SimpleGit {
  return simpleGit(env.repoLocalPath);
}

export async function prepareBaseBranch(baseBranch: string): Promise<void> {
  const g = git();
  await g.fetch('origin');
  await g.checkout(baseBranch);
  await g.reset(['--hard', `origin/${baseBranch}`]);
}

export async function resolveUniqueBranchName(baseName: string): Promise<string> {
  const g = git();
  await g.fetch('origin');
  const remotes = await g.branch(['-r']);
  const remoteNames = new Set(remotes.all.map(b => b.replace(/^origin\//, '')));

  let candidate = baseName;
  let version = 2;
  while (remoteNames.has(candidate)) {
    candidate = `${baseName}-v${version}`;
    version++;
  }
  return candidate;
}

export async function createFeatureBranch(branchName: string): Promise<void> {
  const g = git();
  const branches = await g.branchLocal();
  if (branches.all.includes(branchName)) {
    await g.deleteLocalBranch(branchName, true);
  }
  await g.checkoutLocalBranch(branchName);
}

export async function commitAndPush(
  configFile: string,
  featureBranch: string,
  commitMessage: string,
): Promise<void> {
  const g = git();
  await g.add(configFile);
  await g.commit(commitMessage);
  await g.push('origin', featureBranch, ['--set-upstream']);
}

export async function ensureBranchExists(
  targetBranch: string,
  fallbackBaseBranch: string,
): Promise<void> {
  try {
    await octokit.rest.repos.getBranch({ owner, repo, branch: targetBranch });
  } catch (err: any) {
    if (err.status === 404) {
      const { data: baseBranchData } = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: fallbackBaseBranch,
      });
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${targetBranch}`,
        sha: baseBranchData.commit.sha,
      });
    } else {
      throw err;
    }
  }
}

export async function createPullRequest(
  featureBranch: string,
  targetBranch: string,
  title: string,
  body: string,
): Promise<string> {
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: featureBranch,
    base: targetBranch,
  });
  return pr.html_url;
}

export async function cleanupLocalBranch(baseBranch: string, featureBranch: string): Promise<void> {
  const g = git();
  await g.checkout(baseBranch);
  try {
    await g.deleteLocalBranch(featureBranch, true);
  } catch {
    // branch might not exist locally, ignore
  }
}

export async function resetLocalRepo(): Promise<void> {
  const g = git();
  await g.reset(['--hard']);
  await g.clean('f', ['-d']);
}
