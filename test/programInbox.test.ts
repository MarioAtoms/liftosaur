import "mocha";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { Program_create } from "../src/models/program";
import { Storage_getDefault } from "../src/models/storage";
import { PlannerProgram_generateFullText, PlannerProgram_parseText } from "../src/pages/planner/models/plannerProgram";
import { GithubSync_sha256Hex } from "../src/sync/githubSyncCodec";
import { ProgramInbox_plan, ProgramInbox_withUpdates } from "../src/sync/programInbox";
import { IProgramChangeRequest } from "../src/sync/githubSyncTypes";
import { IHistoryRecord, IStorage } from "../src/types";

function liftoscript(): string {
  const raw = fs.readFileSync(path.resolve(__dirname, "../programs/builtin/mario-home.md"), "utf8");
  const match = raw.match(/```liftoscript\s*\n([\s\S]*?)```/);
  if (match == null) {
    throw new Error("mario-home.md has no liftoscript block");
  }
  return match[1].trim();
}

function marioStorage(): { storage: IStorage; text: string } {
  const parsed = PlannerProgram_parseText(liftoscript());
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  const text = PlannerProgram_generateFullText(parsed.data);
  const program = {
    ...Program_create("Mario Home (Ironmaster)", "mario-home"),
    planner: { vtype: "planner" as const, name: "Mario Home (Ironmaster)", weeks: parsed.data },
  };
  const storage = Storage_getDefault();
  storage.programs = [program];
  storage.currentProgramId = program.id;
  storage.history = [historyRecord()];
  return { storage, text };
}

function historyRecord(): IHistoryRecord {
  return {
    id: 4,
    date: "2026-11-02",
    programId: "mario-home",
    programName: "Mario Home (Ironmaster)",
    day: 1,
    dayName: "Legs",
    entries: [],
    startTime: 10,
  } as unknown as IHistoryRecord;
}

async function requestFor(
  text: string,
  newText: string,
  id = "2026-11-04-fitness-rdl-20"
): Promise<IProgramChangeRequest> {
  return {
    id,
    createdAt: "2026-11-04T14:00:00Z",
    author: "Fitness",
    programId: "mario-home",
    baseTextSha256: await GithubSync_sha256Hex(text),
    newText,
    summary: "Legs: Romanian Deadlift 25 lb -> 20 lb",
    mode: "auto",
  };
}

function rdlLine(text: string): string {
  const line = text.split("\n").find((item) => item.includes("Romanian Deadlift"));
  if (line == null) {
    throw new Error("no Romanian Deadlift line");
  }
  return line;
}

describe("program inbox", () => {
  const now = "2026-11-04T14:05:00.000Z";

  it("changes Romanian Deadlift from 25 lb to 20 lb on Mario Home", async () => {
    const { storage, text } = marioStorage();
    const line = rdlLine(text);
    expect(line).to.include("25lb");
    const newText = text.replace(line, line.replace("25lb", "20lb"));
    const plan = await ProgramInbox_plan(storage, [await requestFor(text, newText)], new Set(), {
      autoApply: true,
      now,
    });
    expect(plan.results.map((result) => result.status)).to.eql(["applied"]);
    const next = ProgramInbox_withUpdates(storage, plan.updates);
    const nextText = PlannerProgram_generateFullText(next.programs[0].planner!.weeks);
    const nextLine = rdlLine(nextText);
    expect(nextLine).to.include("20lb");
    expect(nextLine).to.not.include("25lb");
    expect(nextText).to.include("Bench Press, Dumbbell / 2x10 25lb");
    expect(next.history).to.equal(storage.history);
    expect(next.history).to.eql(storage.history);
    expect(next.stats).to.equal(storage.stats);
    expect(next.settings).to.equal(storage.settings);
  });

  it("marks a hash mismatch as conflict and does not change the program", async () => {
    const { storage, text } = marioStorage();
    const request = await requestFor(text, text.replace("25lb", "20lb"));
    request.baseTextSha256 = "deadbeef";
    const plan = await ProgramInbox_plan(storage, [request], new Set(), { autoApply: true, now });
    expect(plan.results).to.eql([{ id: request.id, status: "conflict", at: now, reason: "base text changed" }]);
    expect(plan.updates).to.eql([]);
    expect(PlannerProgram_generateFullText(storage.programs[0].planner!.weeks)).to.equal(text);
  });

  it("rejects Liftoscript that does not parse", async () => {
    const { storage, text } = marioStorage();
    const request = await requestFor(text, "Squat / 2x5");
    const plan = await ProgramInbox_plan(storage, [request], new Set(), { autoApply: true, now });
    expect(plan.results[0].status).to.equal("rejected");
    expect(plan.results[0].reason).to.equal("invalid");
    expect(plan.updates).to.eql([]);
    expect(PlannerProgram_generateFullText(storage.programs[0].planner!.weeks)).to.equal(text);
  });

  it("applies the same id only once", async () => {
    const { storage, text } = marioStorage();
    const line = rdlLine(text);
    const request = await requestFor(text, text.replace(line, line.replace("25lb", "20lb")));
    const first = await ProgramInbox_plan(storage, [request, { ...request }], new Set(), { autoApply: true, now });
    expect(first.updates).to.have.length(1);
    const applied = new Set(first.results.map((result) => result.id));
    const next = ProgramInbox_withUpdates(storage, first.updates);
    const second = await ProgramInbox_plan(next, [request], applied, { autoApply: true, now });
    expect(second.updates).to.eql([]);
    expect(second.results).to.eql([]);
    expect(next.history).to.equal(storage.history);
  });

  it("does not apply while a workout is in progress", async () => {
    const { storage, text } = marioStorage();
    storage.progress = [historyRecord()];
    const line = rdlLine(text);
    const request = await requestFor(text, text.replace(line, line.replace("25lb", "20lb")));
    const plan = await ProgramInbox_plan(storage, [request], new Set(), { autoApply: true, now });
    expect(plan.waiting).to.equal(true);
    expect(plan.updates).to.eql([]);
    expect(plan.results).to.eql([]);
    expect(PlannerProgram_generateFullText(storage.programs[0].planner!.weeks)).to.equal(text);
    expect(storage.history).to.have.length(1);
  });

  it("holds a matching change for confirmation when automatic apply is off", async () => {
    const { storage, text } = marioStorage();
    const line = rdlLine(text);
    const request = await requestFor(text, text.replace(line, line.replace("25lb", "20lb")));
    const plan = await ProgramInbox_plan(storage, [request], new Set(), { autoApply: false, now });
    expect(plan.ready.map((item) => item.id)).to.eql([request.id]);
    expect(plan.updates).to.eql([]);
    expect(plan.results).to.eql([]);
  });
});
