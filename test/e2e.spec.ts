import { test, expect, type Page } from '@playwright/test';

/**
 * Regression tests for the browser client, driven through a real Vite dev server.
 *
 * The point of the suite is the draft persistence: a Vite reload happens every
 * time the developer saves a file, so reloading must not cost them the
 * description, the screenshots, or the element they were working on. Each test
 * here corresponds to one way that used to lose work.
 *
 * No pi bridge is registered for the fixture root, so `/__pi_picker__/config`
 * answers with `port: null` and any real delivery ends in the "no bridge" status.
 * That is enough to assert how far a send got without needing a live session.
 */

const PANEL = '.panel';
const TEXTAREA = '.panel textarea';
const STATUS = '.panel .status';
const META = '.panel .meta';
const TRIGGER = '.trigger';

/** 1×1 red PNG — the smallest payload that survives the dataURL round-trip. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

const DRAFT_KEY = 'pi-ele-picker:draft:v1';

/**
 * Load the fixture. The picker's restore pass runs synchronously inside a module
 * script, so by the time `goto()` resolves it has already happened — no waiting
 * or settling needed anywhere in this suite.
 */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto('/' + query);
  await page.locator(TRIGGER).waitFor({ state: 'attached' });
}

/** Click the launcher, then pick an element on the page. */
async function pick(page: Page, selector: string): Promise<void> {
  await page.locator(TRIGGER).click();
  // Park the pointer first: the launcher reopens the panel after a 200ms hover,
  // which would fight the picking mode.
  await page.mouse.move(1, 1);
  await page.locator(selector).hover();
  await page.locator(selector).click();
  await expect(page.locator(PANEL)).toHaveClass(/open/);
}

async function storedDraft(page: Page): Promise<string | null> {
  return page.evaluate((prefix) => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith(prefix));
    return key ? sessionStorage.getItem(key) : null;
  }, DRAFT_KEY);
}

/** The draft write is debounced, so wait for it to land instead of sleeping. */
async function waitForStoredText(page: Page, text: string): Promise<void> {
  await expect.poll(() => storedDraft(page)).toContain(text);
}

async function attachShot(page: Page): Promise<void> {
  await page
    .locator('.panel input.file')
    .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.panel .shot')).toHaveCount(1);
}

/**
 * Stand in for the pi bridge at the browser boundary.
 *
 * `/config` is answered with a fake port and token so the client really attempts
 * delivery, and `/pick` captures the body it would have posted. Asserting on that
 * body is the only way to check *what* goes out without running a pi session.
 */
async function mockBridge(page: Page): Promise<Record<string, any>[]> {
  const posts: Record<string, any>[] = [];
  const BRIDGE = 'http://127.0.0.1:45999';
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-pi-picker-token',
    'access-control-allow-methods': 'POST,OPTIONS',
  };

  await page.route('**/__pi_picker__/config', (route) =>
    route.fulfill({ json: { port: 45999, token: 'test-token', statusDefault: false } })
  );
  await page.route(`${BRIDGE}/pick`, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    // The probe the client sends when it re-discovers a stale bridge.
    posts.push(request.postDataJSON());
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, mode: 'tui', inserted: true }),
    });
  });
  return posts;
}

test('a reload restores the description and the picked element', async ({ page }) => {
  await open(page);
  await pick(page, '#save');
  await page.locator(TEXTAREA).fill('把这个按钮改成圆角主色，并加 hover 阴影');
  await waitForStoredText(page, '把这个按钮改成圆角主色');

  await page.reload();

  await expect(page.locator(PANEL)).toHaveClass(/open/);
  await expect(page.locator(TEXTAREA)).toHaveValue('把这个按钮改成圆角主色，并加 hover 阴影');
  // The captured node dies with the reload; the panel points at the element its
  // selector resolves to now.
  await expect(page.locator(META)).toContainText('button#save');
});

test('a reload restores pasted screenshots', async ({ page }) => {
  await open(page);
  await pick(page, '#save');
  await attachShot(page);
  await page.locator(TEXTAREA).fill('加一张参考图');
  await waitForStoredText(page, '加一张参考图');

  await page.reload();

  await expect(page.locator('.panel .shot')).toHaveCount(1);
  await expect(page.locator(TEXTAREA)).toHaveValue('加一张参考图');
});

test('the draft is flushed when the page goes away before the debounce fires', async ({ page }) => {
  await open(page);
  await pick(page, '#save');
  // Deliberately no wait: this covers the pagehide flush, not the debounce timer.
  await page.locator(TEXTAREA).fill('保存文件后立刻刷新也不能丢');

  await page.reload();

  await expect(page.locator(TEXTAREA)).toHaveValue('保存文件后立刻刷新也不能丢');
});

test('sends the pick-time snapshot after the element has moved on', async ({ page }) => {
  const posts = await mockBridge(page);
  await open(page);
  await pick(page, '#save');
  await page.locator(TEXTAREA).fill('把这个按钮改成圆角主色');

  // The scenario this exists for: you pick an element, then wander off somewhere
  // else and the node is gone by the time you send.
  await page.evaluate(() => document.querySelector('#save')?.remove());
  await page.locator('.panel .send').click();

  await expect(page.locator(STATUS)).toContainText('已写入 pi 输入框');
  await expect(page.locator(STATUS)).toContainText('快照');

  expect(posts).toHaveLength(1);
  const [payload] = posts;
  expect(payload.text).toBe('把这个按钮改成圆角主色');
  expect(payload.element.selector).toContain('#save');
  // Both of these can only come from the snapshot: a detached node reports a 0×0
  // rect and no computed styles at all, which is why reading it live is useless.
  expect(payload.element.rect.w).toBeGreaterThan(0);
  expect(Object.keys(payload.element.styles).length).toBeGreaterThan(3);
  // The page the element belongs to, not wherever the developer is now.
  expect(payload.url).toBe('http://127.0.0.1:5273/');
});

