import { IStorage } from "../types";
import { GithubClient_getFile, GithubClient_putFile, IGithubGetFile, IGithubPutFile } from "./githubClient";
import { GithubSync_expiryWarning, GithubSync_parseRepo, GithubSync_withExpiry } from "./githubSyncErrors";
import {
  GITHUB_SYNC_PATHS,
  IGithubSyncConfig,
  IGithubSyncDiskState,
  IGithubSyncFailure,
  IKeyValueStore,
  IProgramChangeResult,
  IProgramInboxPlan,
} from "./githubSyncTypes";
import {
  ProgramInbox_mergeResults,
  ProgramInbox_parse,
  ProgramInbox_parseApplied,
  ProgramInbox_plan,
} from "./programInbox";
import { Snapshot_build } from "./snapshot";
import { GithubSyncStore_saveConfig, GithubSyncStore_saveState } from "./githubSyncStore";

export interface IGithubSyncPushOutcome {
  ok: boolean;
  disk: IGithubSyncDiskState;
  config: IGithubSyncConfig;
  error?: IGithubSyncFailure;
  expiryWarning?: string;
}

export interface IGithubSyncPullOutcome {
  ok: boolean;
  plan: IProgramInboxPlan;
  mergedResults: IProgramChangeResult[];
  expiresAt?: string;
  error?: IGithubSyncFailure;
}

const emptyPlan = (): IProgramInboxPlan => ({ results: [], updates: [], ready: [], waiting: false });

export async function GithubSync_pull(args: {
  client: Window["fetch"];
  config: IGithubSyncConfig;
  disk: IGithubSyncDiskState;
  storage: IStorage;
  now: string;
}): Promise<IGithubSyncPullOutcome> {
  const repo = GithubSync_parseRepo(args.config.repo);
  if (repo == null) {
    return { ok: false, plan: emptyPlan(), mergedResults: args.disk.appliedResults, error: repoError() };
  }
  const inbox = await GithubClient_getFile(args.client, repo, args.config.token, GITHUB_SYNC_PATHS.inbox);
  if (!inbox.ok && !inbox.missing) {
    return {
      ok: false,
      plan: emptyPlan(),
      mergedResults: args.disk.appliedResults,
      error: inbox.error,
      expiresAt: inbox.expiresAt,
    };
  }
  const appliedFile = await GithubClient_getFile(args.client, repo, args.config.token, GITHUB_SYNC_PATHS.applied);
  if (!appliedFile.ok && !appliedFile.missing) {
    return {
      ok: false,
      plan: emptyPlan(),
      mergedResults: args.disk.appliedResults,
      error: appliedFile.error,
      expiresAt: appliedFile.expiresAt ?? readExpiry(inbox),
    };
  }
  const requests = inbox.ok && inbox.text.trim() !== "" ? ProgramInbox_parse(inbox.text) : [];
  if (requests == null) {
    return {
      ok: false,
      plan: emptyPlan(),
      mergedResults: args.disk.appliedResults,
      error: { code: "http", message: "inbox/program-changes.json is not valid JSON" },
      expiresAt: readExpiry(inbox) ?? readExpiry(appliedFile),
    };
  }
  const remoteResults = appliedFile.ok ? ProgramInbox_parseApplied(appliedFile.text) : [];
  const mergedResults = ProgramInbox_mergeResults(remoteResults, args.disk.appliedResults);
  const appliedIds = new Set(mergedResults.map((result) => result.id).concat(args.disk.appliedIds));
  const plan = await ProgramInbox_plan(args.storage, requests, appliedIds, {
    autoApply: args.config.autoApply,
    now: args.now,
  });
  return {
    ok: true,
    plan,
    mergedResults,
    expiresAt: readExpiry(inbox) ?? readExpiry(appliedFile),
  };
}

