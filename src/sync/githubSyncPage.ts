import { IDispatch } from "../ducks/types";
import { OfflineFork_isEnabled } from "../offlineFork";
import { Thunk_githubSyncFlush, Thunk_githubSyncOpen } from "./thunks";

export function GithubSync_bindPage(dispatch: IDispatch): () => void {
  if (!OfflineFork_isEnabled() || typeof window === "undefined") {
    return () => undefined;
  }
  const onOnline = (): void => {
    dispatch(Thunk_githubSyncFlush());
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      dispatch(Thunk_githubSyncFlush());
    } else if (document.visibilityState === "visible") {
      dispatch(Thunk_githubSyncOpen());
    }
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
  dispatch(Thunk_githubSyncOpen());
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
