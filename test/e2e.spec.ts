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

test('sending is refused while the picked element is off the page', async ({ page }) => {
  await open(page);
  await pick(page, '#save');
  await page.locator(TEXTAREA).fill('这个元素马上要被删掉');
  await waitForStoredText(page, '这个元素马上要被删掉');

  await page.evaluate(() => document.querySelector('#save')?.remove());
  await page.locator('.panel .send').click();

  // Nothing was delivered: the old code would have shipped a prompt describing
  // nothing at all.
  await expect(page.locator(STATUS)).toContainText('不在页面中');
  await expect(page.locator(TEXTAREA)).toHaveValue('这个元素马上要被删掉');
});

test('a replaced node under the same selector is picked up again', async ({ page }) => {
  await open(page);
  await pick(page, '#save');

  // What an HMR update does: the captured node is detached and a fresh one takes
  // its place. The panel must follow the selector rather than the dead reference.
  await page.evaluate(() => {
    const old = document.querySelector('#save')!;
    old.remove();
    document.body.appendChild(old.cloneNode(true));
  });
  await page.locator('.panel .send').click();

  // Got past the detached-target guard and tried to deliver (there is no bridge).
  await expect(page.locator(STATUS)).toContainText('未检测到 pi 桥接');
});

test('the description survives even when its element is gone', async ({ page }) => {
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
