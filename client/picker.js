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
    '.panel { position: fixed; width: 380px; max-width: calc(100vw - 36px); z-index: 2147483647; pointer-events: auto; background: #1b1c22; color: #e7e7ea; border: 1px solid #34353d; border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.5); font-size: 13px; display: none; }',
    '.panel.open { display: block; }',
    '.hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2b2c33; }',
    '.hd .title { font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.hd .close { background: transparent; border: none; color: #9a9aa5; font-size: 16px; cursor: pointer; line-height: 1; }',
    '.meta { padding: 8px 12px 0; color: #9a9aa5; font-size: 11px; line-height: 1.5; word-break: break-all; }',
    '.meta code { color: #a5b4fc; }',
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
  trigger.textContent = '🎯 pi 选择器';
  trigger.title = '拖拽可移动 · 点击开始选择元素';
  root.appendChild(trigger);

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<div class="hd"><div class="title">元素修改</div><button class="close" type="button" title="关闭">✕</button></div>' +
    '<div class="meta"></div>' +
    '<textarea placeholder="描述你想要的修改，例如：把这个按钮改成圆角主色、增加 hover 效果…（可直接粘贴截图）"></textarea>' +
    '<div class="shots"></div>' +
    '<div class="ft"><button class="btn attach" type="button">📎 添加图片</button><span class="spacer"></span><button class="btn send" type="button">写入pi输入框</button><button class="btn go send-now" type="button">直接发送</button></div>' +
    '<div class="status"></div>' +
    '<input class="file" type="file" accept="image/*" multiple style="display:none" />';
  root.appendChild(panel);

  var metaEl = panel.querySelector('.meta');
  var taEl = panel.querySelector('textarea');
  var shotsEl = panel.querySelector('.shots');
  var statusEl = panel.querySelector('.status');
  var sendBtn = panel.querySelector('.send');
  var sendNowBtn = panel.querySelector('.send-now');
  var attachBtn = panel.querySelector('.attach');
  var closeBtn = panel.querySelector('.close');
  var fileEl = panel.querySelector('.file');

  var picking = false;
  var target = null;
  var shots = [];

  document.documentElement.appendChild(host);

  /* --- launcher: draggable, fades when idle, and stays inside the viewport --- */
  var POS_KEY = 'pi-ele-picker:pos:v1';
  var EDGE = 8;
  var suppressClick = false;
  var drag = null;

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

  /** Place the panel next to the launcher, flipping sides to stay in view. */
  function positionPanel() {
    if (!panel.classList.contains('open')) return;
    var gap = 10;
    var m = 10;
    var t = trigger.getBoundingClientRect();
    var pw = panel.offsetWidth || 380;
    var ph = panel.offsetHeight || 320;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var top = t.top + t.height / 2 > vh / 2 ? t.top - gap - ph : t.bottom + gap;
    var left = t.left + t.width / 2 > vw / 2 ? t.right - pw : t.left;
    panel.style.left = Math.max(m, Math.min(left, vw - pw - m)) + 'px';
    panel.style.top = Math.max(m, Math.min(top, vh - ph - m)) + 'px';
  }

  trigger.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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

  window.addEventListener('resize', function () {
    var p = launcherPos();
    setLauncherPos(p.x, p.y);
    positionPanel();
  });

  initLauncherPos();

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
    target = el;
    showHighlight(el);
  }

  function onClick(e) {
    var el = elFromEvent(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    setPicking(false);
    select(el);
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
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKey, true);
    } else {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      hideHighlight();
    }
  }

  function select(el) {
    target = el;
    showHighlight(el);
    metaEl.innerHTML = '<code>' + escapeHtml(cssPath(el)) + '</code>' + vueLine(el);
    panel.classList.add('open');
    positionPanel();
    taEl.focus();
  }

  function vueLine(el) {
    var v = vueInfo(el);
    if (v.componentFile) return '<br>组件: <code>' + escapeHtml((v.componentName ? v.componentName + ' ' : '') + v.componentFile) + '</code>';
    return '';
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
    var text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: el.classList ? Array.prototype.slice.call(el.classList, 0, 8) : [],
      text: text || undefined,
      htmlSnippet: el.outerHTML ? el.outerHTML.slice(0, 1500) : undefined,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles: stylesOf(el),
      componentFile: v.componentFile,
      componentName: v.componentName,
    };
  }

  function addShot(dataUrl) {
    shots.push(dataUrl);
    renderShots();
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

  /** POST the payload to the bridge. Never rejects; status 0 means the fetch itself failed. */
  function deliver(c, submit) {
    var payload = {
      text: taEl.value,
      images: shots.map(function (d, i) {
        return { name: 'shot-' + i + '.png', dataUrl: d };
      }),
      element: describe(target),
      url: location.href,
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
    sendBtn.disabled = true;
    sendNowBtn.disabled = true;
    setStatus(submit ? '直接发送中…' : '写入中…');

    function attempt(forceFresh) {
      return loadConfig(forceFresh).then(function (c) {
        if (!c || !c.port) return { status: 0, body: null, noBridge: true };
        return deliver(c, submit);
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
          if (out.body.submitted) {
            setStatus(out.body.queued ? '已发送 ✓（agent 忙碌，已排队为后续任务）' : '已直接发送给 pi 并开始执行 ✓', 'ok');
          } else {
            setStatus(out.body.inserted ? '已写入 pi 输入框 ✓（去终端按回车发送）' : '已发送给 pi ✓', 'ok');
          }
          taEl.value = '';
          shots = [];
          renderShots();
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

  trigger.addEventListener('click', function () {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setPicking(!picking);
  });
  closeBtn.addEventListener('click', function () {
    panel.classList.remove('open');
    hideHighlight();
    setStatus('');
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

  loadConfig();
})();
