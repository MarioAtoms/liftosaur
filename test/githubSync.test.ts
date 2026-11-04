import "mocha";
import { expect } from "chai";
import { Storage_getDefault } from "../src/models/storage";
import { GithubClient_getFile } from "../src/sync/githubClient";
import { GithubSync_decodeBase64 } from "../src/sync/githubSyncCodec";
import { GithubSync_expiryWarning, GithubSync_failureFromStatus } from "../src/sync/githubSyncErrors";
import { GithubSync_push, IGithubSyncPushOutcome } from "../src/sync/githubSyncRun";
import { GithubSyncSchedule_initial, GithubSyncSchedule_reduce } from "../src/sync/githubSyncSchedule";
import { GithubSyncStore_emptyConfig, GithubSyncStore_emptyState } from "../src/sync/githubSyncStore";
import { GITHUB_SYNC_DEBOUNCE_MS, GITHUB_SYNC_PATHS, IKeyValueStore } from "../src/sync/githubSyncTypes";

const TOKEN = "github_pat_TEST_ONLY_DO_NOT_LEAK_9f3a";
const NOW = "2026-11-04T18:00:00.000Z";
const NOW_MS = Date.parse(NOW);

interface ICall {
  url: string;
  method: string;
  body?: string;
  authorization?: string;
}

function memoryStore(): IKeyValueStore & { values: Record<string, string> } {
  const values: Record<string, string> = {};
  return {
    values,
    async get(key: string): Promise<unknown> {
      return values[key];
    },
    async set(key: string, value?: string): Promise<void> {
      if (value == null) {
        delete values[key];
        return;
      }
      values[key] = value;
    },
    async remove(key: string): Promise<void> {
      delete values[key];
    },
  };
}

function decodePut(body?: string): { message: string; sha?: string; decoded: string } {
  const parsed = JSON.parse(body ?? "{}") as { message: string; content: string; sha?: string };
  return { message: parsed.message, sha: parsed.sha, decoded: GithubSync_decodeBase64(parsed.content) };
}

