import "mocha";
import { expect } from "chai";
import { ImportExporter_exportStorage } from "../src/lib/importexporter";
import { Storage_getDefault, Storage_updateVersions } from "../src/models/storage";
import { GithubSync_decodeBase64 } from "../src/sync/githubSyncCodec";
import { GithubSync_push } from "../src/sync/githubSyncRun";
import { GithubSyncSettings_saveDraft } from "../src/sync/githubSyncSettingsModel";
import { GithubSyncStore_emptyState } from "../src/sync/githubSyncStore";
import { GITHUB_SYNC_CONFIG_KEY, GITHUB_SYNC_STATE_KEY, IKeyValueStore } from "../src/sync/githubSyncTypes";
import { Snapshot_build } from "../src/sync/snapshot";
import { IStorage } from "../src/types";

const TOKEN = "github_pat_TEST_ONLY_DO_NOT_LEAK_9f3a";

function memoryStore(): IKeyValueStore & { values: Record<string, string> } {
  const values: Record<string, string> = {};
  return {
    values,
    async get(key) {
      return values[key];
    },
    async set(key, value) {
      if (value == null) {
        delete values[key];
        return;
      }
      values[key] = value;
    },
    async remove(key) {
      delete values[key];
    },
  };
}

function storageWithBodyStat(): IStorage {
  const storage = Storage_getDefault();
  storage.stats.weight.weight = [{ vtype: "stat", value: { value: 187.25, unit: "lb" }, timestamp: 1 }];
  storage.deletedStats = [987654321];
  storage.history = [{ id: 3 } as IStorage["history"][number]];
  return storage;
}

describe("GitHub sync secrets", () => {
  it("keeps the token out of storage, export, versions, and the snapshot", async () => {
    const store = memoryStore();
    const saved = await GithubSyncSettings_saveDraft(store, {
      repo: "MarioAtoms/mario-lift-data",
      token: TOKEN,
      autoApply: true,
      includeBodyStats: false,
    });
    expect(saved.token).to.equal(TOKEN);
    expect(store.values[GITHUB_SYNC_CONFIG_KEY]).to.include(TOKEN);
    expect(store.values[GITHUB_SYNC_STATE_KEY] ?? "").to.not.include(TOKEN);

    const storage = storageWithBodyStat();
    const puts: string[] = [];
    const outcome = await GithubSync_push({
      client: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "PUT" && typeof init?.body === "string") {
          puts.push(init.body);
        }
        if ((init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({ message: "missing" }), { status: 404 });
        }
        return new Response(JSON.stringify({ content: { sha: "sha" } }), { status: 201 });
      }) as Window["fetch"],
      store,
      config: saved,
      disk: { ...GithubSyncStore_emptyState(), dirty: true },
      storage,
      deviceId: "phone-1",
      appCommit: "abc",
      now: "2026-11-04T18:00:00.000Z",
      nowMs: Date.parse("2026-11-04T18:00:00.000Z"),
    });
    expect(outcome.ok).to.equal(true);

    const versions = Storage_updateVersions(storage, { ...storage, history: [] }, "phone-1");
    const exported = captureExport(storage);
    const snapshot = await Snapshot_build({
      storage,
      includeBodyStats: false,
      deviceId: "phone-1",
      appCommit: "abc",
      pushedAt: "2026-11-04T18:00:00.000Z",
    });
    const withStats = await Snapshot_build({
      storage,
      includeBodyStats: true,
      deviceId: "phone-1",
      appCommit: "abc",
      pushedAt: "2026-11-04T18:00:00.000Z",
    });

    expect(JSON.stringify(storage)).to.not.include(TOKEN);
    expect(exported).to.not.include(TOKEN);
    expect(JSON.stringify(versions)).to.not.include(TOKEN);
    expect(snapshot.storageJson).to.not.include(TOKEN);
    expect(snapshot.metaJson).to.not.include(TOKEN);
    expect(store.values[GITHUB_SYNC_STATE_KEY]).to.not.include(TOKEN);
    for (const body of puts) {
      const decoded = GithubSync_decodeBase64((JSON.parse(body) as { content: string }).content);
      expect(decoded).to.not.include(TOKEN);
      expect(body.includes(TOKEN)).to.equal(false);
    }
    expect(snapshot.storageJson).to.not.include("187.25");
    expect(snapshot.storageJson).to.not.include("987654321");
    expect(withStats.storageJson).to.include("187.25");
    expect(JSON.stringify(storage)).to.include("187.25");
    expect(store.values[GITHUB_SYNC_CONFIG_KEY]).to.include(TOKEN);
  });
});

function captureExport(storage: IStorage): string {
  const previousBlob = globalThis.Blob;
  const previousDocument = globalThis.document;
  const previousUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  let contents = "";
  class CapturingBlob {
    constructor(parts: BlobPart[]) {
      contents = parts.map((part) => String(part)).join("");
    }
  }
  globalThis.Blob = CapturingBlob as unknown as typeof Blob;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:test" });
  const anchor = { href: "", setAttribute: () => undefined, click: () => undefined };
  globalThis.document = {
    createElement: () => anchor,
    body: { appendChild: () => anchor, removeChild: () => undefined },
  } as unknown as Document;
  try {
    ImportExporter_exportStorage(storage);
  } finally {
    globalThis.Blob = previousBlob;
    globalThis.document = previousDocument;
    if (previousUrl != null) {
      Object.defineProperty(URL, "createObjectURL", previousUrl);
    }
  }
  return contents;
}
