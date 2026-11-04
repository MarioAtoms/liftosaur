import { PlannerProgram_generateFullText, PlannerProgram_parseText } from "../pages/planner/models/plannerProgram";
import { IPlannerProgramWeek, IStorage } from "../types";
import { GithubSync_sha256Hex } from "./githubSyncCodec";
import { IProgramChangeRequest, IProgramChangeResult, IProgramInboxPlan, IProgramInboxUpdate } from "./githubSyncTypes";

export function ProgramInbox_parse(text: string): IProgramChangeRequest[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed == null || typeof parsed !== "object") {
    return [];
  }
  const requests = (parsed as { requests?: unknown }).requests;
  if (requests == null) {
    return [];
  }
  if (!Array.isArray(requests)) {
    return undefined;
  }
  return requests.filter(isRequest);
}

export function ProgramInbox_parseApplied(text: string): IProgramChangeResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (parsed == null || typeof parsed !== "object") {
    return [];
  }
  const results = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results.filter(isResult);
}

export function ProgramInbox_mergeResults(
  remote: IProgramChangeResult[],
  local: IProgramChangeResult[]
): IProgramChangeResult[] {
  const byId = new Map<string, IProgramChangeResult>();
  for (const result of remote) {
    byId.set(result.id, result);
  }
  for (const result of local) {
    byId.set(result.id, result);
  }
  return [...byId.values()];
}

export function ProgramInbox_withUpdates(storage: IStorage, updates: IProgramInboxUpdate[]): IStorage {
  if (updates.length === 0) {
    return storage;
  }
  const weeksById = new Map<string, IPlannerProgramWeek[]>();
  for (const update of updates) {
    weeksById.set(update.programId, update.weeks);
  }
  return {
    ...storage,
    programs: storage.programs.map((program) => {
      const weeks = weeksById.get(program.id);
      if (weeks == null || program.planner == null) {
        return program;
      }
      return { ...program, planner: { ...program.planner, weeks } };
    }),
  };
}

export async function ProgramInbox_plan(
  storage: IStorage,
  requests: IProgramChangeRequest[],
  appliedIds: ReadonlySet<string>,
  options: { autoApply: boolean; now: string }
): Promise<IProgramInboxPlan> {
  const results: IProgramChangeResult[] = [];
  const updates: IProgramInboxUpdate[] = [];
  const ready: IProgramChangeRequest[] = [];
  let waiting = false;
  let current = storage;
  const seen = new Set(appliedIds);
  for (const request of requests) {
    if (request.id === "" || seen.has(request.id)) {
      continue;
    }
    seen.add(request.id);
    const judged = await ProgramInbox_judge(current, request);
    if (judged.kind === "rejected" || judged.kind === "conflict") {
      results.push({ id: request.id, status: judged.kind, at: options.now, reason: judged.reason });
      continue;
    }
    if (current.progress.length > 0) {
      waiting = true;
      continue;
    }
    if (!options.autoApply) {
      ready.push(request);
      continue;
    }
    const update: IProgramInboxUpdate = {
      requestId: request.id,
      programId: request.programId,
      author: request.author,
      summary: request.summary,
      weeks: judged.weeks,
      previousWeeks: judged.previousWeeks,
    };
    updates.push(update);
    results.push({ id: request.id, status: "applied", at: options.now });
    current = ProgramInbox_withUpdates(current, [update]);
  }
  return { results, updates, ready, waiting };
}

export function ProgramInbox_noticeItems(updates: IProgramInboxUpdate[]): IProgramInboxUpdate[] {
  const firstByProgram = new Map<string, IProgramInboxUpdate>();
  for (const update of updates) {
    const existing = firstByProgram.get(update.programId);
    if (existing == null) {
      firstByProgram.set(update.programId, update);
      continue;
    }
    firstByProgram.set(update.programId, {
      ...existing,
      summary: `${existing.summary}. ${update.summary}`,
    });
  }
  return [...firstByProgram.values()];
}

async function ProgramInbox_judge(
  storage: IStorage,
  request: IProgramChangeRequest
): Promise<
  | { kind: "rejected"; reason: string }
  | { kind: "conflict"; reason: string }
  | { kind: "ready"; weeks: IPlannerProgramWeek[]; previousWeeks: IPlannerProgramWeek[] }
> {
  const program = storage.programs.find((item) => item.id === request.programId);
  if (program == null) {
    return { kind: "rejected", reason: "program not found" };
  }
  if (program.planner == null) {
    return { kind: "rejected", reason: "program has no planner" };
  }
  if (request.newText.trim() === "") {
    return { kind: "rejected", reason: "invalid" };
  }
  let parsed: ReturnType<typeof PlannerProgram_parseText>;
  try {
    parsed = PlannerProgram_parseText(request.newText);
  } catch {
    return { kind: "rejected", reason: "invalid" };
  }
  if (!parsed.success) {
    return { kind: "rejected", reason: "invalid" };
  }
  const currentText = PlannerProgram_generateFullText(program.planner.weeks);
  const currentHash = await GithubSync_sha256Hex(currentText);
  if (currentHash !== request.baseTextSha256.trim().toLowerCase()) {
    return { kind: "conflict", reason: "base text changed" };
  }
  return {
    kind: "ready",
    weeks: parsed.data,
    previousWeeks: cloneWeeks(program.planner.weeks),
  };
}

function cloneWeeks(weeks: IPlannerProgramWeek[]): IPlannerProgramWeek[] {
  return weeks.map((week) => ({
    ...week,
    days: week.days.map((day) => ({ ...day })),
  }));
}

function isRequest(value: unknown): value is IProgramChangeRequest {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.author === "string" &&
    typeof row.programId === "string" &&
    typeof row.baseTextSha256 === "string" &&
    typeof row.newText === "string" &&
    typeof row.summary === "string"
  );
}

function isResult(value: unknown): value is IProgramChangeResult {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (row.status === "applied" || row.status === "conflict" || row.status === "rejected" || row.status === "declined") &&
    typeof row.at === "string"
  );
}
