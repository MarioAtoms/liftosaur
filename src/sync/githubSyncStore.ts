import { IndexedDBUtils_get, IndexedDBUtils_remove, IndexedDBUtils_set } from "../utils/indexeddb";
import {
  GITHUB_SYNC_CONFIG_KEY,
  GITHUB_SYNC_DEFAULT_REPO,
  GITHUB_SYNC_STATE_KEY,
  IGithubSyncConfig,
  IGithubSyncDiskState,
  IKeyValueStore,
  IProgramChangeResult,
  IProgramChangeStatus,
} from "./githubSyncTypes";

export const GithubSync_idbStore: IKeyValueStore = {
  get: (key) => IndexedDBUtils_get(key),
  set: (key, value) => IndexedDBUtils_set(key, value),
  remove: (key) => IndexedDBUtils_remove(key),
};

export function GithubSyncStore_emptyConfig(): IGithubSyncConfig {
  return {
    repo: GITHUB_SYNC_DEFAULT_REPO,
    token: "",
    autoApply: true,
    includeBodyStats: false,
  };
}

export function GithubSyncStore_emptyState(): IGithubSyncDiskState {
  return {
    dirty: false,
    lastSha: {},
    appliedIds: [],
    appliedResults: [],
  };
}

export function GithubSyncStore_parseConfig(raw: unknown): IGithubSyncConfig {
  const empty = GithubSyncStore_emptyConfig();
  const parsed = parseObject(raw);
  if (parsed == null) {
    return empty;
  }
  const repo = typeof parsed.repo === "string" && parsed.repo.trim() !== "" ? parsed.repo.trim() : empty.repo;
  const token = typeof parsed.token === "string" ? parsed.token : "";
  const tokenExpiresAt = typeof parsed.tokenExpiresAt === "string" ? parsed.tokenExpiresAt : undefined;
  return {
    repo,
    token,
    autoApply: parsed.autoApply !== false,
    includeBodyStats: parsed.includeBodyStats === true,
    tokenExpiresAt,
  };
}

function isStatus(value: unknown): value is IProgramChangeStatus {
  return value === "applied" || value === "conflict" || value === "rejected" || value === "declined";
}

function parseResult(value: unknown): IProgramChangeResult | undefined {
  if (value == null || typeof value !== "object") {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id === "" || !isStatus(row.status) || typeof row.at !== "string") {
    return undefined;
  }
  const reason = typeof row.reason === "string" ? row.reason : undefined;
  return { id: row.id, status: row.status, at: row.at, reason };
}

export function GithubSyncStore_parseState(raw: unknown): IGithubSyncDiskState {
  const empty = GithubSyncStore_emptyState();
  const parsed = parseObject(raw);
  if (parsed == null) {
    return empty;
  }
  const lastSha: Record<string, string> = {};
  if (parsed.lastSha != null && typeof parsed.lastSha === "object") {
    for (const [key, value] of Object.entries(parsed.lastSha as Record<string, unknown>)) {
      if (typeof value === "string") {
        lastSha[key] = value;
      }
    }
  }
  const appliedResults = Array.isArray(parsed.appliedResults)
    ? parsed.appliedResults.map(parseResult).filter((result): result is IProgramChangeResult => result != null)
    : [];
  const appliedIds = Array.isArray(parsed.appliedIds)
    ? parsed.appliedIds.filter((id): id is string => typeof id === "string" && id !== "")
    : appliedResults.map((result) => result.id);
  return {
    dirty: parsed.dirty === true,
    lastSha,
    lastPushAt: typeof parsed.lastPushAt === "string" ? parsed.lastPushAt : undefined,
    lastStatus: parsed.lastStatus === "ok" || parsed.lastStatus === "error" ? parsed.lastStatus : undefined,
    lastError: typeof parsed.lastError === "string" ? parsed.lastError : undefined,
    appliedIds,
    appliedResults,
  };
}

function parseObject(raw: unknown): Record<string, unknown> | undefined {
  const text = typeof raw === "string" ? raw : undefined;
  if (text == null || text === "") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed != null && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function GithubSyncStore_loadConfig(store: IKeyValueStore): Promise<IGithubSyncConfig> {
  return GithubSyncStore_parseConfig(await store.get(GITHUB_SYNC_CONFIG_KEY));
}

export async function GithubSyncStore_saveConfig(store: IKeyValueStore, config: IGithubSyncConfig): Promise<void> {
  await store.set(GITHUB_SYNC_CONFIG_KEY, JSON.stringify(config));
}

export async function GithubSyncStore_loadState(store: IKeyValueStore): Promise<IGithubSyncDiskState> {
  return GithubSyncStore_parseState(await store.get(GITHUB_SYNC_STATE_KEY));
}

export async function GithubSyncStore_saveState(store: IKeyValueStore, state: IGithubSyncDiskState): Promise<void> {
  const { appliedResults, appliedIds, ...rest } = state;
  const saved: IGithubSyncDiskState = {
    ...rest,
    appliedIds,
    appliedResults,
  };
  await store.set(GITHUB_SYNC_STATE_KEY, JSON.stringify(saved));
}

export async function GithubSyncStore_markDirty(store: IKeyValueStore): Promise<IGithubSyncDiskState> {
  const state = await GithubSyncStore_loadState(store);
  if (state.dirty) {
    return state;
  }
  const next = { ...state, dirty: true };
  await GithubSyncStore_saveState(store, next);
  return next;
}
