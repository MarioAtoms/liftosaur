import { Stats_getEmpty } from "../models/stats";
import { PlannerProgram_generateFullText } from "../pages/planner/models/plannerProgram";
import { IStorage } from "../types";
import { GithubSync_sha256Hex } from "./githubSyncCodec";
import { IGithubSyncMeta, IGithubSyncProgramMeta } from "./githubSyncTypes";

export function Snapshot_storageForUpload(storage: IStorage, includeBodyStats: boolean): IStorage {
  if (includeBodyStats) {
    return storage;
  }
  return {
    ...storage,
    stats: Stats_getEmpty(),
    deletedStats: [],
  };
}

export async function Snapshot_programMeta(storage: IStorage): Promise<{
  current: IGithubSyncProgramMeta | undefined;
  programs: IGithubSyncProgramMeta[];
}> {
  const programs: IGithubSyncProgramMeta[] = [];
  for (const program of storage.programs) {
    if (program.planner == null) {
      continue;
    }
    const programText = PlannerProgram_generateFullText(program.planner.weeks);
    programs.push({
      id: program.id,
      name: program.name,
      programText,
      programTextSha256: await GithubSync_sha256Hex(programText),
    });
  }
  const current =
    storage.currentProgramId == null
      ? programs[0]
      : programs.find((program) => program.id === storage.currentProgramId);
  return { current, programs };
}

export async function Snapshot_build(args: {
  storage: IStorage;
  includeBodyStats: boolean;
  deviceId: string;
  appCommit: string;
  pushedAt: string;
}): Promise<{ storageJson: string; metaJson: string; meta: IGithubSyncMeta }> {
  const uploaded = Snapshot_storageForUpload(args.storage, args.includeBodyStats);
  const { current, programs } = await Snapshot_programMeta(args.storage);
  const meta: IGithubSyncMeta = {
    pushedAt: args.pushedAt,
    appCommit: args.appCommit,
    storageVersion: args.storage.version,
    historyCount: args.storage.history.length,
    deviceId: args.deviceId,
    programId: current?.id,
    programName: current?.name ?? "",
    programText: current?.programText ?? "",
    programTextSha256: current?.programTextSha256 ?? (await GithubSync_sha256Hex("")),
    programs,
  };
  return {
    storageJson: JSON.stringify(uploaded, null, 2),
    metaJson: JSON.stringify(meta, null, 2),
    meta,
  };
}
