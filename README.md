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
- The panel always opens **next to the launcher**, flipping sides and clamping to stay on screen.
- **The panel is draggable too** — grab its title bar (or any empty spot) to move it; the offset from the launcher is remembered per browser (`localStorage`), and the panel still follows the launcher while clamping itself to stay on screen.

1. Click **Pi Picker** and pick an element on the page.
2. Describe the change (paste or attach screenshots if you like).
3. Choose a delivery mode:
   - **写入pi输入框** — pre-fills the current pi input box with the composed prompt; you edit and press Enter.
   - **直接发送** — submits the composed prompt as a real user turn immediately (queued as a follow-up if pi is mid-turn).

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

`/status` needs no token, but non-loopback browser origins get `403`, so an arbitrary website cannot probe session metadata.

## Notes

- The Vite plugin only runs during `vite dev` (`apply: 'serve'`); it has no effect on builds.
- Discovery is per-project: the bridge whose `cwd` matches `root` (and whose process is still alive) is selected, so several projects/sessions can run side by side without cross-talk.
- If pi restarts while a page is open (new random port + token), the next send re-discovers the bridge and retries once automatically — no page refresh needed. The status poll does the same: a stale port flips to `offline` for one cycle, then rediscovers.
- The bridge never auto-submits on its own: **写入pi输入框** only fills the editor; **直接发送** is an explicit user action in the page.

## License

MIT
