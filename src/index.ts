import type { Plugin } from 'vite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * pi-ele-picker
 *
 * A Vite dev-only plugin that injects the pi element picker into the page and
 * exposes a same-origin endpoint the picker uses to discover the running pi
 * bridge.
 *
 * The bridge registry is written by the pi extension at
 * `~/.pi/agent/extensions/pi-picker.ts` (or any extension implementing the same
 * `~/.pi/agent/pi-picker/<pid>.json` registry + `POST /pick` protocol).
 */

/** Directory where pi bridge extensions register themselves. */
const REG_DIR = join(homedir(), '.pi', 'agent', 'pi-picker');

/** URL prefix under which the picker client and discovery endpoint are served. */
const ENDPOINT = '/__pi_picker__';

/** Path to this package's own browser client, anchored at the plugin's install location. */
const OWN_CLIENT_FILE = fileURLToPath(new URL('../client/picker.js', import.meta.url));

/**
 * Resolve the browser client to serve. Called per request, never cached.
 *
 * The plugin module is evaluated once when the dev server boots, so anything
 * captured at module scope is frozen for the life of that process. Upgrading
 * pi-ele-picker while a dev server is running therefore used to keep serving the
 * old client forever: the frozen path still pointed at
 * `node_modules/.pnpm/pi-ele-picker@<old>/...`, pnpm leaves that directory on
 * disk, and the stale client was handed out silently — refreshing never helped.
 *
 * Resolving from the project root instead means the currently installed copy
 * wins, with no server restart.
 *
 * Two traps this deliberately avoids:
 *
 * 1. Anchoring at `import.meta.url`. From inside `.../pi-ele-picker@<old>/dist/`
 *    Node resolves `pi-ele-picker` straight back to that same old copy.
 * 2. `require.resolve()`. Node memoises resolutions in `Module._pathCache` and
 *    never invalidates them when `node_modules` changes underneath a running
 *    process, which pins the first lookup forever — the same staleness, moved.
 *
 * So the lookup is a plain filesystem walk, mirroring Node's own node_modules
 * search (upward from the project root, for workspace/monorepo layouts), and it
 * falls back to this package's own copy when nothing matches.
 */
function resolveClientFile(projectRoot: string): string | null {
  for (let dir = projectRoot; dir; ) {
    const candidate = join(dir, 'node_modules', 'pi-ele-picker', 'client', 'picker.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    dir = parent === dir ? '' : parent; // stop at the filesystem root
  }
  return existsSync(OWN_CLIENT_FILE) ? OWN_CLIENT_FILE : null;
}

export interface PiElePickerOptions {
  /**
   * Directory whose pi bridge to discover. Must match the `cwd` the pi session
   * was started in. Defaults to `process.cwd()`.
   */
  root?: string;
  /**
   * Project-level default for the in-page "session status" toggle. The picker
   * polls the bridge every 3s to show whether pi is running/idle/stopped, which
   * costs a loopback request per cycle; it is therefore **off by default**.
   *
   * This is only a default: each browser can override it with the switch in the
   * picker panel (remembered in `localStorage`). Defaults to `false`.
   */
  status?: boolean;
}

interface BridgeInfo {
  port: number;
  pid: number;
  cwd: string;
  token: string;
  updatedAt: number;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Find the freshest live bridge registered for the given project root. */
function discoverBridge(root: string): BridgeInfo | null {
  let files: string[];
  try {
    files = readdirSync(REG_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  let best: BridgeInfo | null = null;
  for (const f of files) {
    try {
      const info = JSON.parse(readFileSync(join(REG_DIR, f), 'utf8')) as BridgeInfo;
      if (info.cwd !== root) continue;
      if (!isPidAlive(info.pid)) continue;
      if (!best || info.updatedAt > best.updatedAt) best = info;
    } catch {
      /* skip malformed */
    }
  }
  return best;
}

export default function piElePicker(options: PiElePickerOptions = {}): Plugin {
  const root = options.root ?? process.cwd();
  const statusDefault = options.status ?? false;

  return {
    name: 'pi-ele-picker',
    apply: 'serve',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: `${ENDPOINT}/picker.js` },
          injectTo: 'body',
        },
      ];
    },
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (req, res, next) => {
        const url = (req.url ?? '').split('?')[0];

        if (url === '/config') {
          const info = discoverBridge(root);
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-store');
          res.end(
            JSON.stringify({
              port: info ? info.port : null,
              token: info ? info.token : null,
              statusDefault,
            })
          );
          return;
        }

        if (url === '/picker.js') {
          const clientFile = resolveClientFile(server.config.root);
          if (!clientFile) {
            res.statusCode = 404;
            res.end('pi-ele-picker client missing');
            return;
          }
          res.setHeader('content-type', 'text/javascript');
          res.setHeader('cache-control', 'no-store');
          res.end(readFileSync(clientFile));
          return;
        }

        next();
      });
    },
  };
}
