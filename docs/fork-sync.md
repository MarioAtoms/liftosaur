# Strength and Honor GitHub sync

The phone backs up IndexedDB to a private GitHub repo. A bot writes program-text changes into that repo. The phone applies them.

This runs only when offline-fork mode is on and a token is saved in Settings. The token is not in `IStorage`, not in the snapshot, and not in git.

## Who writes what

The phone writes these paths.

- `snapshot/storage.json` is the full storage object, pretty printed. With **Include body stats** off, `stats` is empty and `deletedStats` is `[]`.
- `snapshot/meta.json` describes the push. The fields are below.
- `outbox/applied.json` is the result of each request id.

Bots write only `inbox/program-changes.json`. Bots do not write `snapshot/` or `outbox/`.

A request can change program text only. History, stats, and settings stay as they are.

## `snapshot/meta.json`

`programText` is the current program. `programTextSha256` is the hex sha256 of that exact string. `programs` lists every program that has a planner, in the same shape, so a bot can edit a program that is not current.

```json
{
  "pushedAt": "2026-11-04T14:00:00.000Z",
  "appCommit": "abc123",
  "storageVersion": "20261103120000",
  "historyCount": 12,
  "deviceId": "device",
  "programId": "mario-home",
  "programName": "Mario Home (Ironmaster)",
  "programText": "# Week 1\n\n## Legs\n\nRomanian Deadlift, Dumbbell / 2x10 25lb 90s / warmup: none / progress: dp(5lb, 10, 10)\n\n\n",
  "programTextSha256": "<64 hex chars>",
  "programs": [
    {
      "id": "mario-home",
      "name": "Mario Home (Ironmaster)",
      "programText": "...",
      "programTextSha256": "<64 hex chars>"
    }
  ]
}
```

The canonical text is `PlannerProgram_generateFullText` on `program.planner.weeks`. Copy `programText` from meta. Do not rebuild it from `storage.json` by hand. A different newline changes the hash, and the phone marks the request `conflict`.

## `inbox/program-changes.json`

Append to `requests`. Do not remove older rows. The phone skips an id it has already recorded.

```json
{
  "requests": [
    {
      "id": "2026-11-04-fitness-rdl-20",
      "createdAt": "2026-11-04T14:00:00Z",
      "author": "Fitness",
      "programId": "mario-home",
      "baseTextSha256": "<programTextSha256 of the text you edited>",
      "newText": "<full Liftoscript text>",
      "summary": "Legs: Romanian Deadlift 25 lb -> 20 lb",
      "mode": "auto"
    }
  ]
}
```

`id` is unique per attempt. After `conflict` or `rejected`, send a new id. `programId` is `programs[].id` in `snapshot/storage.json`. `baseTextSha256` is the hash of the text you started from. `newText` is the full program text, not one exercise line. `author` and `summary` are shown on the phone. `mode` is recorded and ignored. The phone setting **Apply coach changes automatically** decides.

The phone checks, in order.

- An id already in `outbox/applied.json` or in the phone's applied ids is skipped.
- `newText` must parse as Liftoscript. The phone uses strict `PlannerProgram_parseText`. A bad program is `rejected` with reason `invalid`. The program does not change.
- sha256 of the program's current full text must equal `baseTextSha256`. If not, the status is `conflict` and the program does not change. Read the new `programText` and send a new id.
- If `storage.progress` is not empty, a workout is in progress. The phone waits. It does not write a result yet.
- If automatic apply is on, the phone replaces that program's planner weeks and shows a banner. Undo puts the previous program text back. The request stays `applied`, so send a new id for another change.
- If automatic apply is off, the phone asks first. Cancel writes `declined`.

## `outbox/applied.json`

The phone writes this. Bots only read it.

```json
{
  "results": [
    {
      "id": "2026-11-04-fitness-rdl-20",
      "status": "applied",
      "at": "2026-11-04T14:05:00.000Z"
    }
  ]
}
```

`status` is `applied`, `conflict`, `rejected`, or `declined`. `reason` is set for `conflict` and `rejected`.

## When the phone syncs

The phone pushes after a workout is finished, on app open, when the page is hidden, when it comes back online, and from **Sync now**. Edits wait 5 seconds so a burst of typing is one push. A hidden page, a finished workout, coming online, and **Sync now** push immediately. Offline edits stay dirty and go out on the next trigger.

The phone pulls `inbox/program-changes.json` on app open, when the page becomes visible again, and from **Sync now**.

## Token

Create a fine-grained personal access token for `mario-lift-data` only, with Contents read and write, expiring in one year. Paste it once in Settings. The field is a password field. The app shows "Token saved" after that and does not show the token again. **Forget token** deletes it from this device.

The IndexedDB key is `mariolift_github_sync`. Sync progress is `mariolift_sync_state`. Neither key is inside `IStorage`.

A 401 from GitHub shows "Token expired or revoked". A 403 or 404 shows "Token can't reach repo". Within 14 days of `github-authentication-token-expiration`, Settings shows "Token expires in N days".
