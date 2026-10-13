import type { Plugin } from 'vite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

/** Absolute path to the browser client that ships with this package. */
const CLIENT_FILE = fileURLToPath(new URL('../client/picker.js', import.meta.url));

export interface PiElePickerOptions {
  /**
   * Directory whose pi bridge to discover. Must match the `cwd` the pi session
   * was started in. Defaults to `process.cwd()`.
   */
  root?: string;
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
          res.end(JSON.stringify(info ? { port: info.port, token: info.token } : { port: null }));
          return;
        }

        if (url === '/picker.js') {
          if (!existsSync(CLIENT_FILE)) {
            res.statusCode = 404;
            res.end('pi-ele-picker client missing');
            return;
          }
          res.setHeader('content-type', 'text/javascript');
          res.setHeader('cache-control', 'no-store');
          res.end(readFileSync(CLIENT_FILE));
          return;
        }

        next();
      });
    },
  };
}
