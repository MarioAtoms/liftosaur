import { IPlannerProgramWeek } from "../types";

export const GITHUB_SYNC_DEFAULT_REPO = "MarioAtoms/mario-lift-data";
export const GITHUB_SYNC_CONFIG_KEY = "mariolift_github_sync";
export const GITHUB_SYNC_STATE_KEY = "mariolift_sync_state";
export const GITHUB_SYNC_DEBOUNCE_MS = 5000;
export const GITHUB_SYNC_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

export const GITHUB_SYNC_PATHS = {
  storage: "snapshot/storage.json",
  meta: "snapshot/meta.json",
  inbox: "inbox/program-changes.json",
  applied: "outbox/applied.json",
} as const;

export const GITHUB_SYNC_TOKEN_ERROR = "Token expired or revoked";
export const GITHUB_SYNC_REPO_ERROR = "Token can't reach repo";
export const GITHUB_SYNC_OFFLINE_ERROR = "Offline. Will retry when online.";

export interface IGithubRepo {
  owner: string;
  name: string;
}

export interface IGithubSyncConfig {
  repo: string;
  token: string;
  autoApply: boolean;
  includeBodyStats: boolean;
  tokenExpiresAt?: string;
}

export type IProgramChangeStatus = "applied" | "conflict" | "rejected" | "declined";

export interface IProgramChangeRequest {
  id: string;
  createdAt?: string;
  author: string;
  programId: string;
  baseTextSha256: string;
  newText: string;
  summary: string;
  mode?: string;
}

export interface IProgramChangeResult {
  id: string;
  status: IProgramChangeStatus;
  at: string;
  reason?: string;
}

export interface IGithubSyncDiskState {
  dirty: boolean;
  lastSha: Record<string, string>;
  lastPushAt?: string;
  lastStatus?: "ok" | "error";
  lastError?: string;
  appliedIds: string[];
  appliedResults: IProgramChangeResult[];
}

export interface IGithubSyncProgramMeta {
  id: string;
  name: string;
  programText: string;
  programTextSha256: string;
}

export interface IGithubSyncMeta {
  pushedAt: string;
  appCommit: string;
  storageVersion: string;
  historyCount: number;
  deviceId: string;
  programId?: string;
  programName: string;
  programText: string;
  programTextSha256: string;
  programs: IGithubSyncProgramMeta[];
}

export interface IProgramInboxUpdate {
  requestId: string;
  programId: string;
  author: string;
  summary: string;
  weeks: IPlannerProgramWeek[];
  previousWeeks: IPlannerProgramWeek[];
}

export interface IProgramInboxPlan {
  results: IProgramChangeResult[];
  updates: IProgramInboxUpdate[];
  ready: IProgramChangeRequest[];
  waiting: boolean;
}

export interface IGithubSyncUndoItem {
  programId: string;
  previousWeeks: IPlannerProgramWeek[];
  author: string;
  summary: string;
  requestId: string;
}

export interface IGithubSyncNotice {
  items: IGithubSyncUndoItem[];
}

export type IGithubSyncFailureCode = "token" | "repo" | "offline" | "http";

export interface IGithubSyncFailure {
  code: IGithubSyncFailureCode;
  message: string;
  status?: number;
}

export interface IKeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value?: string): Promise<void>;
  remove(key: string): Promise<void>;
}