export async function GithubSync_push(args: {
  client: Window["fetch"];
  store: IKeyValueStore;
  config: IGithubSyncConfig;
  disk: IGithubSyncDiskState;
  storage: IStorage;
  deviceId: string;
  appCommit: string;
  now: string;
  nowMs: number;
  force?: boolean;
}): Promise<IGithubSyncPushOutcome> {
  if (!args.disk.dirty && !args.force) {
    return { ok: true, disk: args.disk, config: args.config };
  }
  const repo = GithubSync_parseRepo(args.config.repo);
  if (repo == null) {
    return failPush(args, args.disk, args.config, repoError());
  }
  const snapshot = await Snapshot_build({
    storage: args.storage,
    includeBodyStats: args.config.includeBodyStats,
    deviceId: args.deviceId,
    appCommit: args.appCommit,
    pushedAt: args.now,
  });
  const appliedRead = await GithubClient_getFile(args.client, repo, args.config.token, GITHUB_SYNC_PATHS.applied);
  if (!appliedRead.ok && !appliedRead.missing) {
    return failPush(
      args,
      args.disk,
      GithubSync_withExpiry(args.config, appliedRead.expiresAt),
      appliedRead.error,
      appliedRead.expiresAt
    );
  }
  const remoteResults = appliedRead.ok ? ProgramInbox_parseApplied(appliedRead.text) : [];
  const appliedResults = ProgramInbox_mergeResults(remoteResults, args.disk.appliedResults);
  const appliedJson = JSON.stringify({ results: appliedResults }, null, 2);
  const files = [
    { path: GITHUB_SYNC_PATHS.storage, text: snapshot.storageJson, message: "Strength and Honor backup" },
    { path: GITHUB_SYNC_PATHS.meta, text: snapshot.metaJson, message: "Strength and Honor backup meta" },
    { path: GITHUB_SYNC_PATHS.applied, text: appliedJson, message: "Strength and Honor coach results" },
  ];
  const lastSha = { ...args.disk.lastSha };
  let config = GithubSync_withExpiry(args.config, readExpiry(appliedRead));
  for (const file of files) {
    const put = await putWithRetry(
      args.client,
      repo,
      args.config.token,
      file.path,
      file.text,
      file.message,
      lastSha[file.path]
    );
    config = GithubSync_withExpiry(config, put.expiresAt);
    if (!put.ok) {
      const disk = diskAfter(args.disk, lastSha, appliedResults, false, args.now, put.error.message);
      return failPush(args, disk, config, put.error, put.expiresAt);
    }
    if (put.sha != null) {
      lastSha[file.path] = put.sha;
    }
  }
  const disk = diskAfter(args.disk, lastSha, appliedResults, true, args.now);
  await GithubSyncStore_saveConfig(args.store, config);
  await GithubSyncStore_saveState(args.store, disk);
  return {
    ok: true,
    disk,
    config,
    expiryWarning: GithubSync_expiryWarning(config.tokenExpiresAt, args.nowMs),
  };
}

async function putWithRetry(
  client: Window["fetch"],
  repo: NonNullable<ReturnType<typeof GithubSync_parseRepo>>,
  token: string,
  path: string,
  text: string,
  message: string,
  sha?: string
): Promise<IGithubPutFile> {
  const first = await GithubClient_putFile(client, repo, token, path, text, message, sha);
  if (first.ok || (first.error.status !== 409 && first.error.status !== 422)) {
    return first;
  }
  const current = await GithubClient_getFile(client, repo, token, path);
  if (!current.ok && !current.missing) {
    return { ok: false, error: current.error, expiresAt: current.expiresAt ?? first.expiresAt };
  }
  const nextSha = current.ok ? current.sha : undefined;
  const second = await GithubClient_putFile(client, repo, token, path, text, message, nextSha);
  return { ...second, expiresAt: second.expiresAt ?? current.expiresAt ?? first.expiresAt };
}

function diskAfter(
  disk: IGithubSyncDiskState,
  lastSha: Record<string, string>,
  appliedResults: IProgramChangeResult[],
  ok: boolean,
  now: string,
  error?: string
): IGithubSyncDiskState {
  return {
    ...disk,
    dirty: !ok,
    lastSha,
    lastPushAt: ok ? now : disk.lastPushAt,
    lastStatus: ok ? "ok" : "error",
    lastError: ok ? undefined : error,
    appliedResults,
    appliedIds: appliedResults.map((result) => result.id),
  };
}

async function failPush(
  args: { store: IKeyValueStore; nowMs: number },
  disk: IGithubSyncDiskState,
  config: IGithubSyncConfig,
  error: IGithubSyncFailure,
  expiresAt?: string
): Promise<IGithubSyncPushOutcome> {
  const nextConfig = GithubSync_withExpiry(config, expiresAt);
  const nextDisk = { ...disk, dirty: true, lastStatus: "error" as const, lastError: error.message };
  await GithubSyncStore_saveConfig(args.store, nextConfig);
  await GithubSyncStore_saveState(args.store, nextDisk);
  return {
    ok: false,
    disk: nextDisk,
    config: nextConfig,
    error,
    expiryWarning: GithubSync_expiryWarning(nextConfig.tokenExpiresAt, args.nowMs),
  };
}

function repoError(): IGithubSyncFailure {
  return { code: "repo", message: "Repo should look like owner/name" };
}

function readExpiry(result: IGithubGetFile): string | undefined {
  return result.expiresAt;
}
