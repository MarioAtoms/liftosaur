import { GITHUB_SYNC_DEBOUNCE_MS } from "./githubSyncTypes";

export interface IGithubSyncSchedule {
  dirty: boolean;
  runAt?: number;
}

export type IGithubSyncScheduleEvent = "edit" | "flush" | "pushed" | "push-failed";

export function GithubSyncSchedule_initial(): IGithubSyncSchedule {
  return { dirty: false };
}

export function GithubSyncSchedule_reduce(
  state: IGithubSyncSchedule,
  event: IGithubSyncScheduleEvent,
  now: number
): IGithubSyncSchedule {
  if (event === "edit") {
    return { dirty: true, runAt: now + GITHUB_SYNC_DEBOUNCE_MS };
  }
  if (event === "flush") {
    if (!state.dirty) {
      return state;
    }
    return { dirty: true, runAt: now };
  }
  if (event === "pushed") {
    return { dirty: false };
  }
  return { dirty: true };
}
