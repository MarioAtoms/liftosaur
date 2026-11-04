import { IThunk } from "../ducks/types";
import {
  GithubSyncRuntime_flush,
  GithubSyncRuntime_onEdit,
  GithubSyncRuntime_open,
  GithubSyncRuntime_undo,
} from "./githubSyncRuntime";

export function Thunk_githubSyncSchedule(): IThunk {
  return async (dispatch, getState) => {
    await GithubSyncRuntime_onEdit(dispatch, getState);
  };
}

export function Thunk_githubSyncFlush(): IThunk {
  return async (dispatch, getState) => {
    await GithubSyncRuntime_flush(dispatch, getState);
  };
}

export function Thunk_githubSyncOpen(): IThunk {
  return async (dispatch, getState) => {
    await GithubSyncRuntime_open(dispatch, getState, false);
  };
}

export function Thunk_githubSyncNow(): IThunk {
  return async (dispatch, getState) => {
    await GithubSyncRuntime_open(dispatch, getState, true);
  };
}

export function Thunk_githubSyncUndo(): IThunk {
  return async (dispatch, getState) => {
    GithubSyncRuntime_undo(dispatch, getState);
  };
}
