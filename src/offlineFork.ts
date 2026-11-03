declare let __OFFLINE_FORK__: boolean;

export function OfflineFork_isEnabled(): boolean {
  return typeof __OFFLINE_FORK__ !== "undefined" && __OFFLINE_FORK__ === true;
}
