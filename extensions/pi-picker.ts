/**
 * pi-picker bridge
 *
 * Exposes a loopback-only HTTP endpoint that receives "element picker" payloads
 * from the browser (delivered by the `pi-ele-picker` Vite plugin) and either
 * pre-fills the CURRENT pi input editor or submits a real user turn.
 *
 * This file ships inside the `pi-ele-picker` package. Install it with:
 *   pi install npm:pi-ele-picker
 * (or copy this file to ~/.pi/agent/extensions/pi-picker.ts).
 *
 * Wire protocol (POST /pick):
 *   headers: content-type: application/json
 *            x-pi-picker-token: <token from the registry file>
 *            origin:            a local origin — http(s)://localhost:<port>,
 *                               http(s)://127.0.0.1:<port>, or any loopback /
 *                               private IPv4 literal (192.168.x.x, 10.x.x.x,
 *                               172.16-31.x.x, 169.254.x.x, 0.0.0.0)
 *   body:    { text?, images?: [{name, dataUrl}], element?: {...}, url?, title?, submit? }
 *   reply:   { ok: true, mode, inserted } | { ok: true, mode, submitted, queued? }
 *            | { ok: false, error }
 *
 * Wire protocol (GET /status):
 *   reply:   { ok: true, status: "running" | "queued" | "idle", idle, pending,
 *              mode, sessionId, model, provider, pid, cwd, updatedAt }
 *
 * `/status` is polled by the browser picker to render a live session badge (the
 * launcher dot + the panel status line). It has no token: any local-origin page
 * may read it, but non-local browser origins are rejected so an arbitrary website
 * cannot probe session metadata.
 *
 * Two delivery modes:
 *   - default (submit falsy): pre-fill the current pi input editor for review.
 *   - submit: true:            deliver a real user turn immediately (queued as a follow-up
 *                              when the agent is mid-turn).
 */
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { ExtensionAPI, ExtensionUIContext } from '@earendil-works/pi-coding-agent';

const REG_DIR = join(homedir(), '.pi', 'agent', 'pi-picker');
const IMG_DIR = join(tmpdir(), 'pi-picker');
const MAX_BODY = 40 * 1024 * 1024;

function log(msg: string): void {
  try {
    process.stderr.write(`[pi-picker] ${msg}\n`);
  } catch {
    /* ignore */
  }
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
  if (a === 127 || a === 0) return true; // 127.0.0.0/8 loopback · 0.0.0.0 "this host"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  return false;
}

/**
 * `::ffff:7f00:1` (the hex form WHATWG normalises IPv4-mapped IPv6 to) and the
 * literal `::ffff:127.0.0.1` both become `127.0.0.1`; anything else is null.
 */
