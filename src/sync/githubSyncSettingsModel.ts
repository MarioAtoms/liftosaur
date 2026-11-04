import { GithubClient_getRepo } from "./githubClient";
import { GithubSync_expiryWarning, GithubSync_parseRepo, GithubSync_withExpiry } from "./githubSyncErrors";
import { GithubSyncRuntime_setCachedConfig } from "./githubSyncRuntime";
import {
  GithubSyncStore_emptyConfig,
  GithubSyncStore_loadConfig,
  GithubSyncStore_markDirty,
  GithubSyncStore_saveConfig,
} from "./githubSyncStore";
import { GITHUB_SYNC_DEFAULT_REPO, IGithubSyncConfig, IGithubSyncDiskState, IKeyValueStore } from "./githubSyncTypes";

export interface IGithubSyncSettingsView {
  repo: string;
  hasToken: boolean;
  autoApply: boolean;
  includeBodyStats: boolean;
  lastPushLabel: string;
  expiryLabel: string;
  expiryWarning?: string;
}

export interface IGithubSyncDraft {
  repo: string;
  token: string;
  autoApply: boolean;
  includeBodyStats: boolean;
}

export function GithubSyncSettings_view(
  config: IGithubSyncConfig,
  disk: IGithubSyncDiskState,
  now: number
): IGithubSyncSettingsView {
  const hasToken = config.token.trim() !== "";
  const expiryWarning = GithubSync_expiryWarning(config.tokenExpiresAt, now);
  let lastPushLabel = "No backup yet";
  if (disk.lastStatus === "error" && disk.lastError) {
    lastPushLabel = disk.lastError;
  } else if (disk.lastPushAt != null) {
    lastPushLabel = `Last backup ${disk.lastPushAt}`;
  }
  let expiryLabel = "No token";
  if (hasToken && config.tokenExpiresAt != null) {
    expiryLabel = `Expires ${config.tokenExpiresAt}`;
  } else if (hasToken) {
    expiryLabel = "Expiry unknown until the next sync";
  }
  return {
    repo: config.repo,
    hasToken,
    autoApply: config.autoApply,
    includeBodyStats: config.includeBodyStats,
    lastPushLabel,
    expiryLabel,
    expiryWarning,
  };
}

export async function GithubSyncSettings_saveDraft(
  store: IKeyValueStore,
  draft: IGithubSyncDraft
): Promise<IGithubSyncConfig> {
  const current = await GithubSyncStore_loadConfig(store);
  const token = draft.token.trim() !== "" ? draft.token.trim() : current.token;
  const repo = draft.repo.trim() !== "" ? draft.repo.trim() : GITHUB_SYNC_DEFAULT_REPO;
  const next: IGithubSyncConfig = {
    ...current,
    repo,
    token,
    autoApply: draft.autoApply,
    includeBodyStats: draft.includeBodyStats,
  };
  if (token !== current.token) {
    next.tokenExpiresAt = undefined;
  }
  await GithubSyncStore_saveConfig(store, next);
  GithubSyncRuntime_setCachedConfig(next);
  if (
    next.token.trim() !== "" &&
    (next.token !== current.token || next.repo !== current.repo || next.includeBodyStats !== current.includeBodyStats)
  ) {
    await GithubSyncStore_markDirty(store);
  }
  return next;
}

export async function GithubSyncSettings_forgetToken(store: IKeyValueStore): Promise<IGithubSyncConfig> {
  const current = await GithubSyncStore_loadConfig(store);
  const next: IGithubSyncConfig = { ...current, token: "", tokenExpiresAt: undefined };
  await GithubSyncStore_saveConfig(store, next);
  GithubSyncRuntime_setCachedConfig(next);
  return next;
}

export async function GithubSyncSettings_test(client: Window["fetch"], store: IKeyValueStore): Promise<string> {
  const config = await GithubSyncStore_loadConfig(store);
  if (config.token.trim() === "") {
    return "Paste a token first";
  }
  const repo = GithubSync_parseRepo(config.repo);
  if (repo == null) {
    return "Repo should look like owner/name";
  }
  const result = await GithubClient_getRepo(client, repo, config.token);
  const next = GithubSync_withExpiry(config, result.expiresAt);
  if (next !== config) {
    await GithubSyncStore_saveConfig(store, next);
    GithubSyncRuntime_setCachedConfig(next);
  }
  if (!result.ok) {
    return result.error.message;
  }
  return GithubSync_expiryWarning(next.tokenExpiresAt, Date.now()) ?? "Connected";
}

export function GithubSyncSettings_emptyConfig(): IGithubSyncConfig {
  return GithubSyncStore_emptyConfig();
}
