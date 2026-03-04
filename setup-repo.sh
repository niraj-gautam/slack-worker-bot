#!/bin/sh
REPO_DIR="${REPO_LOCAL_PATH:-./repo-workspace}"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[setup] Cloning repo into $REPO_DIR ..."
  git clone "https://${GITHUB_TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git" "$REPO_DIR"
else
  echo "[setup] Repo exists, fetching latest..."
  cd "$REPO_DIR" && git fetch origin && cd -
fi

cd "$REPO_DIR"
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git"
git config user.email "worker-bot@portpro.io"
git config user.name "Worker Bot"
cd -

echo "[setup] Repo ready."
