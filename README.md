# pi-ele-picker

Pick an element in your running page, describe the change you want (text + screenshots), and send it to a running [pi](https://github.com/earendil-works/pi) session — either into the pi input box for review, or submitted straight away as a real user turn.

The picker lives entirely inside a Shadow DOM, so it never leaks styles into — or inherits styles from — your app.

## How it works

```
browser page ──(same-origin /__pi_picker__/config)──▶ Vite plugin ──▶ reads ~/.pi/agent/pi-picker/*.json
     │                                                                        (discovers the live bridge)
     ├──(GET http://127.0.0.1:<port>/status, every 3s)───────────────────────▶ pi bridge extension
     │                                                                        (session status → launcher dot)
     └──(POST http://127.0.0.1:<port>/pick)────────────────────────────────▶ pi bridge extension
                                                                              │
                                                                       writes to the pi input box
                                                                       or submits a user turn
```

`pi-ele-picker` has **two halves**, and you need both:

| Half | What it is | Where it runs |
|---|---|---|
| **pi bridge extension** | a pi extension that serves `POST /pick` on loopback | inside your pi session |
| **Vite plugin** | injects the picker + a discovery endpoint into your dev page | in your Vite dev server |

They meet in the middle through the bridge registry (`~/.pi/agent/pi-picker/<pid>.json`).

## Install

### 1. The pi bridge extension (once per machine)

```bash
pi install npm:pi-ele-picker
```

This registers the bridge extension (`extensions/pi-picker.ts` from this package) with pi. Check it with `pi list`.

<details>
<summary>Manual install (if you don't use the pi package manager)</summary>

Copy the extension file that ships in this package into pi's extension directory:

```bash
mkdir -p ~/.pi/agent/extensions
cp node_modules/pi-ele-picker/extensions/pi-picker.ts ~/.pi/agent/extensions/pi-picker.ts
```
</details>

### 2. The Vite plugin (per project)

```bash
npm i -D pi-ele-picker
# pnpm add -D pi-ele-picker
# yarn add -D pi-ele-picker
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import piElePicker from 'pi-ele-picker';

export default defineConfig({
  plugins: [piElePicker()],
});
```

Then run the dev server **and start pi in the same directory** (the bridge is matched by working directory). A **Pi Picker** launcher appears in the page.

### Options

```ts
piElePicker({
  // Directory whose pi bridge to discover; must match the cwd the pi session
  // was started in. Defaults to process.cwd().
  root: process.cwd(),
  // Project-level default for the in-page session-status switch. Off by default:
  // the status poll costs one loopback request every 3s, so users opt in from the
  // picker panel unless you flip this on for them.
  status: false,
  // Serve POST /__pi_picker__/open, used by the clickable source chips in the
  // panel. Set to false to keep the picker fully read-only.
  openInEditor: true,
});
```

## Requirements

- Node.js >= 18, Vite >= 4.
- [pi](https://github.com/earendil-works/pi) with the bridge extension installed (step 1 above).
- Start pi in the same directory you run Vite from, so the bridge is matched to the project.

## Using the picker

The launcher starts in the **bottom-right** corner and stays out of the way:

- **Draggable** — grab it and drop it anywhere; the position is remembered per browser (`localStorage`).
- **Fades when idle** (opacity `0.5`) and returns to full opacity on hover.
- **Shows the live pi session status** as a coloured dot **when enabled** — green while pi is running, amber while follow-ups are queued, grey while awaiting input, red when the bridge is gone (see [Session status](#session-status)).
- **Hovering the launcher reopens the panel** for the element you captured last — no need to pick it again, and the captured element is only replaced when you commit a new pick. Closing the panel with **✕** keeps it available this way.
- Clicking the launcher starts a **new pick**: the panel steps out of the way, and pressing **Esc** keeps the previously captured element intact.
- The panel always opens **next to the launcher**, flipping sides and clamping to stay on screen.
- **The panel is draggable too** — grab its title bar (or any empty spot) to move it; the offset from the launcher is remembered per browser (`localStorage`), and the panel still follows the launcher while clamping itself to stay on screen.

1. Click **Pi Picker** and pick an element on the page.
2. Describe the change (paste or attach screenshots if you like).
3. Choose a delivery mode:
   - **写入pi输入框** — pre-fills the current pi input box with the composed prompt; you edit and press Enter.
   - **直接发送** — submits the composed prompt as a real user turn immediately (queued as a follow-up if pi is mid-turn).

### Drafts survive reloads

Vite reloads the page every time you save a file, so the composer is mirrored into `sessionStorage` and re-attached on the next load:

- The description and any attached screenshots come back exactly as they were.
- The captured element is **snapshotted at pick time and persisted with the draft**, so the element data survives the node being unmounted, an SPA route change, or the reload itself.
- The captured element is **re-resolved from its selector**, so after an HMR update you land straight back in the panel on the same element — no re-pick.
- Closing the panel with **✕** also suppresses the automatic reopen; the draft stays reachable through the launcher's hover.
- **Sending never depends on the element still being on the page.** Pick a button, go copy something from another route, then send — the description goes out with the element as it was when you picked it. A live read is used instead while you are still on the pick-time page, so an HMR swap of the same node is described in its current state; after a route change the snapshot wins, so a lookalike behind the same selector cannot be mistaken for your pick. When a snapshot was used, the status line says so.
- The draft is per tab and per path (`sessionStorage`, not `localStorage`), and one older than 24h is discarded. A successful send clears it.
- Screenshots that exceed the ~5MB `sessionStorage` quota are dropped from the draft with a notice rather than silently lost; the description is always kept.

### Session status

Status polling is **opt-in and off by default**: each cycle opens a loopback request, so it is disabled unless you want it. There are two levels:

- **Per browser (runtime):** the switch in the picker panel (labelled **状态**) turns polling on/off; the choice is remembered in `localStorage`.
- **Per project (build time):** the `status` option above sets the default for anyone who has not chosen yet.

Effective state = this browser's saved choice, else the project default. When it is off, the picker issues **no** status requests at all.

When enabled, the launcher carries a small status dot and the panel repeats it as text (status · model · session id). The picker polls the bridge's `GET /status` every 3 seconds (pausing while the tab is hidden and re-discovering the bridge after a pi restart):

| Dot | State | Meaning |
| --- | --- | --- |
| 🟢 pulsing | `running` | pi is streaming / executing a turn |
| 🟡 | `queued` | pi is idle but follow-up messages are queued |
| ⚪ | `idle` | pi is idle, waiting for your input |
| 🔴 | `offline` | no live bridge for this project — pi is stopped / not running here |
| ◯ hollow | — | status display is switched off |

The same payload is available from the bridge directly:

```jsonc
// GET http://127.0.0.1:<bridge port>/status
{ "ok": true, "status": "running", "idle": false, "pending": false,
  "mode": "tui", "sessionId": "…", "model": "Claude Sonnet 4",
  "provider": "anthropic", "pid": 12345, "cwd": "…", "updatedAt": 1700000000000 }
```

`/status` needs no token, but non-local browser origins get `403`, so an arbitrary website cannot probe session metadata. "Local" covers `localhost` / `*.localhost`, `127.0.0.0/8`, `0.0.0.0`, `[::1]`, and private or link-local IPv4 literals (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `169.254.x.x`) — so a dev server you open over your machine's LAN IPv4 address (Vite binds `0.0.0.0` by default) works, while an arbitrary site does not.

### What the panel shows

The panel is deliberately small: it names the picked element and the page it came
from, plus the Vue component file when one can be detected.

```
button#save
页面: http://localhost:5173/settings
页面组件: Settings views/Settings.vue
业务组件: UserCard components/UserCard.vue
```

The page component is resolved from Vue Router's `$route.matched` for the current
URL: the deepest matched record is the page, while earlier records are layouts /
the App shell. It therefore reflects the path even for an element outside the
page's own subtree (a global header, for example). If no Vue Router is present,
the panel falls back to the nearest component file. Both file chips are clickable.

Style rows are not rendered. Listing computed properties next to the element did
not help decide where to edit, and the subset was inconsistent across elements, so
the panel leaves style inspection out. The computed styles still go to the agent in
the payload (`element.styles`), and the matching style sources go with them (see
below).

### Style source tracing (agent payload)

Computed styles answer *what* the element looks like; they cannot answer *where to
edit it*. For the agent, the picker also reports **which source file the matching
CSS rule came from**.

Vite injects every dev stylesheet as `<style data-vite-dev-id="/src/...">`, and
that id is the module URL. For the picked element the picker walks
`document.styleSheets`, keeps only those Vite sheets, and tests each rule with
`el.matches(rule.selectorText)` (following `@media` / `@supports` so a rule that
does not currently apply is not attributed). The result ships as
`styleSources` / `styleWinners`:

```
- background-color: rgb(37,99,235)  ←  src/components/Foo.vue  (#save)
```

Only the file is reported, never a line number. Vite compiles CSS (SCSS/Less, Vue
scoped styles, Tailwind, PostCSS, inlined `@import`), so a line counted in the
injected `<style>` would point at the wrong place in the source file. An inline
`style="..."` declaration has no source file, so it is labelled `内联样式`.

### Open in editor

The page / component file chips are clickable. They ask the Vite plugin to open
that file in your editor:

```jsonc
// POST /__pi_picker__/open
{ "file": "/src/components/Foo.vue" }
// -> { "ok": true, "file": "/abs/path/src/components/Foo.vue" }
```

It opens the file itself, not a line, for the same reason line numbers are not
shown: the position in the compiled stylesheet does not map to the source.

It uses [`launch-editor`](https://github.com/vitejs/launch-editor), so it detects the
editor you already have running (VS Code, Cursor, WebStorm, Sublime, vim, …) and
honours `LAUNCH_EDITOR` / `EDITOR`. The endpoint is dev-only, accepts `POST` +
JSON only, requires a local `Origin`/`Host` (a foreign website cannot drive it),
and refuses any path outside the Vite project root.

## Notes

- The Vite plugin only runs during `vite dev` (`apply: 'serve'`); it has no effect on builds.
- Discovery is per-project: the bridge whose `cwd` matches `root` (and whose process is still alive) is selected, so several projects/sessions can run side by side without cross-talk.
- If pi restarts while a page is open (new random port + token), the next send re-discovers the bridge and retries once automatically — no page refresh needed. The status poll does the same: a stale port flips to `offline` for one cycle, then rediscovers.
- The bridge never auto-submits on its own: **写入pi输入框** only fills the editor; **直接发送** is an explicit user action in the page.
- Attached screenshots are decoded to temp files under `<tmpdir>/pi-picker` and referenced by path in the composed prompt (that is what the agent reads). Files older than 24h are swept on the next session start or pick, so the directory cannot grow without bound — nothing is meant to be kept there, and nothing needs cleaning up by hand.

## Development

```bash
npm install
npm test        # end-to-end suite; starts its own Vite dev server
npm run typecheck
```

The suite drives the real browser client inside [`test/fixture`](test/fixture), a throwaway Vite app: it picks elements, types descriptions, attaches screenshots and reloads, then asserts the draft survived. It runs against `src/` and `client/` directly — no build step is needed first, and a broken client fails the tests rather than the published package.

Local runs drive your installed Chrome. To use Playwright's pinned Chromium instead, run `npx playwright install chromium` once and set `PW_BUNDLED=1`; CI always uses the pinned build. `npx playwright test --ui` and `--debug` work as usual, and a failing run keeps a trace in `test-results/`.

## Releasing

Publishing is token-free: `.github/workflows/release.yml` publishes with **Trusted Publishing (OIDC)**, so `npm publish` authenticates through a short-lived OIDC token minted by GitHub Actions and provenance is attached automatically.

One-time setup (needs an interactive 2FA challenge, so it cannot be automated):

1. npmjs.com → **Packages → pi-ele-picker → Settings → Trusted publishing** → *GitHub Actions*.
2. Fill in **Organization or user** `Himangguo`, **Repository** `pi-ele-picker`, **Workflow filename** `release.yml` (filename only, must match exactly), leave **Environment name** empty.
3. Under **Allowed actions**, enable **`npm publish`** — the default is `npm stage publish` only, and a direct `npm publish` from CI is refused without this.

Then, for every release:

```sh
npm version <x.y.z>          # commits package.json + package-lock.json and tags vX.Y.Z
git push origin main --follow-tags   # the tag push triggers the Release workflow
```

The workflow re-runs `typecheck` and `build` before publishing, and can also be triggered by hand from the **Actions** tab (its `workflow_dispatch` trigger) to re-release an existing tag.

## License

MIT
