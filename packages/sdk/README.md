# packages/sdk

Typed client for the platform HTTP API, generated from the contract types.

- **Kind:** `package` · **Created in stage:** `backend-core` (P3-05)
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Usage

```ts
import { createClient, ApiError } from "@project-air/sdk";

const api = createClient({
  baseUrl: "http://127.0.0.1:4110",
  session: { testSession }, // or { cookie: "ory_kratos_session=…" }
});

const workspace = await api.workspaces.create({ name: "Lab", ownerId: accountId });
const boards = await api.boards.list(workspace.id, { limit: 20 });
const note = await api.notes.create(workspace.id, { title: "Kickoff" });
const card = await api.cards.create(boards.items[0]!.id, {
  noteId: note.id,
  zoneId: null,
  x: 10,
  y: 20,
  width: 240,
  height: 120,
  z: "a0",
});
```

Every resource has `list`, `get`, `create`, `update` and `delete`. The SDK builds the `/v1` paths,
sends a UUIDv7 `requestId` with every call, parses the contract envelopes (`{requestId, items,
nextCursor}`, `{requestId, <resource>}`, `{requestId, deletedId}`) and throws a typed `ApiError`
with `code`, `messageKey`, `requestId` and `details` (the seven contract error codes, never prose).

`createClient` options: `baseUrl` (required), `session` (a `{ cookie }` or `{ testSession }` object,
or a string shorthand for the test session), `fetch` (host override, tests) and `requestId`
(UUIDv7 factory, tests). The only import is the generated contract type file of
`packages/contracts`; there is no runtime dependency.

## Commands

| Script | Command | Purpose |
| --- | --- | --- |
| `build` | `tsc --project tsconfig.json` | writes `dist/` |
| `typecheck` | `tsc --noEmit --project tsconfig.json` | type check |
| `lint` | `eslint --max-warnings=0 .` | shared flat config |
| `test` | `node --test test/*.test.mjs` | SDK tests against an in-process stub server |

The stage acceptance uses the SDK end to end: `node tools/dev/acceptance-backend.mjs` boots the
real auth and platform services on the slot ports, creates two accounts and proves the second sees
nothing of the first.