test('a replaced node under the same selector is described live', async ({ page }) => {
  const posts = await mockBridge(page);
  await open(page);
  await pick(page, '#save');

  // What an HMR update does: the captured node is detached and a fresh one takes
  // its place. Same page, so the replacement is the better description.
  await page.evaluate(() => {
    const old = document.querySelector('#save')!;
    old.remove();
    const replacement = old.cloneNode(true) as HTMLElement;
    replacement.textContent = '保存 HMR';
    document.body.appendChild(replacement);
  });
  await page.locator('.panel .send').click();

  await expect(page.locator(STATUS)).toContainText('已写入 pi 输入框');
  // The snapshot still says 保存; only a live read can know about the swap.
  expect(posts[0].element.text).toBe('保存 HMR');
  expect(posts[0].element.htmlSnippet).toContain('保存 HMR');
});

test('the draft survives a reload that removed the element, and still sends', async ({ page }) => {
  const posts = await mockBridge(page);
  await open(page);
  await pick(page, '#gone');
  await page.locator(TEXTAREA).fill('元素被卸载了，但描述不能丢');
  await waitForStoredText(page, '元素被卸载了');

  // Next load of the same path, but the element is no longer rendered — the state
  // an HMR update that unmounts the node leaves behind. The draft key is keyed by
  // pathname, so the query string does not move it out from under the restore.
  await open(page, '?omit=gone');

  await expect(page.locator(PANEL)).toHaveClass(/open/);
  await expect(page.locator(TEXTAREA)).toHaveValue('元素被卸载了，但描述不能丢');
  await expect(page.locator(META)).toContainText('已不在页面中');

  // The whole point: a pick with no element left on the page still sends, because
  // the snapshot was persisted alongside the words.
  await page.locator('.panel .send').click();
  await expect(page.locator(STATUS)).toContainText('已写入 pi 输入框');
  expect(posts[0].element.selector).toContain('#gone');
  expect(posts[0].element.rect.w).toBeGreaterThan(0);
  expect(posts[0].text).toBe('元素被卸载了，但描述不能丢');
});

test('an SPA route change describes the snapshot, not a lookalike', async ({ page }) => {
  const posts = await mockBridge(page);
  await open(page);
  await pick(page, '#save');
  await page.locator(TEXTAREA).fill('把这个按钮改成圆角主色');

  // A route change without a document reload, which is what a router does: the
  // selector still resolves, but to a different page's button.
  await page.evaluate(() => {
    history.pushState({}, '', '/?route=detail');
    document.querySelector('#save')!.textContent = '另一个页面的按钮';
  });
  await page.locator('.panel .send').click();

  await expect(page.locator(STATUS)).toContainText('页面已切换');
  // 保存 is the element that was picked; 另一个页面的按钮 is the lookalike.
  expect(posts[0].element.text).toBe('保存');
  expect(posts[0].url).toBe('http://127.0.0.1:5273/');
});

test('screenshots that do not fit in storage are dropped, the text is not', async ({ page }) => {
  await open(page);
  // Simulate a full quota for the shot key only: this is what a couple of Retina
  // screenshots do on their own.
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.includes(':shots:')) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });

  await pick(page, '#save');
  await page.locator(TEXTAREA).fill('截图存不下时描述必须还在');
  await attachShot(page);

  // The failure is reported rather than silently swallowing the pasted image.
  await expect(page.locator(STATUS)).toContainText('截图过大');

  await page.reload();

  await expect(page.locator(TEXTAREA)).toHaveValue('截图存不下时描述必须还在');
  await expect(page.locator('.panel .shot')).toHaveCount(0);
});

test('closing the panel also suppresses the reopen on reload', async ({ page }) => {
  await open(page);
  await pick(page, '#save');
  await page.locator(TEXTAREA).fill('关掉面板后刷新不该自己弹出来');
  await waitForStoredText(page, '关掉面板后');
  await page.locator('.panel .close').click();
  await expect(page.locator(PANEL)).not.toHaveClass(/open/);

  await page.reload();

  await expect(page.locator(PANEL)).not.toHaveClass(/open/);
  // Still reachable on demand, with the draft intact.
  await page.locator(TRIGGER).hover();
  await expect(page.locator(PANEL)).toHaveClass(/open/);
  await expect(page.locator(TEXTAREA)).toHaveValue('关掉面板后刷新不该自己弹出来');
});

test('a draft older than a day is discarded', async ({ page }) => {
  await open(page);
  await pick(page, '#save');
  await page.locator(TEXTAREA).fill('这是一天前的旧草稿');
  await waitForStoredText(page, '一天前');

  await page.evaluate((prefix) => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith(prefix))!;
    const record = JSON.parse(sessionStorage.getItem(key)!);
    record.savedAt = Date.now() - 25 * 60 * 60 * 1000;
    sessionStorage.setItem(key, JSON.stringify(record));
  }, DRAFT_KEY);

  await page.reload();

  await expect(page.locator(PANEL)).not.toHaveClass(/open/);
  await expect(page.locator(TEXTAREA)).toHaveValue('');
  // Expiry must also clean up, not just skip.
  await expect
    .poll(() => page.evaluate(() => Object.keys(sessionStorage).length))
    .toBe(0);
});
