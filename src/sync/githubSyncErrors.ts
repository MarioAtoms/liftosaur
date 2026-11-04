import {
  GITHUB_SYNC_EXPIRY_WARNING_MS,
  GITHUB_SYNC_OFFLINE_ERROR,
  GITHUB_SYNC_REPO_ERROR,
  GITHUB_SYNC_TOKEN_ERROR,
  IGithubRepo,
  IGithubSyncFailure,
} from "./githubSyncTypes";

export function GithubSync_parseRepo(repo: string): IGithubRepo | undefined {
  const match = repo.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (match == null) {
    return undefined;
  }
  return { owner: match[1], name: match[2] };
}

export function GithubSync_failureFromStatus(status: number): IGithubSyncFailure {
  if (status === 401) {
    return { code: "token", message: GITHUB_SYNC_TOKEN_ERROR, status };
  }
  if (status === 403 || status === 404) {
    return { code: "repo", message: GITHUB_SYNC_REPO_ERROR, status };
  }
  return { code: "http", message: `GitHub sync failed (${status})`, status };
}

export function GithubSync_offlineFailure(): IGithubSyncFailure {
  return { code: "offline", message: GITHUB_SYNC_OFFLINE_ERROR };
}

export function GithubSync_expiryWarning(expiresAt: string | undefined, now: number): string | undefined {
  if (expiresAt == null || expiresAt === "") {
    return undefined;
  }
  const time = Date.parse(expiresAt);
  if (Number.isNaN(time)) {
    return undefined;
  }
  const left = time - now;
  if (left <= 0 || left > GITHUB_SYNC_EXPIRY_WARNING_MS) {
    return undefined;
  }
  const days = Math.ceil(left / (24 * 60 * 60 * 1000));
  if (days <= 1) {
    return "Token expires in 1 day";
  }
  return `Token expires in ${days} days`;
}

export function GithubSync_withExpiry<T extends { tokenExpiresAt?: string }>(config: T, expiresAt?: string): T {
  if (expiresAt == null || expiresAt === "" || expiresAt === config.tokenExpiresAt) {
    return config;
  }
  return { ...config, tokenExpiresAt: expiresAt };
}
