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
 *            origin:            http://localhost:<port> | http://127.0.0.1:<port>
 *   body:    { text?, images?: [{name, dataUrl}], element?: {...}, url?, title?, submit? }
 *   reply:   { ok: true, mode, inserted } | { ok: true, mode, submitted, queued? }
 *            | { ok: false, error }
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

function isLoopbackOrigin(origin: unknown): boolean {
  return typeof origin === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function isLoopbackHost(host: unknown): boolean {
  return typeof host === 'string' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
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

    if (req.method !== 'POST' || url !== '/pick') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    // SECURITY: block cross-site / DNS-rebinding requests from arbitrary pages.
    if (!isLoopbackOrigin(origin)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }));
      return;
    }
    if (!isLoopbackHost(req.headers.host)) {
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
