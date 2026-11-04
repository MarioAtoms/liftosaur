import { GithubSync_decodeBase64, GithubSync_encodeBase64 } from "./githubSyncCodec";
import { GithubSync_failureFromStatus, GithubSync_offlineFailure } from "./githubSyncErrors";
import { IGithubRepo, IGithubSyncFailure } from "./githubSyncTypes";

const GITHUB_API = "https://api.github.com";

export type IGithubGetFile =
  | { ok: true; text: string; sha?: string; expiresAt?: string }
  | { ok: false; missing: true; expiresAt?: string }
  | { ok: false; missing: false; error: IGithubSyncFailure; expiresAt?: string };

export type IGithubPutFile =
  | { ok: true; sha?: string; expiresAt?: string }
  | { ok: false; error: IGithubSyncFailure; expiresAt?: string };

export type IGithubRepoCheck =
  | { ok: true; expiresAt?: string }
  | { ok: false; error: IGithubSyncFailure; expiresAt?: string };

function contentsUrl(repo: IGithubRepo, path: string): string {
  const encodedPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${encodedPath}`;
}

function repoUrl(repo: IGithubRepo): string {
  return `${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

function githubHeaders(token: string, accept: string): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "User-Agent": "mario-lift",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function expiresAtOf(response: Response): string | undefined {
  return response.headers.get("github-authentication-token-expiration") ?? undefined;
}

async function githubFetch(
  client: Window["fetch"],
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string }
): Promise<Response | IGithubSyncFailure> {
  try {
    return await client(url, init);
  } catch {
    return GithubSync_offlineFailure();
  }
}

export async function GithubClient_getRepo(
  client: Window["fetch"],
  repo: IGithubRepo,
  token: string
): Promise<IGithubRepoCheck> {
  const response = await githubFetch(client, repoUrl(repo), {
    headers: githubHeaders(token, "application/vnd.github+json"),
  });
  if ("code" in response) {
    return { ok: false, error: response };
  }
  const expiresAt = expiresAtOf(response);
  if (!response.ok) {
    return { ok: false, error: GithubSync_failureFromStatus(response.status), expiresAt };
  }
  return { ok: true, expiresAt };
}

export async function GithubClient_getFile(
  client: Window["fetch"],
  repo: IGithubRepo,
  token: string,
  path: string
): Promise<IGithubGetFile> {
  const url = contentsUrl(repo, path);
  const response = await githubFetch(client, url, {
    headers: githubHeaders(token, "application/vnd.github+json"),
  });
  if ("code" in response) {
    return { ok: false, missing: false, error: response };
  }
  const expiresAt = expiresAtOf(response);
  if (response.status === 404) {
    return { ok: false, missing: true, expiresAt };
  }
  if (!response.ok) {
    return { ok: false, missing: false, error: GithubSync_failureFromStatus(response.status), expiresAt };
  }
  const json = (await response.json()) as { sha?: unknown; content?: unknown };
  const sha = typeof json.sha === "string" ? json.sha : undefined;
  if (typeof json.content === "string" && json.content !== "") {
    try {
      return { ok: true, sha, text: GithubSync_decodeBase64(json.content), expiresAt };
    } catch {
      return {
        ok: false,
        missing: false,
        error: { code: "http", message: "GitHub file was not valid base64", status: response.status },
        expiresAt,
      };
    }
  }
  // The contents API omits `content` above 1 MB. The raw media type returns the bytes.
  const raw = await githubFetch(client, url, {
    headers: githubHeaders(token, "application/vnd.github.raw"),
  });
  if ("code" in raw) {
    return { ok: false, missing: false, error: raw, expiresAt };
  }
  if (!raw.ok) {
    return {
      ok: false,
      missing: false,
      error: GithubSync_failureFromStatus(raw.status),
      expiresAt: expiresAtOf(raw) ?? expiresAt,
    };
  }
  return { ok: true, sha, text: await raw.text(), expiresAt: expiresAtOf(raw) ?? expiresAt };
}

export async function GithubClient_putFile(
  client: Window["fetch"],
  repo: IGithubRepo,
  token: string,
  path: string,
  text: string,
  message: string,
  sha?: string
): Promise<IGithubPutFile> {
  const payload: { message: string; content: string; sha?: string } = {
    message,
    content: GithubSync_encodeBase64(text),
  };
  if (sha != null && sha !== "") {
    payload.sha = sha;
  }
  const response = await githubFetch(client, contentsUrl(repo, path), {
    method: "PUT",
    headers: { ...githubHeaders(token, "application/vnd.github+json"), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if ("code" in response) {
    return { ok: false, error: response };
  }
  const expiresAt = expiresAtOf(response);
  if (!response.ok) {
    return { ok: false, error: GithubSync_failureFromStatus(response.status), expiresAt };
  }
  let nextSha: string | undefined;
  try {
    const json = (await response.json()) as { content?: { sha?: unknown } };
    if (typeof json.content?.sha === "string") {
      nextSha = json.content.sha;
    }
  } catch {
    nextSha = undefined;
  }
  return { ok: true, sha: nextSha, expiresAt };
}
