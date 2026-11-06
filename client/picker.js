/* pi element picker (browser client)
 *
 * Injected by the Vite `pi-picker` plugin into the dev page. Lets you hover +
 * click an element, describe a change (text + pasted/attached screenshots) and
 * either pre-fill the running pi session's input box (写入pi输入框) or submit the
 * composed prompt as a real user turn right away (直接发送), via the local bridge.
 *
 * No frameworks, no build step. Everything lives in a shadow root so the host
 * app's styles never leak in or out.
 */
(function () {
  if (window.__PI_PICKER__) return;
  window.__PI_PICKER__ = true;

  var CFG_URL = '/__pi_picker__/config';
  var OPEN_URL = '/__pi_picker__/open';
  var cfg = { port: null, token: null };

  var STYLE_KEYS = [
    'display',
    'position',
    'width',
    'height',
    'margin',
    'padding',
    'color',
    'background-color',
    'font-size',
    'font-weight',
    'line-height',
    'border',
    'border-radius',
    'box-shadow',
    'text-align',
    'gap',
    'justify-content',
    'align-items',
  ];

  var CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; }',
    '.hl { position: fixed; pointer-events: none; border: 2px solid #4f46e5; background: rgba(79,70,229,.12); border-radius: 4px; z-index: 2147483646; display: none; }',
    '.hl .tag { position: absolute; top: -22px; left: 0; background: #4f46e5; color: #fff; font-size: 11px; line-height: 18px; padding: 0 6px; border-radius: 4px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }',
    '.trigger { position: fixed; z-index: 2147483646; pointer-events: auto; display: flex; align-items: center; gap: 6px; background: #4f46e5; color: #fff; border: none; border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: grab; box-shadow: 0 6px 18px rgba(79,70,229,.4); opacity: .5; transition: opacity .18s ease, background-color .18s ease; touch-action: none; user-select: none; -webkit-user-select: none; }',
    '.trigger:hover, .trigger:focus-visible, .trigger.dragging, .trigger.active { opacity: 1; }',
    '.trigger:hover { background: #4338ca; }',
    '.trigger.dragging { cursor: grabbing; }',
    '.trigger.active { background: #059669; }',
    '.dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: #6b7280; transition: background-color .2s ease; }',
    '.dot.st-running { background: #34d399; animation: pipulse 1.4s ease-out infinite; }',
    '.dot.st-queued { background: #fbbf24; }',
    '.dot.st-idle { background: #9a9aa5; }',
    '.dot.st-offline { background: #f87171; }',
    '.dot.st-unknown { background: #6b7280; }',
    '.dot.st-off { background: transparent; box-shadow: inset 0 0 0 1.5px #6b7280; }',
    '@keyframes pipulse { 0% { box-shadow: 0 0 0 0 rgba(52,211,153,.6); } 70% { box-shadow: 0 0 0 6px rgba(52,211,153,0); } 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); } }',
    '.session { display: flex; align-items: center; gap: 6px; padding: 8px 12px 0; color: #b9b9c2; font-size: 11px; }',
    '.session .st { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.sw { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; cursor: pointer; color: #9a9aa5; }',
    '.sw input { appearance: none; -webkit-appearance: none; width: 28px; height: 16px; margin: 0; border-radius: 999px; background: #34353d; position: relative; cursor: pointer; transition: background-color .15s ease; }',
    '.sw input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #cfcfd6; transition: transform .15s ease; }',
    '.sw input:checked { background: #4f46e5; }',
    '.sw input:checked::after { transform: translateX(12px); background: #fff; }',
    '.sw input:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }',
    '.sw .sw-label { font-size: 11px; }',
    '.panel { position: fixed; width: 380px; max-width: calc(100vw - 36px); z-index: 2147483647; pointer-events: auto; background: #1b1c22; color: #e7e7ea; border: 1px solid #34353d; border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.5); font-size: 13px; display: none; }',
    '.panel.open { display: block; }',
    '.hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2b2c33; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }',
    '.hd .title { font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.hd .close { background: transparent; border: none; color: #9a9aa5; font-size: 16px; cursor: pointer; line-height: 1; }',
    '.panel.dragging { user-select: none; -webkit-user-select: none; }',
    '.panel.dragging .hd { cursor: grabbing; }',
    '.meta { padding: 8px 12px 0; color: #9a9aa5; font-size: 11px; line-height: 1.5; word-break: break-all; }',
    '.meta code { color: #a5b4fc; }',
    '.meta .comp { margin-top: 2px; }',
    '.css { margin-top: 4px; display: flex; flex-direction: column; gap: 3px; }',
    '.css-row { line-height: 1.45; }',
    '.css-prop { color: #c4b5fd; }',
    '.css-val { color: #e7e7ea; }',
    '.css-sel { color: #a5b4fc; }',
    '.css-inline { color: #9a9aa5; }',
    '.src { display: inline; background: transparent; border: none; padding: 0; margin: 0; color: #67e8f9; font-size: 11px; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; word-break: normal; }',
    '.src:hover { color: #a5f3fc; text-decoration-style: solid; }',
    'textarea { display: block; width: calc(100% - 24px); margin: 8px 12px 0; min-height: 72px; max-height: 200px; resize: vertical; background: #111218; color: #e7e7ea; border: 1px solid #34353d; border-radius: 8px; padding: 8px 10px; font-size: 13px; outline: none; }',
    'textarea:focus { border-color: #4f46e5; }',
    '.shots { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 0; }',
    '.shot { position: relative; width: 56px; height: 56px; border-radius: 6px; overflow: hidden; border: 1px solid #34353d; }',
    '.shot img { width: 100%; height: 100%; object-fit: cover; display: block; }',
    '.shot .x { position: absolute; top: 0; right: 0; background: rgba(0,0,0,.65); color: #fff; border: none; width: 16px; height: 16px; font-size: 11px; line-height: 1; cursor: pointer; }',
    '.ft { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }',
    '.ft .spacer { flex: 1; }',
    '.btn { border: 1px solid #34353d; background: #26272e; color: #cfcfd6; border-radius: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; }',
    '.btn:hover { background: #2f3038; }',
    '.btn.go { background: #059669; border-color: #059669; color: #fff; font-weight: 600; }',
    '.btn.go:hover { background: #047857; }',
    '.btn:disabled { opacity: .55; cursor: default; }',
    '.status { padding: 0 12px 10px; font-size: 11px; min-height: 14px; color: #9a9aa5; }',
    '.status.ok { color: #34d399; }',
    '.status.err { color: #f87171; }',
    '.hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); z-index: 2147483647; pointer-events: none; background: #4f46e5; color: #fff; font-size: 12px; padding: 6px 14px; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.35); display: none; }',
  ].join('\n');

  var host = document.createElement('div');
  host.id = '__pi_picker_host__';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  var hl = document.createElement('div');
  hl.className = 'hl';
  var hlTag = document.createElement('div');
  hlTag.className = 'tag';
  hl.appendChild(hlTag);
  root.appendChild(hl);

  var hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '点击页面元素进行选择（Esc 取消）';
  root.appendChild(hint);

  var trigger = document.createElement('button');
  trigger.className = 'trigger';
  trigger.type = 'button';
  var triggerDot = document.createElement('span');
  triggerDot.className = 'dot st-off';
  trigger.appendChild(triggerDot);
  trigger.appendChild(document.createTextNode('Pi Picker'));
  trigger.title = '拖拽可移动 · 面板标题栏也可拖拽 · 悬浮可再次打开上次元素 · 点击开始选择元素';
  root.appendChild(trigger);

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<div class="hd"><div class="title">元素修改</div><button class="close" type="button" title="关闭">✕</button></div>' +
    '<div class="session"><span class="dot st-off"></span><span class="st">状态显示已关闭</span><label class="sw" title="每 3 秒同步一次 pi 会话状态；关闭后不再发起任何轮询请求"><input type="checkbox" class="status-toggle" /><span class="sw-label">状态</span></label></div>' +
    '<div class="meta"></div>' +
    '<textarea placeholder="描述你想要的修改，例如：把这个按钮改成圆角主色、增加 hover 效果…（可直接粘贴截图）"></textarea>' +
    '<div class="shots"></div>' +
    '<div class="ft"><button class="btn attach" type="button">📎 添加图片</button><span class="spacer"></span><button class="btn send" type="button">写入pi输入框</button><button class="btn go send-now" type="button">直接发送</button></div>' +
    '<div class="status"></div>' +
    '<input class="file" type="file" accept="image/*" multiple style="display:none" />';
  root.appendChild(panel);

  var metaEl = panel.querySelector('.meta');
  var sessionDot = panel.querySelector('.session .dot');
  var sessionText = panel.querySelector('.session .st');
  var statusToggle = panel.querySelector('.status-toggle');
  var taEl = panel.querySelector('textarea');
  var shotsEl = panel.querySelector('.shots');
  var statusEl = panel.querySelector('.status');
  var sendBtn = panel.querySelector('.send');
  var sendNowBtn = panel.querySelector('.send-now');
  var attachBtn = panel.querySelector('.attach');
  var closeBtn = panel.querySelector('.close');
  var fileEl = panel.querySelector('.file');

  var picking = false;
  // The captured element the panel acts on. Stays put across close/reopen so
  // hovering the launcher can bring the panel back without overwriting it.
  var target = null;
  // The selector `target` was captured through. Kept so the draft can be
  // re-attached after a reload replaces the DOM node `target` points at.
  var targetSelector = null;
  // Everything about the target captured at pick time. Sending must not depend on
  // the node still being on the page — see elementPayload().
  var targetSnapshot = null;
  // The URL the target was picked on. A selector only identifies an element within
  // one document: after a route change the same selector may hit a lookalike.
  var targetUrl = null;
  var shots = [];
  // Set when a pick commits on pointerdown; swallows the follow-up click so the
  // page (links, buttons) never reacts to the click that finished the pick.
  var swallowClick = false;
  // Set when the user closes the panel themselves, so a reload does not pop it
  // back open on top of whatever they moved on to.
  var panelDismissed = false;

  document.documentElement.appendChild(host);

  /* --- launcher: draggable, fades when idle, and stays inside the viewport --- */
  var POS_KEY = 'pi-ele-picker:pos:v1';
  var EDGE = 8;
  var suppressClick = false;
  var drag = null;

  /* --- panel: independently draggable, remembered as an offset from the anchor --- */
  var PANEL_OFS_KEY = 'pi-ele-picker:panel-ofs:v1';
  var panelOffset = { dx: 0, dy: 0 };
  var panelDrag = null;

  function loadPanelOffset() {
    try {
      var o = JSON.parse(localStorage.getItem(PANEL_OFS_KEY) || 'null');
      if (o && typeof o.dx === 'number' && typeof o.dy === 'number') return { dx: o.dx, dy: o.dy };
    } catch (e) {
      /* storage unavailable — fall back to the anchored position */
    }
    return { dx: 0, dy: 0 };
  }

  function savePanelOffset() {
    try {
      localStorage.setItem(PANEL_OFS_KEY, JSON.stringify(panelOffset));
    } catch (e) {
      /* storage unavailable — ignore */
    }
  }

  // Hide until positioned to avoid a flash at the origin.
  trigger.style.visibility = 'hidden';

  function clampLauncher(x, y) {
    var w = trigger.offsetWidth || 44;
    var h = trigger.offsetHeight || 34;
    var maxX = Math.max(EDGE, window.innerWidth - w - EDGE);
    var maxY = Math.max(EDGE, window.innerHeight - h - EDGE);
    return { x: Math.max(EDGE, Math.min(x, maxX)), y: Math.max(EDGE, Math.min(y, maxY)) };
  }

  function setLauncherPos(x, y) {
    var p = clampLauncher(x, y);
    trigger.style.left = p.x + 'px';
    trigger.style.top = p.y + 'px';
    trigger.style.right = 'auto';
    trigger.style.bottom = 'auto';
  }

  function launcherPos() {
    return { x: parseFloat(trigger.style.left) || 0, y: parseFloat(trigger.style.top) || 0 };
  }

  function saveLauncherPos() {
    try {
      var p = launcherPos();
      localStorage.setItem(POS_KEY, JSON.stringify(p));
    } catch (e) {
      /* storage unavailable — ignore */
    }
  }

  function loadLauncherPos() {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function initLauncherPos() {
    var w = trigger.offsetWidth || 44;
    var h = trigger.offsetHeight || 34;
    var saved = loadLauncherPos();
    // Default to the bottom-right corner — least likely to sit on top of content.
    setLauncherPos(
      saved ? saved.x : window.innerWidth - w - 18,
      saved ? saved.y : window.innerHeight - h - 18
    );
    trigger.style.visibility = '';
  }

  /** Where the panel sits until it is dragged: next to the launcher, flipping sides to stay in view. */
  function panelBasePos() {
    var gap = 10;
    var m = 10;
    var t = trigger.getBoundingClientRect();
    var pw = panel.offsetWidth || 380;
    var ph = panel.offsetHeight || 320;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var top = t.top + t.height / 2 > vh / 2 ? t.top - gap - ph : t.bottom + gap;
    var left = t.left + t.width / 2 > vw / 2 ? t.right - pw : t.left;
    return { left: Math.max(m, Math.min(left, vw - pw - m)), top: Math.max(m, Math.min(top, vh - ph - m)) };
  }

  function clampPanelPos(left, top) {
    var m = 10;
    var pw = panel.offsetWidth || 380;
    var ph = panel.offsetHeight || 320;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    return {
      left: Math.max(m, Math.min(left, vw - pw - m)),
      top: Math.max(m, Math.min(top, vh - ph - m)),
    };
  }

  function setPanelPos(left, top) {
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  /** Anchor the panel next to the launcher, plus whatever offset the user dragged it by. */
  function positionPanel() {
    if (!panel.classList.contains('open')) return;
    var b = panelBasePos();
    var p = clampPanelPos(b.left + panelOffset.dx, b.top + panelOffset.dy);
    setPanelPos(p.left, p.top);
  }

  trigger.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearHoverOpen();
    var r = trigger.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    try {
      trigger.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  });

  trigger.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.sx;
    var dy = e.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    suppressClick = true;
    trigger.classList.add('dragging');
    setLauncherPos(drag.ox + dx, drag.oy + dy);
    positionPanel();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var moved = drag.moved;
    drag = null;
    trigger.classList.remove('dragging');
    try {
      trigger.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (moved) saveLauncherPos();
  }
  trigger.addEventListener('pointerup', endDrag);
  trigger.addEventListener('pointercancel', endDrag);

  /* --- panel drag: grab the title bar (or any area that is not interactive) --- */
  /**
   * Children that own the pointer keep their native behaviour: typing, clicking,
   * selecting the selector text, dropping images. Everything else is a drag handle.
   */
  function isInteractiveNode(node) {
    if (!node || typeof node.closest !== 'function') return false;
    return !!node.closest('textarea, input, button, label, select, a, img, .meta, .shot, [contenteditable="true"]');
  }

  panel.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isInteractiveNode(e.target)) return;
    var r = panel.getBoundingClientRect();
    panelDrag = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: r.left,
      oy: r.top,
      base: panelBasePos(),
      moved: false,
    };
    try {
      panel.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    e.preventDefault();
  });

  panel.addEventListener('pointermove', function (e) {
    if (!panelDrag || e.pointerId !== panelDrag.id) return;
    var dx = e.clientX - panelDrag.sx;
    var dy = e.clientY - panelDrag.sy;
    if (!panelDrag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    panelDrag.moved = true;
    panel.classList.add('dragging');
    var p = clampPanelPos(panelDrag.ox + dx, panelDrag.oy + dy);
    setPanelPos(p.left, p.top);
    // Store the drag as an offset from the anchor so the panel keeps following the launcher.
    panelOffset = { dx: p.left - panelDrag.base.left, dy: p.top - panelDrag.base.top };
  });

  function endPanelDrag(e) {
    if (!panelDrag || e.pointerId !== panelDrag.id) return;
    var moved = panelDrag.moved;
    panelDrag = null;
    panel.classList.remove('dragging');
    try {
      panel.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (moved) savePanelOffset();
  }
  panel.addEventListener('pointerup', endPanelDrag);
  panel.addEventListener('pointercancel', endPanelDrag);

  window.addEventListener('resize', function () {
    var p = launcherPos();
    setLauncherPos(p.x, p.y);
    positionPanel();
  });

  initLauncherPos();
  panelOffset = loadPanelOffset();

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function elFromEvent(e) {
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.indexOf(host) !== -1) return null;
    var el = e.target;
    if (!el || el.nodeType !== 1) return null;
    return el;
  }

  function showHighlight(el) {
    var r = el.getBoundingClientRect();
    hl.style.display = 'block';
    hl.style.left = r.left + 'px';
    hl.style.top = r.top + 'px';
    hl.style.width = r.width + 'px';
    hl.style.height = r.height + 'px';
    hlTag.textContent = describeShort(el);
  }

  function describeShort(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  }

  function hideHighlight() {
    hl.style.display = 'none';
  }

  function onMove(e) {
    var el = elFromEvent(e);
    if (!el) return;
    // Highlight only: `target` is replaced solely by a committed pick, so Esc
    // or pausing on another element never clobbers the panel's element.
    showHighlight(el);
  }

  /**
   * Commit the pick on `pointerdown`, not `click`: disabled form controls never
   * dispatch `click` (so they could never be picked), but `pointerdown` still
   * fires on them with the correct target.
   */
  function onPointerDown(e) {
    if (e.button !== 0) return;
    var el = elFromEvent(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    // preventDefault above only cancels the compat mousedown/mouseup, not the
    // click, so flag it for the one-shot click swallower below. The flag is
    // cleared at the start of every pointerdown (see the always-on listener at
    // the bottom), so it can never strand on a disabled target — which fires
    // pointerdown but no click at all — and eat an unrelated later click.
    swallowClick = true;
    setPicking(false);
    select(el);
  }

  function onClick(e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      setPicking(false);
      setStatus('');
    }
  }

  function setPicking(on) {
    picking = on;
    trigger.classList.toggle('active', on);
    hint.style.display = on ? 'block' : 'none';
    trigger.style.display = on ? 'none' : 'flex';
    if (on) {
      // Picking means "choose another element": hide the panel so it never
      // covers the page. It reopens when the new pick commits, and the previous
      // element only gets replaced at that point.
      clearHoverOpen();
      panel.classList.remove('open');
      hideHighlight();
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('keydown', onKey, true);
    } else {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      hideHighlight();
    }
  }

  /**
   * Re-show the panel for the element already captured — no re-pick, no overwrite.
   *
   * A snapshot is enough to reopen: the developer may have navigated away from the
   * page that element lives on, and losing access to their own draft over that
   * would be the wrong trade. The highlight is simply skipped when there is
   * nothing on screen to outline.
   */
  function openPanel() {
    var el = resolveTarget();
    if (!el && !targetSnapshot) return false;
    panel.classList.add('open');
    if (el) showHighlight(el);
    else hideHighlight();
    positionPanel();
    return true;
  }

  function select(el) {
    target = el;
    targetSelector = cssPath(el);
    targetSnapshot = describe(el);
    targetUrl = location.href;
    // A new pick re-arms the draft: the user is working again, so a reload must
    // bring the panel back even if they closed it earlier.
    panelDismissed = false;
    metaEl.innerHTML = metaHtml(targetSnapshot);
    openPanel();
    saveDraft();
    taEl.focus();
  }

  /**
   * The element description handed to the bridge is chosen in send(), because the
   * choice between a live read and the snapshot has to be reported to the user.
   * Describing a detached node is never an option: `getComputedStyle()` and
   * `getBoundingClientRect()` return nothing useful once it leaves the document, so
   * the fallback has to be the captured value, not a fresh read.
   */

  function shortPath(p) {
    var parts = String(p).split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : String(p);
  }

  /** A clickable source chip. Only files are opened; compiled CSS has no
   *  trustworthy line number to jump to. */
  function srcButton(file, label) {
    if (!file) return '';
    var attrs = ' type="button" class="src" data-open="1" data-file="' + escapeHtml(file) + '"';
    var title = '在编辑器中打开 ' + file;
    return '<button' + attrs + ' title="' + escapeHtml(title) + '">' + escapeHtml(label || shortPath(file)) + '</button>';
  }

  /** The winning Vite-source rule per tracked property, e.g. background-color <- .btn. */
  function propRows(winners) {
    var keys = [];
    for (var i = 0; i < STYLE_KEYS.length; i++) if (winners[STYLE_KEYS[i]]) keys.push(STYLE_KEYS[i]);
    if (!keys.length) return '';
    var html = '<div class="css">';
    keys.forEach(function (k) {
      var w = winners[k];
      var src = w.inline
        ? '<span class="css-inline">内联样式</span>'
        : srcButton(w.file);
      html +=
        '<div class="css-row"><span class="css-prop">' + escapeHtml(k) + '</span>: <span class="css-val">' +
        escapeHtml(w.value) + '</span> ' +
        src +
        '</div>';
    });
    return html + '</div>';
  }

  /** Fallback for old snapshots that only carry the matched source list. */
  function sourceRows(sources) {
    if (!sources || !sources.length) return '';
    var html = '<div class="css">';
    sources.slice(0, 4).forEach(function (s) {
      var props = [];
      Object.keys(s.declarations || {}).forEach(function (k) {
        if (props.length < 4) props.push(k + ': ' + s.declarations[k]);
      });
      html +=
        '<div class="css-row"><span class="css-sel">' + escapeHtml(s.selector) + '</span> ' +
        srcButton(s.file) +
        (props.length ? '<br><span class="css-val">' + escapeHtml(props.join('; ')) + '</span>' : '') +
        '</div>';
    });
    return html + '</div>';
  }

  function metaHtml(data) {
    if (!data) return '';
    var html = '<code>' + escapeHtml(data.selector || '') + '</code>';
    if (data.componentFile) {
      html +=
        '<div class="comp">组件: ' +
        srcButton(
          data.componentFile,
          null,
          (data.componentName ? data.componentName + ' ' : '') + shortPath(data.componentFile)
        ) +
        '</div>';
    }
    if (data.styleWinners && Object.keys(data.styleWinners).length) html += propRows(data.styleWinners);
    else if (data.styleSources && data.styleSources.length) html += sourceRows(data.styleSources);
    return html;
  }

  function renderMeta(el) {
    try {
      metaEl.innerHTML = metaHtml(describe(el));
    } catch (e) {
      metaEl.innerHTML = '<code>' + escapeHtml(cssPath(el)) + '</code>';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      var sel = cur.tagName.toLowerCase();
      if (cur.id) {
        sel += '#' + cur.id;
        parts.unshift(sel);
        break;
      }
      if (cur.classList && cur.classList.length) {
        sel += '.' + Array.prototype.slice.call(cur.classList, 0, 2).join('.');
      }
      var parent = cur.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === cur.tagName;
        });
        if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(sel);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function vueInfo(el) {
    var node = el;
    while (node) {
      var vc = node.__vueParentComponent;
      if (vc) {
        var c = vc;
        while (c) {
          var t = c.type || {};
          var file = t.__file;
          if (file && String(file).indexOf('node_modules') === -1) {
            return { componentFile: file, componentName: t.name || t.__name || '' };
          }
          c = c.parent;
        }
      }
      node = node.parentElement;
    }
    return {};
  }

  /* --- style source tracing ------------------------------------------------
   *
   * Vite injects every dev stylesheet as `<style data-vite-dev-id="...">`,
   * where the id is the source module URL, e.g.
   *   /src/components/Foo.vue?vue&type=style&index=0&scoped=abc&lang.css
   *
   * That is the whole trick: the CSSOM already knows which rules match the
   * element, and the id names the file they came from. Computed styles alone
   * cannot answer "where do I edit this" — this can.
   *
   * Only the file is reported, never a line number. The injected text is the
   * *compiled* CSS (SCSS/Vue scoped/Tailwind/PostCSS), so a line counted there
   * does not exist in the source file and would be actively misleading.
   */
  var MAX_TRACED_RULES = 20000;
  var MAX_TRACED_SOURCES = 8;

  function stripDevQuery(id) {
    var s = String(id);
    var q = s.indexOf('?');
    return q === -1 ? s : s.slice(0, q);
  }

  /** Pseudo-elements cannot be matched by Element.matches(); drop them. */
  function matchableSelector(selectorText) {
    return selectorText
      .replace(/::(before|after|first-line|first-letter|selection|placeholder|marker|backdrop|file-selector-button)\b/gi, '')
      .replace(/:(before|after|first-line|first-letter)\b/gi, '')
      .trim();
  }

  function selectorMatches(el, selectorText) {
    var sel = matchableSelector(selectorText);
    if (!sel) return false;
    try {
      return el.matches(sel);
    } catch (e) {
      return false; // invalid or unsupported selector
    }
  }

  function groupMatches(rule) {
    var name = rule.constructor && rule.constructor.name;
    if (name === 'CSSMediaRule') {
      try {
        return window.matchMedia(rule.media.mediaText).matches;
      } catch (e) {
        return true;
      }
    }
    if (name === 'CSSSupportsRule') {
      try {
        return !window.CSS || !CSS.supports || CSS.supports(rule.conditionText);
      } catch (e) {
        return true;
      }
    }
    // @layer and @container: assume they apply rather than hiding a real source.
    return true;
  }

  function readDeclarations(rule) {
    var out = {};
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var k = STYLE_KEYS[i];
      var v = rule.style && rule.style.getPropertyValue(k);
      if (v) out[k] = v;
    }
    return out;
  }

  /** Crude specificity (a*10000 + b*100 + c) — enough to order the cascade. */
  function specificity(selectorText) {
    var a = 0;
    var b = 0;
    var c = 0;
    var s = selectorText.replace(/"[^"]*"|'[^']*'/g, '');
    s = s.replace(/\[[^\]]*\]/g, function () {
      b++;
      return '';
    });
    s = s.replace(/#[\w-]+/g, function () {
      a++;
      return '';
    });
    s = s.replace(/\.[\w-]+/g, function () {
      b++;
      return '';
    });
    s = s.replace(/::[\w-]+/g, function () {
      c++;
      return '';
    });
    s = s.replace(/:([\w-]+)(\([^)]*\))?/g, function () {
      b++;
      return '';
    });
    s = s.replace(/[\w-]+/g, function () {
      c++;
      return '';
    });
    return a * 10000 + b * 100 + c;
  }

  function walkSheet(rules, el, devId, bucket, active) {
    for (var i = 0; i < rules.length; i++) {
      if (bucket.count >= MAX_TRACED_RULES) return;
      var rule = rules[i];
      if (rule.style && typeof rule.selectorText === 'string') {
        bucket.count++;
        if (active && selectorMatches(el, rule.selectorText)) {
          var decls = readDeclarations(rule);
          if (Object.keys(decls).length) {
            bucket.list.push({
              file: stripDevQuery(devId),
              selector: rule.selectorText,
              specificity: specificity(rule.selectorText),
              declarations: decls,
            });
          }
        }
      } else if (rule.cssRules) {
        walkSheet(rule.cssRules, el, devId, bucket, active && groupMatches(rule));
      }
    }
  }

  /** All Vite-source rules matching `el`, plus the winning source per property. */
  function styleTrace(el) {
    var bucket = { count: 0, list: [] };
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length && bucket.count < MAX_TRACED_RULES; i++) {
      var sheet = sheets[i];
      var node = sheet.ownerNode;
      if (!node || node.nodeType !== 1 || !node.getAttribute) continue;
      var devId = node.getAttribute('data-vite-dev-id');
      if (!devId) continue;
      var rules;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        continue; // cross-origin sheet: unreadable by design
      }
      if (!rules) continue;
      walkSheet(rules, el, devId, bucket, true);
    }

    // Low specificity first, later rules last: the last write per property wins.
    var ordered = bucket.list
      .map(function (source, order) {
        return { source: source, order: order };
      })
      .sort(function (x, y) {
        return x.source.specificity - y.source.specificity || x.order - y.order;
      });

    var winners = {};
    ordered.forEach(function (entry) {
      Object.keys(entry.source.declarations).forEach(function (key) {
        winners[key] = {
          file: entry.source.file,
          selector: entry.source.selector,
          value: entry.source.declarations[key],
        };
      });
    });

    var sources = ordered
      .slice()
      .reverse()
      .slice(0, MAX_TRACED_SOURCES)
      .map(function (entry) {
        return entry.source;
      });

    return { sources: sources, winners: winners };
  }

  /** Only the element's own text, never a wrapper's whole subtree of copy. */
  function directText(el) {
    var parts = [];
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        var t = String(n.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
      }
    }
    return parts.join(' ').slice(0, 160);
  }

  function classSuffix(el) {
    if (!el.classList || !el.classList.length) return '';
    return '.' + Array.prototype.slice.call(el.classList, 0, 4).join('.');
  }

  /**
   * One level of structure, not the whole subtree.
   *
   * `outerHTML` on a card is thousands of characters of grandchildren, inline SVG
   * and nested markup — the useful part (this layer's tag/classes and the shape
   * of its direct children) drowns. This keeps exactly that shell, collapses
   * repeated siblings, and stays tiny.
   */
  function skeleton(el) {
    var head = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + classSuffix(el);
    var kids = [];
    var seen = {};
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      var key = child.tagName.toLowerCase() + (child.id ? '#' + child.id : '') + classSuffix(child);
      if (seen[key]) continue;
      seen[key] = true;
      kids.push(key);
      if (kids.length >= 12) {
        kids.push('…');
        break;
      }
    }
    return head + (kids.length ? ' > ' + kids.join(', ') : '');
  }

  function stylesOf(el) {
    var cs = window.getComputedStyle(el);
    var out = {};
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var k = STYLE_KEYS[i];
      var v = cs.getPropertyValue(k);
      if (v) out[k] = v;
    }
    return out;
  }

  function describe(el) {
    if (!el) return undefined;
    var r = el.getBoundingClientRect();
    var v = vueInfo(el);
    var trace = styleTrace(el);
    // A `style="..."` declaration beats any stylesheet rule and has no source
    // file. Say so instead of pointing at a rule that is not actually winning.
    var winners = trace.winners;
    if (el.style && el.style.length) {
      var merged = {};
      Object.keys(winners).forEach(function (k) {
        merged[k] = winners[k];
      });
      for (var wi = 0; wi < STYLE_KEYS.length; wi++) {
        var wk = STYLE_KEYS[wi];
        var wv = el.style.getPropertyValue(wk);
        if (wv) merged[wk] = { inline: true, value: wv };
      }
      winners = merged;
    }
    // Prefer the element's own text. A wrapper's `textContent` is the whole
    // page's copy, which tells the agent nothing about the thing that was picked;
    // only fall back to it for a leaf with no direct text node at all.
    var text = directText(el);
    if (!text && !el.children.length) text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: el.classList ? Array.prototype.slice.call(el.classList, 0, 8) : [],
      text: text || undefined,
      // The shell, not the subtree: see skeleton().
      structure: skeleton(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles: stylesOf(el),
      componentFile: v.componentFile,
      componentName: v.componentName,
      styleSources: trace.sources,
      styleWinners: winners,
    };
  }

  function addShot(dataUrl) {
    shots.push(dataUrl);
    renderShots();
    saveShots();
  }

  function renderShots() {
    shotsEl.innerHTML = '';
    shots.forEach(function (d, i) {
      var d1 = document.createElement('div');
      d1.className = 'shot';
      var img = document.createElement('img');
      img.src = d;
      var x = document.createElement('button');
      x.className = 'x';
      x.type = 'button';
      x.textContent = '✕';
      x.addEventListener('click', function () {
        shots.splice(i, 1);
        renderShots();
        saveShots();
      });
      d1.appendChild(img);
      d1.appendChild(x);
      shotsEl.appendChild(d1);
    });
  }

  function readFiles(files) {
    Array.prototype.forEach.call(files || [], function (f) {
      if (!f || f.type.indexOf('image/') !== 0) return;
      var fr = new FileReader();
      fr.onload = function () {
        addShot(fr.result);
      };
      fr.readAsDataURL(f);
    });
  }

  /* --- draft persistence ---------------------------------------------------
   *
   * Vite reloads the page on every save, and the composer is by far the most
   * expensive thing in this tool to lose: a couple of hundred words of
   * description plus a few pasted screenshots. So the draft is mirrored into
   * `sessionStorage` and re-attached on the next boot.
   *
   * `sessionStorage`, not `localStorage`: a draft belongs to the tab that
   * produced it and must not follow the developer into a fresh window.
   *
   * Two keys on purpose. The text changes on every keystroke while the shots
   * change rarely; re-serialising megabytes of base64 per keypress would both
   * stutter the panel and hit the ~5MB quota needlessly. The text key stays
   * tiny so writing it aggressively is cheap, and the shots key is rewritten
   * only when the shot set actually changes.
   *
   * Everything here is best-effort: a storage failure must never break the
   * editor, only lose the draft.
   */
  var DRAFT_PREFIX = 'pi-ele-picker:draft:v1';
  var SHOTS_PREFIX = 'pi-ele-picker:shots:v1';
  var SAVE_DEBOUNCE = 250;
  // A draft left over from a tab that stayed open for days is more confusing than
  // helpful: it describes an element that has almost certainly moved on.
  var DRAFT_TTL = 24 * 60 * 60 * 1000;
  var saveTimer = null;
  // True while an edit has not reached storage yet, so a page that is going
  // away flushes exactly once and a delivered draft is not resurrected.
  var draftDirty = false;
  var shotsDropped = false;

  function draftKey() {
    return DRAFT_PREFIX + ':' + location.pathname;
  }

  function shotsKey() {
    return SHOTS_PREFIX + ':' + location.pathname;
  }

  /** Never throws: returns false when storage is full or unavailable. */
  function writeStorage(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function removeStorage(key) {
    try {
      sessionStorage.removeItem(key);
    } catch (e) {
      /* storage unavailable — nothing to clear */
    }
  }

  function readStorage(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function saveShots() {
    if (!shots.length) {
      removeStorage(shotsKey());
      shotsDropped = false;
      return;
    }
    if (writeStorage(shotsKey(), JSON.stringify(shots))) {
      shotsDropped = false;
      return;
    }
    // The images do not fit. Keep the words and say so once, so a reload does not
    // silently eat the screenshots that were just pasted.
    removeStorage(shotsKey());
    if (!shotsDropped) {
      shotsDropped = true;
      setStatus('截图过大，刷新后不会保留（描述仍会保存）', 'err');
    }
  }

  function saveDraft() {
    var rec = {
      selector: targetSelector,
      text: taEl.value,
      // The element as it was when it was picked. Persisted because the reload
      // that restores the draft is often the same one that removed the node —
      // without this the send below could only go out with no element at all.
      element: targetSnapshot,
      url: targetUrl,
      dismissed: panelDismissed,
      savedAt: Date.now(),
    };
    if (!rec.text && !rec.selector && !rec.element) {
      // Nothing worth restoring — do not resurrect an empty panel on reload.
      clearDraft();
      return;
    }
    // Stay dirty when the write fails, so a page that is going away retries.
    if (writeStorage(draftKey(), JSON.stringify(rec))) draftDirty = false;
  }

  /** Debounced text write: the keystroke path must stay cheap. */
  function scheduleSave() {
    draftDirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveDraft();
    }, SAVE_DEBOUNCE);
  }

  /** Write any pending edit right now — the page is being torn down. */
  function flushDraft() {
    if (!draftDirty && !saveTimer) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    saveDraft();
  }

  /** Forget the draft: it has been delivered, or it is stale garbage. */
  function clearDraft() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    draftDirty = false;
    shotsDropped = false;
    removeStorage(draftKey());
    removeStorage(shotsKey());
  }

  /**
   * The live element the panel acts on.
   *
   * `target` is a DOM reference captured at pick time, so an HMR update — or any
   * re-render that swaps the node — leaves it detached. Re-resolving from the
   * remembered selector keeps the panel pointed at the right element without
   * asking the user to pick again, and returns null when the element is really
   * gone, which is what send() and openPanel() need to know.
   */
  function resolveTarget() {
    if (target && target.isConnected) return target;
    if (targetSelector) {
      try {
        var el = document.querySelector(targetSelector);
        if (el) {
          target = el;
          return el;
        }
      } catch (e) {
        /* not valid CSS (Tailwind-style class names) — cannot re-resolve */
      }
    }
    return null;
  }

  /**
   * Re-attach the draft written before this page load.
   *
   * The element is re-resolved from its selector rather than trusted blindly:
   * an HMR update replaces DOM nodes, so a captured `target` reference is dead by
   * the time the page comes back. If the selector no longer resolves, the text
   * and screenshots are still restored into the composer, so the next pick
   * inherits them instead of the user retyping everything.
   */
  function restoreDraft() {
    var raw = readStorage(draftKey());
    if (!raw) return;
    var rec;
    try {
      rec = JSON.parse(raw);
    } catch (e) {
      clearDraft();
      return;
    }
    if (!rec || typeof rec !== 'object') {
      clearDraft();
      return;
    }
    if (typeof rec.savedAt === 'number' && Date.now() - rec.savedAt > DRAFT_TTL) {
      clearDraft();
      return;
    }

    taEl.value = typeof rec.text === 'string' ? rec.text : '';

    var rawShots = readStorage(shotsKey());
    if (rawShots) {
      try {
        var arr = JSON.parse(rawShots);
        if (arr instanceof Array) {
          shots = arr.filter(function (d) {
            return typeof d === 'string' && d.indexOf('data:image/') === 0;
          });
          renderShots();
        }
      } catch (e) {
        removeStorage(shotsKey());
      }
    }

    if (rec.selector) targetSelector = String(rec.selector);
    if (rec.url) targetUrl = String(rec.url);
    if (rec.element && typeof rec.element === 'object') targetSnapshot = rec.element;

    var el = targetSelector ? resolveTarget() : null;
    if (el) {
      metaEl.innerHTML = targetSnapshot ? metaHtml(targetSnapshot) : '';
      if (!metaEl.innerHTML) renderMeta(el);
    } else if (targetSnapshot) {
      // Still sendable: the snapshot carries everything the bridge needs.
      metaEl.innerHTML =
        '<code>' + escapeHtml(targetSelector || '') + '</code><br>' +
        '上次选中的元素已不在页面中，发送时会带上抓取时的快照' +
        (targetSnapshot.styleWinners || targetSnapshot.styleSources
          ? '<div class="hint-css">' +
            (targetSnapshot.styleWinners
              ? propRows(targetSnapshot.styleWinners)
              : sourceRows(targetSnapshot.styleSources)) +
            '</div>'
          : '');
    }

    if (rec.dismissed) return;
    if (openPanel()) return;
    if (!taEl.value && !shots.length) return;
    // No element at all (not even a snapshot) but there are words: show the
    // composer so the draft is visibly still there, and let the next pick attach
    // it to a new element.
    panel.classList.add('open');
    metaEl.textContent = '上次选中的元素已不在页面中，请重新点击选择';
    positionPanel();
  }

  function loadConfig(force) {
    if (!force && cfg.port) return Promise.resolve(cfg);
    return fetch(CFG_URL, { cache: 'no-store' })
      .then(function (r) {
        return r.json();
      })
      .then(function (c) {
        cfg = c || { port: null, token: null };
        return cfg;
      })
      .catch(function () {
        return { port: null, token: null };
      });
  }

  /** Ask the Vite plugin to open a source file. */
  function openSource(file) {
    if (!file) return;
    var where = shortPath(file);
    setStatus('正在打开 ' + where + ' …');
    fetch(OPEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: file }),
    })
      .then(function (r) {
        return r
          .json()
          .then(function (j) {
            return { status: r.status, body: j };
          })
          .catch(function () {
            return { status: r.status, body: null };
          });
      })
      .then(function (out) {
        if (out.status === 200 && out.body && out.body.ok) {
          setStatus('已在编辑器中打开 ' + where + ' ✓', 'ok');
        } else {
          setStatus('打开源码失败: ' + ((out.body && out.body.error) || 'HTTP ' + out.status), 'err');
        }
      })
      .catch(function (e) {
        setStatus('打开源码失败: ' + String((e && e.message) || e), 'err');
      });
  }

  /** POST the payload to the bridge. Never rejects; status 0 means the fetch itself failed. */
  function deliver(c, submit, element) {
    var payload = {
      text: taEl.value,
      images: shots.map(function (d, i) {
        return { name: 'shot-' + i + '.png', dataUrl: d };
      }),
      element: element,
      // The page the element lives on, which is not necessarily the page that is
      // open right now.
      url: targetUrl || location.href,
      title: document.title,
      submit: !!submit,
    };
    return fetch('http://127.0.0.1:' + c.port + '/pick', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pi-picker-token': c.token },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r
          .json()
          .then(function (j) {
            return { status: r.status, body: j };
          })
          .catch(function () {
            return { status: r.status, body: null };
          });
      })
      .catch(function (e) {
        return { status: 0, body: null, error: String((e && e.message) || e) };
      });
  }

  /**
   * A stale bridge (pi restarted -> new random port + token, or the session closed)
   * surfaces as a failed fetch (status 0) or a 401/403/404/5xx from the old endpoint.
   * A genuine "no session registered for this project" is NOT stale: re-reading the
   * config cannot conjure one up, so we must not retry that.
   */
  function isStaleBridge(out) {
    if (out.noBridge) return false;
    if (out.status === 0) return true;
    return out.status === 401 || out.status === 403 || out.status === 404 || out.status >= 500;
  }

  function send(submit) {
    // Deliberately NOT gated on the element still being on the page. Picking an
    // element and then wandering off to another route to copy something is a
    // normal way to work, and blocking the send there throws away the words the
    // developer typed.
    //
    // Two sources for the element, and the wrong one silently corrupts the payload:
    // the snapshot captured at pick time (a plain value, so it survives an unmount,
    // an SPA route change or a reload), and a live read of whatever the selector
    // resolves to now. A live read wins only while we are still on the pick-time
    // URL — an HMR swap of the same element is the case that needs it, while a
    // route change can put an unrelated lookalike behind the same selector.
    var live = resolveTarget();
    var samePage = targetUrl === null || location.href === targetUrl;
    var element = live && samePage ? describe(live) : targetSnapshot;
    if (element) targetSnapshot = element;

    if (!element && !taEl.value.trim()) {
      setStatus('请先点击页面元素，或写下要改什么', 'err');
      return;
    }

    // Only ever affects the status line, never whether the send happens.
    var note = '';
    if (element && !live) note = '（元素已不在页面中，已附抓取时的快照）';
    else if (element && !samePage) note = '（页面已切换，已附抓取时的元素快照）';

    sendBtn.disabled = true;
    sendNowBtn.disabled = true;
    setStatus(submit ? '直接发送中…' : '写入中…');

    function attempt(forceFresh) {
      return loadConfig(forceFresh).then(function (c) {
        if (!c || !c.port) return { status: 0, body: null, noBridge: true };
        return deliver(c, submit, element);
      });
    }

    attempt(false)
      .then(function (out) {
        if (!isStaleBridge(out)) return out;
        // The cached port/token may be gone: drop it, re-discover the bridge and retry once.
        cfg = { port: null, token: null };
        setStatus('pi 桥接已变更，正在重新连接…');
        return attempt(true);
      })
      .then(function (out) {
        if (out.noBridge) {
          setStatus('未检测到 pi 桥接：请在项目根目录启动 pi 会话后刷新页面', 'err');
          return;
        }
        if (out.body && out.body.ok) {
          // Say which element went out, so a stale pick is visible rather than silent.
          if (out.body.submitted) {
            setStatus(
              (out.body.queued ? '已发送 ✓（agent 忙碌，已排队为后续任务）' : '已直接发送给 pi 并开始执行 ✓') + note,
              'ok'
            );
          } else {
            setStatus(
              (out.body.inserted ? '已写入 pi 输入框 ✓（去终端按回车发送）' : '已发送给 pi ✓') + note,
              'ok'
            );
          }
          taEl.value = '';
          shots = [];
          renderShots();
          clearDraft();
        } else {
          setStatus('失败: ' + ((out.body && out.body.error) || out.error || 'HTTP ' + out.status), 'err');
        }
      })
      .catch(function (e) {
        setStatus(String((e && e.message) || e), 'err');
      })
      .then(function () {
        sendBtn.disabled = false;
        sendNowBtn.disabled = false;
      });
  }

  // Always-on. The first one resets the swallow flag before `onPointerDown`
  // runs (registered earlier, so same-node capture listeners fire in order);
  // the second consumes the flag to cancel the click that finishes a pick.
  window.addEventListener('pointerdown', function () { swallowClick = false; }, true);
  window.addEventListener('click', onClick, true);

  /* --- hover reopens the last captured element --- */
  var HOVER_OPEN_DELAY = 200;
  var hoverOpenTimer = null;

  function clearHoverOpen() {
    if (hoverOpenTimer) {
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = null;
    }
  }

  trigger.addEventListener('pointerenter', function (e) {
    // Mouse only: touch/pen enter is part of a tap, which must keep its click.
    if (e.pointerType !== 'mouse') return;
    if (picking || drag) return;
    clearHoverOpen();
    // A short dwell keeps a mouse merely passing over the launcher from popping
    // the panel open, while still feeling immediate when you aim at it.
    hoverOpenTimer = setTimeout(function () {
      hoverOpenTimer = null;
      if (picking || drag) return;
      openPanel();
    }, HOVER_OPEN_DELAY);
  });

  trigger.addEventListener('pointerleave', clearHoverOpen);

  trigger.addEventListener('click', function () {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setPicking(!picking);
  });
  metaEl.addEventListener('click', function (e) {
    var node = e.target;
    var btn = node && node.closest ? node.closest('.src[data-open]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openSource(btn.getAttribute('data-file'));
  });
  closeBtn.addEventListener('click', function () {
    panel.classList.remove('open');
    hideHighlight();
    setStatus('');
    // Remember the dismissal so a reload does not pop the panel back open, while
    // the draft stays available through the launcher's hover-to-reopen.
    panelDismissed = true;
    saveDraft();
  });
  attachBtn.addEventListener('click', function () {
    fileEl.click();
  });
  fileEl.addEventListener('change', function () {
    readFiles(fileEl.files);
    fileEl.value = '';
  });
  sendBtn.addEventListener('click', function () {
    send(false);
  });
  sendNowBtn.addEventListener('click', function () {
    send(true);
  });
  taEl.addEventListener('input', scheduleSave);
  window.addEventListener('pagehide', flushDraft);
  taEl.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    var handled = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) {
          readFiles([f]);
          handled = true;
        }
      }
    }
    if (handled) e.preventDefault();
  });
  panel.addEventListener('dragover', function (e) {
    e.preventDefault();
  });
  panel.addEventListener('drop', function (e) {
    e.preventDefault();
    readFiles(e.dataTransfer && e.dataTransfer.files);
  });

  // --- live session status (opt-in) ----------------------------------------
  // Polling is OFF by default because each cycle opens a loopback connection.
  // Users opt in per browser with the panel switch, or a project flips the
  // default with the Vite option (`piElePicker({ status: true })`). While enabled
  // the launcher dot + panel line show whether pi is running, waiting for input,
  // holding queued follow-ups, or gone. Polling pauses on a hidden tab and drops
  // a stale port so the next cycle re-discovers a restarted bridge.
  var STATUS_INTERVAL = 3000;
  var STATUS_KEY = 'pi-ele-picker:status:v1';
  var statusTimer = null;
  var statusTitle = '';
  var statusEnabled = false;
  var STATUS_LABEL = {
    running: 'pi 执行中',
    queued: 'pi 排队中',
    idle: 'pi 等待输入',
    offline: 'pi 已停止 / 未连接',
    unknown: 'pi 状态检测中…',
    off: '状态显示已关闭',
  };

  function renderStatus(info) {
    var st = info && info.status;
    if (!STATUS_LABEL[st]) st = 'unknown';
    var cls = 'dot st-' + st;
    triggerDot.className = cls;
    sessionDot.className = cls;
    var detail = [];
    if (info && info.model) detail.push(info.model);
    if (info && info.sessionId) detail.push('会话 ' + String(info.sessionId).slice(0, 8));
    var line = STATUS_LABEL[st] + (detail.length ? ' · ' + detail.join(' · ') : '');
    sessionText.textContent = line;
    var title = line + ' · 拖拽可移动 · 面板标题栏也可拖拽 · 悬浮可再次打开上次元素 · 点击开始选择元素';
    if (title !== statusTitle) {
      trigger.title = title;
      statusTitle = title;
    }
  }

  function readStatusOverride() {
    try {
      var v = localStorage.getItem(STATUS_KEY);
      if (v === 'on') return true;
      if (v === 'off') return false;
    } catch (e) {
      /* storage unavailable — fall back to the project default */
    }
    return null;
  }

  function writeStatusOverride(enabled) {
    try {
      localStorage.setItem(STATUS_KEY, enabled ? 'on' : 'off');
    } catch (e) {
      /* ignore */
    }
  }

  function stopStatusPoll() {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
  }

  /** Turn polling on/off; `persist` records the choice as this browser's override. */
  function setStatusEnabled(enabled, persist) {
    statusEnabled = !!enabled;
    if (persist) writeStatusOverride(statusEnabled);
    if (statusToggle) statusToggle.checked = statusEnabled;
    if (statusEnabled) {
      renderStatus({ status: 'unknown' });
      pollStatus();
    } else {
      stopStatusPoll();
      renderStatus({ status: 'off' });
    }
  }

  /** Never rejects: any failure becomes the offline state. */
  function fetchStatus() {
    return loadConfig(false).then(function (c) {
      if (!c || !c.port) return { status: 'offline' };
      return fetch('http://127.0.0.1:' + c.port + '/status', { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .catch(function () {
          // The cached port may be stale after a pi restart: clear it so the next
          // poll re-reads the config and finds the new bridge.
          cfg = { port: null, token: null };
          return { status: 'offline' };
        });
    });
  }

  function scheduleStatusPoll() {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(pollStatus, STATUS_INTERVAL);
  }

  function pollStatus() {
    if (!statusEnabled) return;
    if (document.hidden) {
      scheduleStatusPoll();
      return;
    }
    fetchStatus()
      .then(renderStatus)
      .catch(function () {
        renderStatus({ status: 'offline' });
      })
      .then(scheduleStatusPoll);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && statusEnabled) pollStatus();
  });

  statusToggle.addEventListener('change', function () {
    setStatusEnabled(statusToggle.checked, true);
  });

  // Resolve the project default first (statusDefault from the Vite plugin), then
  // apply this browser's override if the user has one.
  loadConfig().then(function () {
    var override = readStatusOverride();
    setStatusEnabled(override !== null ? override : cfg && cfg.statusDefault === true, false);
  });

  // Last: the draft restore depends on state initialised above it (launcher
  // position, panel offset) and on the draft storage keys being assigned.
  restoreDraft();
})();
