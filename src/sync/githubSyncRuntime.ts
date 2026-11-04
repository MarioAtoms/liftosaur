import { lb } from "lens-shmens";
import { IDispatch } from "../ducks/types";
import { IState, updateState } from "../models/state";
import { Dialog_confirm } from "../utils/dialog";
import { OfflineFork_isEnabled } from "../offlineFork";
import { GithubSync_withExpiry } from "./githubSyncErrors";
import { GithubSync_pull, GithubSync_push, IGithubSyncPushOutcome } from "./githubSyncRun";
import { GithubSyncSchedule_initial, GithubSyncSchedule_reduce, IGithubSyncSchedule } from "./githubSyncSchedule";
import {
  GithubSync_idbStore,
  GithubSyncStore_loadConfig,
  GithubSyncStore_loadState,
  GithubSyncStore_markDirty,
  GithubSyncStore_saveConfig,
  GithubSyncStore_saveState,
} from "./githubSyncStore";
import {
  IGithubSyncConfig,
  IGithubSyncDiskState,
  IGithubSyncNotice,
  IProgramChangeRequest,
  IProgramChangeResult,
  IProgramInboxPlan,
  IProgramInboxUpdate,
} from "./githubSyncTypes";
import { ProgramInbox_mergeResults, ProgramInbox_noticeItems, ProgramInbox_plan } from "./programInbox";

declare let __COMMIT_HASH__: string;

const listeners = new Set<() => void>();
let memory: IGithubSyncSchedule = GithubSyncSchedule_initial();
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let tail: Promise<void> = Promise.resolve();
let cachedConfig: IGithubSyncConfig | undefined;
let warnedExpiry: string | undefined;
let pushLater: (() => void) | undefined;

export function GithubSyncRuntime_subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function GithubSyncRuntime_setCachedConfig(config: IGithubSyncConfig): void {
  cachedConfig = config;
}

export function GithubSync_bannerText(notice: IGithubSyncNotice): string {
  return notice.items.map((item) => `${item.author} changed: ${item.summary}`).join("\n");
}

export async function GithubSyncRuntime_onEdit(dispatch: IDispatch, getState: () => IState): Promise<void> {
  if (!OfflineFork_isEnabled()) {
    return;
  }
  generation += 1;
  const config = await configOf();
  if (config.token.trim() === "") {
    return;
  }
  const now = Date.now();
  memory = GithubSyncSchedule_reduce(memory, "edit", now);
  await GithubSyncStore_markDirty(GithubSync_idbStore);
  rememberPush(dispatch, getState);
  arm(now);
}

export async function GithubSyncRuntime_flush(dispatch: IDispatch, getState: () => IState): Promise<void> {
  if (!OfflineFork_isEnabled()) {
    return;
  }
  const config = await configOf();
  if (config.token.trim() === "") {
    return;
  }
  const disk = await GithubSyncStore_loadState(GithubSync_idbStore);
  if (!memory.dirty && !disk.dirty) {
    return;
  }
  memory = { dirty: true, runAt: Date.now() };
  clearTimer();
  rememberPush(dispatch, getState);
  await enqueue(() => run(dispatch, getState, { pull: false, force: false }));
}

export function GithubSyncRuntime_open(dispatch: IDispatch, getState: () => IState, force: boolean): Promise<void> {
  if (!OfflineFork_isEnabled()) {
    emit();
    return Promise.resolve();
  }
  rememberPush(dispatch, getState);
  return enqueue(() => run(dispatch, getState, { pull: true, force }));
}

export function GithubSyncRuntime_undo(dispatch: IDispatch, getState: () => IState): void {
  const notice = getState().githubSyncNotice;
  if (notice == null || notice.items.length === 0) {
    return;
  }
  updateState(
    dispatch,
    [
      ...notice.items.map((item) =>
        lb<IState>()
          .p("storage")
          .p("programs")
          .findBy("id", item.programId)
          .pi("planner")
          .p("weeks")
          .record(item.previousWeeks)
      ),
      lb<IState>().p("githubSyncNotice").record(undefined),
    ],
    "Undo coach program change"
  );
}

async function run(
  dispatch: IDispatch,
  getState: () => IState,
  opts: { pull: boolean; force: boolean }
): Promise<void> {
  try {
    const config = await configOf();
    if (config.token.trim() === "") {
      return;
    }
    const client = pageFetch();
    if (client == null) {
      return;
    }
    let disk = await GithubSyncStore_loadState(GithubSync_idbStore);
    const now = new Date().toISOString();
    if (opts.pull) {
      const pulled = await pullAndApply(dispatch, getState, client, config, disk, now);
      if (pulled == null) {
        return;
      }
      disk = pulled;
    }
    const shouldPush = opts.force || disk.dirty || memory.dirty;
    if (!shouldPush) {
      return;
    }
    const seen = generation;
    const outcome = await GithubSync_push({
      client,
      store: GithubSync_idbStore,
      config: cachedConfig ?? config,
      disk: { ...disk, dirty: true },
      storage: getState().storage,
      deviceId: getState().deviceId,
      appCommit: appCommit(),
      now: new Date().toISOString(),
      nowMs: Date.now(),
      force: true,
    });
    cachedConfig = outcome.config;
    await finishPush(dispatch, outcome, seen, opts.force);
  } finally {
    emit();
  }
}