describe("GitHub sync push", () => {
  it("builds the storage, meta, and applied puts", async () => {
    const calls: ICall[] = [];
    const store = memoryStore();
    const storage = Storage_getDefault();
    storage.history = [{ id: 7 } as (typeof storage.history)[number]];
    const client = mockFetch(async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
        authorization: header(init, "authorization"),
      });
      if ((init?.method ?? "GET") === "GET") {
        return jsonResponse(404, { message: "Not Found" });
      }
      return jsonResponse(
        201,
        { content: { sha: `sha-${calls.length}` } },
        { "github-authentication-token-expiration": "2027-11-04T18:00:00Z" }
      );
    });
    const disk = {
      ...GithubSyncStore_emptyState(),
      dirty: true,
      lastSha: { [GITHUB_SYNC_PATHS.storage]: "known-sha" },
    };
    const outcome = await GithubSync_push({
      client,
      store,
      config: { ...GithubSyncStore_emptyConfig(), token: TOKEN },
      disk,
      storage,
      deviceId: "phone-1",
      appCommit: "abc123",
      now: NOW,
      nowMs: NOW_MS,
    });
    expect(outcome.ok).to.equal(true);
    expect(outcome.disk.dirty).to.equal(false);
    const puts = calls.filter((call) => call.method === "PUT");
    expect(puts.map((call) => call.url)).to.eql([
      contentsUrl(GITHUB_SYNC_PATHS.storage),
      contentsUrl(GITHUB_SYNC_PATHS.meta),
      contentsUrl(GITHUB_SYNC_PATHS.applied),
    ]);
    expect(puts.every((call) => call.authorization === `Bearer ${TOKEN}`)).to.equal(true);
    const storagePut = decodePut(puts[0].body);
    expect(storagePut.sha).to.equal("known-sha");
    expect(storagePut.message).to.equal("Mario Lift backup");
    const uploaded = JSON.parse(storagePut.decoded) as { history: { id: number }[]; stats: { weight: object } };
    expect(uploaded.history).to.eql([{ id: 7 }]);
    expect(uploaded.stats.weight).to.eql({});
    const meta = JSON.parse(decodePut(puts[1].body).decoded) as {
      appCommit: string;
      historyCount: number;
      deviceId: string;
    };
    expect(meta.appCommit).to.equal("abc123");
    expect(meta.historyCount).to.equal(1);
    expect(meta.deviceId).to.equal("phone-1");
    expect(outcome.config.tokenExpiresAt).to.equal("2027-11-04T18:00:00Z");
    expect(outcome.expiryWarning).to.equal(undefined);
  });

  it("retries a put once when GitHub returns 409", async () => {
    const storagePuts: Array<string | undefined> = [];
    let storageGets = 0;
    const client = mockFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes(GITHUB_SYNC_PATHS.storage)) {
        storageGets += 1;
        return jsonResponse(200, { sha: "server-sha", content: GithubSync_encodeForTest("{}") });
      }
      if (method === "GET") {
        return jsonResponse(404, { message: "Not Found" });
      }
      if (url.includes(GITHUB_SYNC_PATHS.storage)) {
        const body = JSON.parse(String(init?.body)) as { sha?: string };
        storagePuts.push(body.sha);
        if (body.sha !== "server-sha") {
          return jsonResponse(409, { message: "sha mismatch" });
        }
      }
      return jsonResponse(201, { content: { sha: "final-sha" } });
    });
    const outcome = await GithubSync_push({
      client,
      store: memoryStore(),
      config: { ...GithubSyncStore_emptyConfig(), token: TOKEN },
      disk: { ...GithubSyncStore_emptyState(), dirty: true, lastSha: { [GITHUB_SYNC_PATHS.storage]: "stale-sha" } },
      storage: Storage_getDefault(),
      deviceId: "phone-1",
      appCommit: "abc",
      now: NOW,
      nowMs: NOW_MS,
    });
    expect(outcome.ok).to.equal(true);
    expect(storageGets).to.equal(1);
    expect(storagePuts).to.eql(["stale-sha", "server-sha"]);
    expect(outcome.disk.lastSha[GITHUB_SYNC_PATHS.storage]).to.equal("final-sha");
  });

  it("maps 401 to an expired token and leaves the backup dirty", async () => {
    const outcome = await pushStatus(401);
    expect(outcome.ok).to.equal(false);
    expect(outcome.error?.message).to.equal("Token expired or revoked");
    expect(outcome.error?.code).to.equal("token");
    expect(outcome.disk.dirty).to.equal(true);
  });

  it("maps 404 to a repo the token cannot reach", async () => {
    const outcome = await pushStatus(404);
    expect(outcome.error?.message).to.equal("Token can't reach repo");
    expect(outcome.error?.code).to.equal("repo");
    expect(outcome.disk.dirty).to.equal(true);
  });

  it("reads the token expiry header and warns inside 14 days", async () => {
    const expires = "2026-11-10T18:00:00Z";
    const outcome = await GithubSync_push({
      client: mockFetch(async (_url, init) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse(404, {});
        }
        return jsonResponse(201, { content: { sha: "s" } }, { "github-authentication-token-expiration": expires });
      }),
      store: memoryStore(),
      config: { ...GithubSyncStore_emptyConfig(), token: TOKEN },
      disk: { ...GithubSyncStore_emptyState(), dirty: true },
      storage: Storage_getDefault(),
      deviceId: "phone-1",
      appCommit: "abc",
      now: NOW,
      nowMs: NOW_MS,
    });
    expect(outcome.config.tokenExpiresAt).to.equal(expires);
    expect(outcome.expiryWarning).to.equal("Token expires in 6 days");
    expect(GithubSync_expiryWarning(expires, NOW_MS + 20 * 24 * 60 * 60 * 1000)).to.equal(undefined);
    expect(GithubSync_failureFromStatus(403).message).to.equal("Token can't reach repo");
  });

  it("leaves dirty set when the network fails", async () => {
    const store = memoryStore();
    const disk = { ...GithubSyncStore_emptyState(), dirty: true };
    const outcome = await GithubSync_push({
      client: (() => Promise.reject(new TypeError("offline"))) as Window["fetch"],
      store,
      config: { ...GithubSyncStore_emptyConfig(), token: TOKEN },
      disk,
      storage: Storage_getDefault(),
      deviceId: "phone-1",
      appCommit: "abc",
      now: NOW,
      nowMs: NOW_MS,
    });
    expect(outcome.ok).to.equal(false);
    expect(outcome.error?.code).to.equal("offline");
    expect(outcome.disk.dirty).to.equal(true);
    expect(JSON.parse(store.values.mariolift_sync_state).dirty).to.equal(true);
  });

  it("does not call GitHub when nothing is dirty", async () => {
    let calls = 0;
    const outcome = await GithubSync_push({
      client: (() => {
        calls += 1;
        return Promise.reject(new Error("should not fetch"));
      }) as Window["fetch"],
      store: memoryStore(),
      config: { ...GithubSyncStore_emptyConfig(), token: TOKEN },
      disk: GithubSyncStore_emptyState(),
      storage: Storage_getDefault(),
      deviceId: "phone-1",
      appCommit: "abc",
      now: NOW,
      nowMs: NOW_MS,
    });
    expect(outcome.ok).to.equal(true);
    expect(calls).to.equal(0);
  });

  it("falls back to the raw media type when the contents API omits the body", async () => {
    const client = mockFetch(async (_url, init) => {
      const accept = header(init, "accept");
      if (accept === "application/vnd.github.raw") {
        return new Response("raw-body", { status: 200 });
      }
      return jsonResponse(200, { sha: "blob-sha", content: "" });
    });
    const file = await GithubClient_getFile(
      client,
      { owner: "MarioAtoms", name: "mario-lift-data" },
      TOKEN,
      GITHUB_SYNC_PATHS.storage
    );
    expect(file.ok).to.equal(true);
    if (file.ok) {
      expect(file.text).to.equal("raw-body");
      expect(file.sha).to.equal("blob-sha");
    }
  });
});

