import "mocha";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import { parseProgramMarkdownContent } from "../src/utils/programUtils";
import { Program_create, Program_evaluate, Program_nextHistoryRecord } from "../src/models/program";
import { Settings_build } from "../src/models/settings";
import { Stats_getEmpty } from "../src/models/stats";
import { PlannerTestUtils_finish } from "./utils/plannerTestUtils";
import { PlannerProgram_generateFullText } from "../src/pages/planner/models/plannerProgram";
import { migrations } from "../src/migrations/migrations";
import { IHistoryRecord, IStorage } from "../src/types";
import { EquipmentDefaults_build } from "../src/models/equipmentDefaults";

function liftoscript(): string {
  const raw = fs.readFileSync(path.resolve(__dirname, "../programs/builtin/mario-home.md"), "utf8");
  const match = raw.match(/```liftoscript\s*\n([\s\S]*?)```/);
  if (match == null) {
    throw new Error("mario-home.md has no liftoscript block");
  }
  return match[1].trim();
}

function workingWeights(record: IHistoryRecord): { name: string; reps: number[]; weight: number }[] {
  return record.entries.map((entry) => ({
    name: entry.exercise?.id ?? "",
    reps: entry.sets.map((set) => set.reps),
    weight: entry.sets[0]?.weight.value,
  }));
}

describe("Mario Home (Ironmaster)", () => {
  const settings = Settings_build();

  it("parses and is the featured built-in", () => {
    const raw = fs.readFileSync(path.resolve(__dirname, "../programs/builtin/mario-home.md"), "utf8");
    const parsed = matter(raw);
    const { indexEntry, detail, liftoscriptError } = parseProgramMarkdownContent(parsed.content, parsed.data);
    expect(liftoscriptError, liftoscriptError).to.equal(undefined);
    expect(indexEntry.name).to.equal("Mario Home (Ironmaster)");
    expect(detail.planner.weeks[0].days.map((day) => day.name)).to.eql(["Legs", "Push", "Pull"]);
    const evaluated = Program_evaluate(
      { ...Program_create(indexEntry.name, indexEntry.id), planner: detail.planner },
      settings
    );
    expect(evaluated.errors.map((error) => error.error.message)).to.eql([]);
  });

  it("starts Legs at the prescribed pound weights", () => {
    const program = {
      ...Program_create("Mario Home (Ironmaster)", "mario-home"),
      planner: { vtype: "planner" as const, name: "Mario Home (Ironmaster)", weeks: [] },
    };
    const { detail } = parseProgramMarkdownContent(
      fs.readFileSync(path.resolve(__dirname, "../programs/builtin/mario-home.md"), "utf8"),
      { id: "mario-home", name: "Mario Home (Ironmaster)" }
    );
    program.planner = detail.planner;
    const record = Program_nextHistoryRecord(program, settings, Stats_getEmpty(), 1);
    expect(record.entries.map((entry) => entry.exercise.id)).to.eql([
      "gobletSquat",
      "romanianDeadlift",
      "reverseLunge",
      "standingCalfRaise",
    ]);
    expect(record.entries.map((entry) => entry.exercise.equipment)).to.eql([
      "kettlebell",
      "dumbbell",
      "dumbbell",
      "dumbbell",
    ]);
    const sets = workingWeights(record);
    expect(sets.map((set) => set.weight)).to.eql([50, 25, 20, 20]);
    expect(sets.map((set) => set.reps)).to.eql([
      [10, 10],
      [10, 10],
      [10, 10],
      [15, 15],
    ]);
    expect(record.entries[2].sets.map((set) => set.minReps)).to.eql([8, 8]);
    expect(sets.every((set) => record.entries[0].sets[0].weight.unit === "lb")).to.equal(true);
    expect(record.entries[0].warmupSets).to.eql([]);
  });

  it("adds 5 lb after a completed goblet squat and one rep after push-ups", () => {
    const script = liftoscript();
    const legs = PlannerTestUtils_finish(
      script,
      {
        completedReps: [
          [10, 10],
          [10, 10],
          [10, 10],
          [15, 15],
        ],
      },
      settings,
      Stats_getEmpty(),
      1
    );
    const legsText = PlannerProgram_generateFullText(legs.program.planner!.weeks);
    expect(legsText).to.include("Goblet Squat, Kettlebell / 2x10 / 55lb");
    expect(legsText).to.include("Romanian Deadlift / 2x10 / 30lb");
    expect(legsText).to.include("Reverse Lunge / 2x8-10 / 25lb");
    expect(legsText).to.include("Standing Calf Raise / 2x16");

    const push = PlannerTestUtils_finish(
      script,
      {
        completedReps: [
          [10, 10],
          [10, 10],
          [12, 12],
          [18, 16],
        ],
      },
      settings,
      Stats_getEmpty(),
      2
    );
    const pushText = PlannerProgram_generateFullText(push.program.planner!.weeks);
    expect(pushText).to.include("Bench Press, Dumbbell / 2x11");
    expect(pushText).to.include("Push Up / 1x19+, 1x17+");
  });

  it("keeps an edited kettlebell list and updates an untouched default", () => {
    const fresh = { settings: Settings_build() } as IStorage;
    fresh.settings.gyms[0].equipment.kettlebell!.setup = {
      type: "fixed",
      unit: "lb",
      ranges: [],
      values: [10, 15, 20, 25, 30, 35, 40],
    };
    fresh.settings.gyms[0].equipment.dumbbell!.setup = {
      type: "fixed",
      unit: "lb",
      ranges: [{ from: 10, to: 50, step: 5 }],
      values: [],
    };
    const migrated = migrations["20261103120000_ironmaster_equipment"](fresh);
    expect(migrated.settings.gyms[0].equipment.kettlebell?.setup).to.eql(
      EquipmentDefaults_build("lb").kettlebell?.setup
    );
    expect(migrated.settings.gyms[0].equipment.dumbbell?.setup?.ranges).to.eql([{ from: 10, to: 50, step: 5 }]);
  });
});