async function pullAndApply(
  dispatch: IDispatch,
  getState: () => IState,
  client: Window["fetch"],
  config: IGithubSyncConfig,
  disk: IGithubSyncDiskState,
  now: string
): Promise<IGithubSyncDiskState | undefined> {
  const pulled = await GithubSync_pull({ client, config, disk, storage: getState().storage, now });
  const configWithExpiry = GithubSync_withExpiry(config, pulled.expiresAt);
  if (configWithExpiry !== config) {
    await GithubSyncStore_saveConfig(GithubSync_idbStore, configWithExpiry);
    cachedConfig = configWithExpiry;
  }
  if (!pulled.ok || pulled.error != null) {
    const error = pulled.error ?? { code: "http" as const, message: "GitHub sync failed" };
    await saveError(disk, error.message);
    notify(dispatch, error.message);
    return undefined;
  }
  const decided = await decidePlan(getState, pulled.plan, now);
  if (decided.updates.length > 0) {
    dispatchApply(dispatch, decided.updates);
  }
  if (decided.results.length === 0 && decided.updates.length === 0) {
    return disk;
  }
  const appliedResults = ProgramInbox_mergeResults(pulled.mergedResults, decided.results);
  const next: IGithubSyncDiskState = {
    ...disk,
    dirty: true,
    appliedResults,
    appliedIds: appliedResults.map((result) => result.id),
  };
  memory = { ...memory, dirty: true };
  await GithubSyncStore_saveState(GithubSync_idbStore, next);
  return next;
}

async function decidePlan(getState: () => IState, plan: IProgramInboxPlan, now: string): Promise<IProgramInboxPlan> {
  if (plan.ready.length === 0) {
    return plan;
  }
  const accepted: IProgramChangeRequest[] = [];
  const declined: IProgramChangeResult[] = [];
  for (const request of plan.ready) {
    const ok = await Dialog_confirm(`${request.author} changed:\n${request.summary}\n\nApply this change?`);
    if (ok) {
      accepted.push(request);
    } else {
      declined.push({ id: request.id, status: "declined", at: now });
    }
  }
  const fresh = await ProgramInbox_plan(getState().storage, accepted, new Set(), { autoApply: true, now });
  return {
    updates: fresh.updates,
    ready: [],
    waiting: plan.waiting || fresh.waiting,
    results: plan.results.concat(declined, fresh.results),
  };
}

function dispatchApply(dispatch: IDispatch, updates: IProgramInboxUpdate[]): void {
  const notice: IGithubSyncNotice = {
    items: ProgramInbox_noticeItems(updates).map((update) => ({
      programId: update.programId,
      previousWeeks: update.previousWeeks,
      author: update.author,
      summary: update.summary,
      requestId: update.requestId,
    })),
  };
  updateState(
    dispatch,
    [
      ...updates.map((update) =>
        lb<IState>()
          .p("storage")
          .p("programs")
          .findBy("id", update.programId)
          .pi("planner")
          .p("weeks")
          .record(update.weeks)
      ),
      lb<IState>().p("githubSyncNotice").record(notice),
    ],
    "Apply coach program change"
  );
}

async function finishPush(
  dispatch: IDispatch,
  outcome: IGithubSyncPushOutcome,
  seen: number,
  force: boolean
): Promise<void> {
  if (outcome.ok && generation !== seen) {
    memory = GithubSyncSchedule_reduce(memory, "edit", Date.now());
    await GithubSyncStore_markDirty(GithubSync_idbStore);
    arm(Date.now());
  } else if (outcome.ok) {
    memory = GithubSyncSchedule_reduce(memory, "pushed", Date.now());
    clearTimer();
  } else {
    memory = GithubSyncSchedule_reduce(memory, "push-failed", Date.now());
    if (outcome.error && (outcome.error.code === "token" || outcome.error.code === "repo" || force)) {
      notify(dispatch, outcome.error.message);
    }
  }
  if (outcome.expiryWarning && warnedExpiry !== outcome.config.tokenExpiresAt) {
    warnedExpiry = outcome.config.tokenExpiresAt;
    notify(dispatch, outcome.expiryWarning);
  }
}

async function saveError(disk: IGithubSyncDiskState, message: string): Promise<void> {
  memory = { dirty: true };
  await GithubSyncStore_saveState(GithubSync_idbStore, {
    ...disk,
    dirty: true,
    lastStatus: "error",
    lastError: message,
  });
}

function notify(dispatch: IDispatch, content: string): void {
  updateState(dispatch, [lb<IState>().p("notification").record({ type: "error", content })], "GitHub sync status");
}

async function configOf(): Promise<IGithubSyncConfig> {
  if (cachedConfig == null) {
    cachedConfig = await GithubSyncStore_loadConfig(GithubSync_idbStore);
  }
  return cachedConfig;
}

function rememberPush(dispatch: IDispatch, getState: () => IState): void {
  pushLater = () => {
    enqueue(() => run(dispatch, getState, { pull: false, force: false })).catch(() => undefined);
  };
}

function arm(now: number): void {
  clearTimer();
  if (memory.runAt == null || pushLater == null) {
    return;
  }
  const delay = Math.max(0, memory.runAt - now);
  const fire = pushLater;
  timer = setTimeout(() => {
    timer = undefined;
    fire();
  }, delay);
}

function clearTimer(): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = undefined;
  }
}

function enqueue(job: () => Promise<void>): Promise<void> {
  const runJob = tail.then(job, job);
  tail = runJob.then(
    () => undefined,
    () => undefined
  );
  return runJob;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function pageFetch(): Window["fetch"] | undefined {
  if (typeof window === "undefined" || window.fetch == null) {
    return undefined;
  }
  return window.fetch.bind(window);
}

function appCommit(): string {
  return typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "unknown";
}