describe("GitHub sync schedule", () => {
  it("debounces edits and flushes a dirty backup immediately", () => {
    const now = 1_000;
    const edited = GithubSyncSchedule_reduce(GithubSyncSchedule_initial(), "edit", now);
    expect(edited.dirty).to.equal(true);
    expect(edited.runAt).to.equal(now + GITHUB_SYNC_DEBOUNCE_MS);
    const again = GithubSyncSchedule_reduce(edited, "edit", now + 100);
    expect(again.runAt).to.equal(now + 100 + GITHUB_SYNC_DEBOUNCE_MS);
    const flushed = GithubSyncSchedule_reduce(again, "flush", now + 200);
    expect(flushed.runAt).to.equal(now + 200);
    expect(GithubSyncSchedule_reduce(flushed, "pushed", now).dirty).to.equal(false);
    expect(GithubSyncSchedule_reduce(flushed, "push-failed", now).dirty).to.equal(true);
    expect(GithubSyncSchedule_reduce(GithubSyncSchedule_initial(), "flush", now).dirty).to.equal(false);
  });
});

async function pushStatus(status: number): Promise<IGithubSyncPushOutcome> {
  return GithubSync_push({
    client: mockFetch(async (_url, init) => {
      if ((init?.method ?? "GET") === "GET") {
        return jsonResponse(404, {});
      }
      return jsonResponse(status, { message: "nope" });
    }),
    store: memoryStore(),
    config: { ...GithubSyncStore_emptyConfig(), token: TOKEN },
    disk: { ...GithubSyncStore_emptyState(), dirty: true },
    storage: Storage_getDefault(),
    deviceId: "phone-1",
    appCommit: "abc",
    now: NOW,
    nowMs: NOW_MS,
  });
}

function contentsUrl(path: string): string {
  return `https://api.github.com/repos/MarioAtoms/mario-lift-data/contents/${path}`;
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (headers == null || headers instanceof Headers || Array.isArray(headers)) {
    return undefined;
  }
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof found?.[1] === "string" ? found[1] : undefined;
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): Window["fetch"] {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as Window["fetch"];
}

function GithubSync_encodeForTest(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