function v4MappedToIpv4(host: string): string | null {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

/**
 * Is this hostname the developer's own machine?
 *
 * The picker is injected by the developer's Vite dev server, which Vite binds to
 * `0.0.0.0` by default — so the page is routinely opened as
 * `http://0.0.0.0:5173`, `http://192.168.1.5:5173`, or `http://[::1]:5173`
 * rather than `http://localhost:5173`. All of those are still local, so they are
 * accepted alongside `localhost` / `*.localhost` / `127.0.0.1`.
 *
 * Only literal addresses are accepted: a *name* (`dev.internal`, `evil.com`)
 * never passes, which keeps the DNS-rebinding defence intact — that attack needs
 * a name in the Host header pointed at 127.0.0.1.
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

/** Validate a browser `Origin` header (`scheme://host[:port]`). */
function isLocalOrigin(origin: unknown): boolean {
  if (typeof origin !== 'string' || !origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // `null` (file://, sandboxed iframes) and junk land here
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isLocalHostname(url.hostname);
}

/** Validate a raw `Host` header (`host[:port]` or `[ipv6][:port]`). */
function isLocalHost(host: unknown): boolean {
  if (typeof host !== 'string' || !host) return false;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
  return isLocalHostname(bracketed ? bracketed[1] : host.replace(/:\d+$/, ''));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Force the interactive TUI to repaint after mutating the editor from outside its
 * input loop.
 *
 * `ui.pasteToEditor()` / `ui.setEditorText()` update the editor model directly but never
 * schedule a redraw — unlike real terminal input, which flows through `TUI.handleInput()`
 * and ends with `requestImmediateRender()`. Because the TUI paints on demand, an inserted
 * prompt stays invisible until some unrelated input event (e.g. the user clicking the
 * terminal) happens to repaint the screen.
 *
 * The extension UI context exposes no `requestRender()`, but `setStatus(key, undefined)` is
 * visually inert (it clears an unset footer key) and unconditionally calls
 * `ui.requestRender()` in interactive mode, so it works as a redraw nudge.
 */
function requestRepaint(ui: ExtensionUIContext): void {
  try {
    ui.setStatus('pi-picker', undefined);
  } catch {
    /* best effort — never fail the pick on a repaint nudge */
  }
}

/** Remove registry files whose owning process is gone (best-effort). */
function sweepStaleRegistry(): void {
  try {
    for (const f of readdirSync(REG_DIR)) {
      if (!f.endsWith('.json')) continue;
      const full = join(REG_DIR, f);
      try {
        const info = JSON.parse(readFileSync(full, 'utf8')) as { pid?: number };
        if (typeof info.pid !== 'number' || !isPidAlive(info.pid)) rmSync(full, { force: true });
      } catch {
        rmSync(full, { force: true });
      }
    }
  } catch {
    /* ignore */
  }
}

interface PickImage {
  name?: string;
  dataUrl?: string;
}
interface PickElement {
  selector?: string;
  tag?: string;
  id?: string;
  classes?: string[];
  text?: string;
  htmlSnippet?: string;
  rect?: { x: number; y: number; w: number; h: number };
  styles?: Record<string, string>;
  componentFile?: string;
  componentName?: string;
}
interface PickPayload {
  text?: string;
  images?: PickImage[];
  element?: PickElement;
  url?: string;
  title?: string;
  /** When true the bridge submits a real user turn instead of only pre-filling the editor. */
  submit?: boolean;
}

function saveImages(images: PickImage[] | undefined): string[] {
  const paths: string[] = [];
  (images ?? []).forEach((img, i) => {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(img?.dataUrl ?? '');
    if (!m) return;
    const ext = m[1].split('/')[1].toLowerCase().replace('jpeg', 'jpg');
    try {
      mkdirSync(IMG_DIR, { recursive: true });
      const file = join(IMG_DIR, `${Date.now()}-${i}-${randomBytes(3).toString('hex')}.${ext}`);
      writeFileSync(file, Buffer.from(m[2], 'base64'));
      paths.push(file);
    } catch (e) {
      log(`failed to save image: ${String(e)}`);
    }
  });
  return paths;
}

function compose(payload: PickPayload, imagePaths: string[]): string {
  const el = payload.element ?? {};
  const lines: string[] = [];
  lines.push('【element picker】请在前端页面中按以下信息完成修改：');
  if (payload.url) lines.push(`页面: ${payload.url}`);
  if (el.componentFile) lines.push(`组件: ${el.componentName || '(anonymous)'}  ${el.componentFile}`);
  if (el.selector) lines.push(`选择器: ${el.selector}`);
  const shorthand =
    (el.tag ?? '') +
    (el.id ? `#${el.id}` : '') +
    (el.classes && el.classes.length ? `.${el.classes.join('.')}` : '');
  if (shorthand) lines.push(`元素: ${shorthand}`);
  if (el.text) lines.push(`文本: "${el.text}"`);
  if (el.rect) lines.push(`位置/尺寸: ${el.rect.w}×${el.rect.h} @ (${el.rect.x},${el.rect.y})`);
  if (el.styles && Object.keys(el.styles).length) {
    lines.push(`关键样式: ${Object.entries(el.styles).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  }
  if (el.htmlSnippet) lines.push(`HTML 片段:\n\`\`\`html\n${el.htmlSnippet}\n\`\`\``);
  if (imagePaths.length) {
    lines.push(`截图文件（请用 Read 工具查看）:\n${imagePaths.map((f) => `- ${f}`).join('\n')}`);
  }
  lines.push('');
  lines.push('修改意见:');
  lines.push((payload.text ?? '').trim() || '（未填写，请根据以上信息优化该元素的样式/交互）');
  return lines.join('\n');
}

interface SessionStatus {
  ok: true;
  /** Coarse state for the picker UI. */
  status: 'running' | 'queued' | 'idle';
  /** Whether the agent loop is idle (not streaming). */
  idle: boolean;
  /** Whether follow-up messages are queued behind the current run. */
  pending: boolean;
  mode: string | null;
  sessionId: string | null;
  model: string | null;
  provider: string | null;
  pid: number;
  cwd: string;
  updatedAt: number;
}

/**
 * Snapshot the active session's live state for GET /status.
 *
 * Derivation is ordered so "busy" always wins: a session that is mid-run reads
 * `running` even while follow-ups are queued; only an idle session with queued
 * messages reports `queued`; everything else is `idle`.
 */
function sessionStatus(ctx: unknown): SessionStatus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = ctx as any;
  let idle = true;
  let pending = false;
  try {
    if (c && typeof c.isIdle === 'function') idle = !!c.isIdle();
    if (c && typeof c.hasPendingMessages === 'function') pending = !!c.hasPendingMessages();
  } catch {
    /* fall back to the idle/no-queue defaults */
  }
  const model = c && c.model ? c.model.name || c.model.id || null : null;
  const provider = c && c.model ? c.model.provider ?? null : null;
  return {
    ok: true,
    status: !idle ? 'running' : pending ? 'queued' : 'idle',
    idle,
    pending,
    mode: c ? c.mode ?? null : null,
    sessionId: c ? c.sessionId ?? null : null,
    model,
    provider,
    pid: process.pid,
    cwd: process.cwd(),
    updatedAt: Date.now(),
  };
}

export default function (pi: ExtensionAPI): void {
  const token = randomBytes(16).toString('hex');
  let server: Server | undefined;
  let regFile: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeCtx: any;

  async function onPick(payload: PickPayload): Promise<Record<string, unknown>> {
    const ctx = activeCtx;
    if (!ctx) return { ok: false, error: 'no active session context' };
    const imagePaths = saveImages(payload.images);
    const text = compose(payload, imagePaths);
    const ui = ctx.ui;

    // Explicit "send now" (the picker's 直接发送 button): deliver a real user turn instead
    // of only pre-filling the editor. sendUserMessage throws when a plain send happens
    // mid-turn, so queue as a follow-up while the agent is busy.
    if (payload.submit) {
      const idle = typeof ctx.isIdle === 'function' ? ctx.isIdle() : true;
      try {
        if (idle) {
          pi.sendUserMessage(text);
          return { ok: true, mode: ctx.mode ?? 'unknown', submitted: true, chars: text.length };
        }
        pi.sendUserMessage(text, { deliverAs: 'followUp' });
        return { ok: true, mode: ctx.mode ?? 'unknown', submitted: true, queued: true, chars: text.length };
      } catch (e) {
        return { ok: false, error: `submit failed: ${String(e)}` };
      }
    }

    const isTui = ctx.mode === 'tui' && ctx.hasUI !== false && ui && typeof ui.pasteToEditor === 'function';
    if (isTui) {
      ui.pasteToEditor(text);
      requestRepaint(ui);
      let editorText = '';
      try {
        editorText = String(ui.getEditorText?.() ?? '');
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        mode: 'tui',
        inserted: true,
        chars: text.length,
        editorPreview: editorText.slice(0, 160),
        editorLength: editorText.length,
      };
    }
    // Non-interactive modes have no input editor: fall back to sending.
    await pi.sendUserMessage(text);
    return { ok: true, mode: ctx.mode ?? 'unknown', sent: true, chars: text.length };
  }

  async function handle(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res: any
  ): Promise<void> {
    const origin = req.headers.origin;
    if (origin) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'content-type,x-pi-picker-token');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      // Chrome's Private Network Access: a page served from a LAN address is a
      // "private" context while the bridge on 127.0.0.1 is "local", so the
      // browser preflights with this header before any fetch. Grant the
      // permission here — the real origin gate still runs on POST /pick below.
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('access-control-allow-private-network', 'true');
      }
      res.writeHead(204);
      res.end();
      return;
    }

    const url = String(req.url ?? '/').split('?')[0];

    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: process.pid, cwd: process.cwd(), mode: activeCtx?.mode ?? null }));
      return;
    }

    if (req.method === 'GET' && url === '/status') {
      // Read-only and tokenless, so gate it on a local browser origin: reject a
      // foreign page while still allowing no-Origin callers (curl, local scripts).
      if (origin && !isLocalOrigin(origin)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(sessionStatus(activeCtx)));
      return;
    }

    if (req.method !== 'POST' || url !== '/pick') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    // SECURITY: block cross-site / DNS-rebinding requests from arbitrary pages.
    // Local dev servers that are opened via a LAN IPv4 address still count as local.
    if (!isLocalOrigin(origin)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }));
      return;
    }
    if (!isLocalHost(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden host' }));
      return;
    }
    if (req.headers['x-pi-picker-token'] !== token) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'bad token' }));
      return;
    }

    try {
      const body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            reject(new Error('payload too large'));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      const payload = JSON.parse(body.toString('utf8')) as PickPayload;
      const result = await onPick(payload);
      res.writeHead(result.ok ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    activeCtx = ctx;
    server = createServer((req, res) => {
      void handle(req, res);
    });
    server.on('error', (e) => log(`server error: ${String(e)}`));
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', () => {
        server!.off('error', reject);
        resolve();
      });
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    mkdirSync(REG_DIR, { recursive: true });
    sweepStaleRegistry();
    regFile = join(REG_DIR, `${process.pid}.json`);
    writeFileSync(
      regFile,
      JSON.stringify({
        port,
        pid: process.pid,
        cwd: process.cwd(),
        sessionId: ctx.sessionId ?? null,
        token,
        updatedAt: Date.now(),
      })
    );
    log(`bridge listening on http://127.0.0.1:${port}  cwd=${process.cwd()}`);
  });

  pi.on('session_shutdown', async () => {
    activeCtx = undefined;
    try {
      server?.close();
    } catch {
      /* ignore */
    }
    server = undefined;
    if (regFile && existsSync(regFile)) {
      try {
        rmSync(regFile, { force: true });
      } catch {
        /* ignore */
      }
    }
    regFile = undefined;
  });
}
