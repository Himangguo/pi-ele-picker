import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
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
  /**
   * Serve `POST /__pi_picker__/open`, which opens a matched source file at the
   * reported line in the developer's editor (via `launch-editor`). Enabled by
   * default; set to `false` to keep the picker fully read-only.
   */
  openInEditor?: boolean;
}

interface BridgeInfo {
  port: number;
  pid: number;
  cwd: string;
  token: string;
  updatedAt: number;
}

/** Loopback / private / link-local / "this host" IPv4 literals. */
function isLocalIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (n > 255) return false;
    octets.push(n);
  }
  const [a, b] = octets;
  if (a === 127 || a === 0) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** `::ffff:7f00:1` (WHATWG's hex IPv4-mapped IPv6 form) -> `127.0.0.1`. */
function v4MappedToIpv4(host: string): string | null {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

/**
 * Is this hostname the developer's own machine? Literal addresses only, which
 * keeps the DNS-rebinding defence intact (a name in the Host header never
 * passes). Mirrors the check in `extensions/pi-picker.ts`; the extension ships
 * standalone, so the two copies cannot share code.
 */
function isLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  if (host.startsWith('::ffff:')) {
    return isLocalIpv4(v4MappedToIpv4(host) ?? host.slice('::ffff:'.length));
  }
  return isLocalIpv4(host);
}

function isLocalOrigin(origin: unknown): boolean {
  if (typeof origin !== 'string' || !origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isLocalHostname(url.hostname);
}

function isLocalHostHeader(host: unknown): boolean {
  if (typeof host !== 'string' || !host) return false;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
  return isLocalHostname(bracketed ? bracketed[1] : host.replace(/:\d+$/, ''));
}

/** Everything inside `root` (and `root` itself), nothing outside it. */
function isInsideRoot(root: string, file: string): boolean {
  return file === root || file.startsWith(root + sep);
}

type OpenTarget = { ok: true; file: string } | { ok: false; status: number; error: string };

/**
 * Turn whatever the browser reported into a real file inside the Vite root.
 *
 * The input is usually a `data-vite-dev-id` value — a root-relative module URL
 * such as `/src/components/Foo.vue?vue&type=style&index=0&lang.css` — but the
 * panel can also hand back a Vue `__file` absolute path. Both are accepted, as
 * long as the resolved file exists and stays inside the project root: an endpoint
 * that spawns an editor must never be talked into opening `/etc/passwd`.
 */
function resolveProjectFile(root: string, raw: string): OpenTarget {
  if (typeof raw !== 'string' || !raw || raw.includes('\0')) {
    return { ok: false, status: 400, error: 'invalid file' };
  }
  let path = raw.split('#')[0].split('?')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    return { ok: false, status: 400, error: 'invalid file encoding' };
  }
  if (path.startsWith('/@fs/')) path = path.slice('/@fs/'.length);

  const rootAbs = resolve(root);
  const candidates: string[] = [];
  if (isAbsolute(path)) {
    candidates.push(resolve(path));
    candidates.push(resolve(rootAbs, '.' + path)); // root-relative URL path
  } else {
    candidates.push(resolve(rootAbs, path));
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (isInsideRoot(rootAbs, candidate)) return { ok: true, file: candidate };
  }
  // Prefer an inside-root interpretation over a rejecting one: a root-relative
  // URL like `/src/a.css` may coincidentally exist at the filesystem root too.
  const outside = candidates.some((c) => existsSync(c) && !isInsideRoot(rootAbs, c));
  return outside
    ? { ok: false, status: 403, error: 'file outside project root' }
    : { ok: false, status: 404, error: 'file not found' };
}

/** Read a small JSON body. Any error becomes a rejected promise. */
function readJsonBody(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buf.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolvePromise(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
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
  const openInEditor = options.openInEditor ?? true;

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

        if (url === '/open') {
          if (!openInEditor) {
            res.statusCode = 403;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'openInEditor disabled' }));
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'POST');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'POST required' }));
            return;
          }
          // A foreign page must not be able to make the dev server launch an
          // editor. POST + JSON already forces a CORS preflight cross-origin;
          // the origin/host gate is the second lock. No Origin (curl, local
          // scripts) is allowed.
          const origin = req.headers.origin;
          if ((origin && !isLocalOrigin(origin)) || !isLocalHostHeader(req.headers.host)) {
            res.statusCode = 403;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }));
            return;
          }
          readJsonBody(req)
            .then(async (body) => {
              const target = resolveProjectFile(server.config.root, String(body.file ?? ''));
              if (!target.ok) {
                res.statusCode = target.status;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ ok: false, error: target.error }));
                return;
              }
              const line = positiveInt(body.line);
              const column = positiveInt(body.column);
              try {
                // Dynamic import keeps the dependency optional at runtime: a
                // project without it still gets a clear error instead of a crash
                // on server boot.
                const { default: launchEditor } = await import('launch-editor');
                const spec = line ? `${target.file}:${line}:${column ?? 1}` : target.file;
                launchEditor(spec, (file, error) => {
                  if (error) console.warn(`[pi-ele-picker] could not open ${file}: ${error}`);
                });
              } catch (e) {
                res.statusCode = 501;
                res.setHeader('content-type', 'application/json');
                res.end(
                  JSON.stringify({
                    ok: false,
                    error: `launch-editor unavailable: ${String(e)}`,
                  })
                );
                return;
              }
              res.setHeader('content-type', 'application/json');
              res.setHeader('cache-control', 'no-store');
              res.end(JSON.stringify({ ok: true, file: target.file, line: line ?? null, column: column ?? null }));
            })
            .catch((e: Error) => {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: e.message }));
            });
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
