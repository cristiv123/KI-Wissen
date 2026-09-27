#!/usr/bin/env node
/**
 * Shoot the gallery figures for index.html.
 *
 * Sixteen figures in five languages, straight into shots/<lang>/<name>.png at
 * the geometry the page has always used: a 1360x850 viewport at
 * deviceScaleFactor 2, so 2720x1700, with three figures clipped taller or
 * shorter because of what they have to show.
 *
 * NO DEPENDENCY TO INSTALL, and that is the point rather than a boast: these
 * figures have been redone from scratch three times because nothing recorded
 * how. Node 22 ships a global WebSocket and the machine ships Chrome, so this
 * drives the installed browser over the DevTools Protocol directly — nothing to
 * `npm install`, nothing to keep in step with a browser release.
 *
 *   node tools/shoot.mjs                    # all sixteen, all five languages
 *   node tools/shoot.mjs --lang de          # one language
 *   node tools/shoot.mjs --only help,find   # one or two figures
 *   node tools/shoot.mjs --only ai-usage --base http://localhost:4201 --wait-for-login
 *
 * Two instances are involved and they are not interchangeable — see README.md.
 * Fifteen figures come from the seeded demo instance; `ai-usage` alone comes
 * from the real one, because its whole worth is that the amounts in it were
 * measured rather than invented.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The page's own geometry. Every figure's size is derived from it. */
const VIEWPORT = { width: 1360, height: 850, deviceScaleFactor: 2 };

const LANGS = ['de', 'fr', 'it', 'en', 'ro'];

/**
 * The manual's chapters, in the order the component declares them. Here only so
 * the help figure can open two of them by name rather than by a position
 * somebody would have to recount.
 */
const HELP_CHAPTERS = [
  'start', 'lists', 'categories', 'documents', 'reading', 'emails',
  'contacts', 'reminders', 'plans', 'telegram', 'bot', 'find',
  'search', 'voice', 'aiUsage', 'account', 'users', 'settings'
];

/**
 * One record per figure, in the order the gallery renders them — which is the
 * application's own menu order, with the language control last.
 *
 * Two fields carry geometry and they are not interchangeable. `viewport` is the
 * CSS height the browser is told to be before the page loads, which is what a
 * tall figure needs: this application's layout is height-driven — above 640px
 * `app-root` is a full-height column and `.app-main` carries the overflow — so
 * a taller *capture* of an 850px viewport reflows nothing and comes back with
 * the page cut at 850 and grey underneath it. A taller viewport reflows.
 * `crop` clips the capture to the top N CSS pixels and is for `languages`
 * alone, which is a figure about the panel rather than about the page under it.
 *
 * `setup` runs inside the page once the route has settled, and throws when what
 * it needs is not there — so a figure that could not be built fails the run
 * instead of being saved half-made. That matters more here than it looks: a
 * screenshot of the wrong state is not an error anywhere, it is just a picture.
 */
const FIGURES = [
  { name: 'categories', route: '/categories', wait: 'table tbody tr' },
  { name: 'gantt', route: '/plans/1', wait: '.gantt-wrap svg', settle: 1800 },
  { name: 'documents', route: '/documents', wait: 'table tbody tr' },
  { name: 'emails', route: '/emails', wait: 'table tbody tr' },
  { name: 'telegram', route: '/telegram', wait: '.bubble' },
  { name: 'contacts', route: '/contacts', wait: 'table tbody tr' },
  { name: 'reminders', route: '/reminders', wait: 'table tbody tr' },
  {
    name: 'find',
    route: '/find',
    wait: '#term0',
    viewport: 1450,
    // The booking reference that runs through this demo corpus: an email body,
    // that email's AI summary, a stored ticket PDF's file name, that PDF's
    // extracted text, and a Telegram message. One string in five places, which
    // is what the figure is for.
    //
    // The `input` event is dispatched because the field is [(ngModel)]:
    // assigning `.value` alone leaves Angular holding the old value and the
    // search never fires.
    setup: `
      const box = document.querySelector('#term0');
      if (!box) throw new Error('no term field');
      box.focus();
      box.value = 'K7QF2M';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 2000));
      if (!document.querySelector('table tbody tr')) {
        throw new Error('the literal search returned nothing');
      }
    `
  },
  {
    name: 'second-brain',
    route: '/search',
    wait: 'textarea',
    // Typed in English against a corpus of German and Italian documents, and
    // left in English in all five sets: the caption's argument is that the
    // question and the answer need not share a language.
    //
    // "Passages only", never "Ask" — the demo instance holds no API key, so
    // there is no model to call, and the figure says that rather than implying
    // one refused.
    setup: `
      const box = document.querySelector('textarea');
      if (!box) throw new Error('no question box');
      box.focus();
      box.value = 'When do I travel to Milan and what is the booking reference?';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const passagesOnly = document.querySelector('.btn.btn-secondary');
      if (!passagesOnly) throw new Error('no passages-only button');
      passagesOnly.click();
      for (let i = 0; i < 120; i++) {
        if (document.querySelector('.sources')) break;
        await new Promise(r => setTimeout(r, 250));
      }
      if (!document.querySelector('.sources')) throw new Error('retrieval returned nothing');
      await new Promise(r => setTimeout(r, 500));
    `
  },
  { name: 'voice', route: '/voice', wait: '.btn.mic' },
  { name: 'ai-usage', route: '/ai-usage', wait: 'table tbody tr', instance: 'real' },
  { name: 'account', route: '/account', wait: '.card' },
  { name: 'users', route: '/users', wait: 'table tbody tr' },
  { name: 'settings', route: '/settings', wait: '.card' },
  {
    name: 'help',
    route: '/help',
    wait: 'details.chapter',
    viewport: 1450,
    // Two chapters open and the rest closed, which is the whole of what this
    // figure argues: open, a chapter is its own prose and bullets; closed, the
    // titles under it are the table of contents; and two being open at once is
    // the point, since the group deliberately carries no `name` and so is not
    // mutually exclusive.
    //
    // `lists` and `categories` rather than a pair further down, and 1450 rather
    // than the whole page: measured, the manual runs to 2139 CSS px in German
    // and 2060 in Romanian, which is a figure three screens tall and a
    // different size in every language. Worse, a figure that tall would argue
    // against the caption beside it — the claim is that the closed list fits
    // on a screen. Opening the two chapters nearest the top says the same thing
    // in one screenful, at the height `find` already established.
    setup: `
      const chapters = [...document.querySelectorAll('details.chapter')];
      const order = ${JSON.stringify(HELP_CHAPTERS)};
      if (chapters.length !== order.length) {
        throw new Error('expected ' + order.length + ' chapters, got ' + chapters.length +
          ' — an admin account sees the whole manual, so this is the wrong account');
      }
      for (const wanted of ['lists', 'categories']) {
        chapters[order.indexOf(wanted)].open = true;
      }
      await new Promise(r => setTimeout(r, 400));
    `
  },
  {
    name: 'languages',
    route: '/categories',
    wait: '.lang-trigger',
    crop: 420,
    // The panel open over the page, cropped to the top: this figure is about
    // the five flags being drawn rather than about the page under them.
    setup: `
      const trigger = document.querySelector('.lang-trigger');
      if (!trigger) throw new Error('no language trigger');
      trigger.click();
      await new Promise(r => setTimeout(r, 400));
      if (!document.querySelector('.lang-menu')) {
        throw new Error('the language panel did not open');
      }
    `
  }
];

// ── CDP over the WebSocket Node 22 already has ──────────────────────────────

function chromePath() {
  const candidates = [
    process.env.CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('Chrome not found; set CHROME to its path');
  return found;
}

class Cdp {
  #ws;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async attach(wsUrl) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener('open', resolve, { once: true });
      cdp.#ws.addEventListener('error', () => reject(new Error('cannot reach ' + wsUrl)), { once: true });
    });
    cdp.#ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && cdp.#pending.has(message.id)) {
        const { resolve, reject } = cdp.#pending.get(message.id);
        cdp.#pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method) {
        for (const fn of cdp.#listeners.get(message.method) ?? []) fn(message.params);
      }
    });
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify(payload));
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(fn);
  }

  once(method) {
    return new Promise((resolve) => {
      const fn = (params) => {
        const list = this.#listeners.get(method);
        list.splice(list.indexOf(fn), 1);
        resolve(params);
      };
      this.on(method, fn);
    });
  }

  close() {
    this.#ws.close();
  }
}

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  /**
   * Evaluated as the body of an async function, so a setup script can `await` a
   * settle without the caller polling for it — and a `throw` inside one comes
   * back as a real error here rather than as a silent `undefined`, which is
   * what lets a figure fail instead of being captured in the wrong state.
   */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      throw new Error(detail.exception?.description ?? detail.text ?? 'evaluation failed');
    }
    return result.result.value;
  }

  async goto(url) {
    const loaded = this.cdp.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 20000))]);
  }

  async waitFor(selector, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.eval(`return !!document.querySelector(${JSON.stringify(selector)});`)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`timed out waiting for ${selector}`);
  }

  /** The emulated viewport, which reflows the page rather than merely framing it. */
  async setViewportHeight(height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      ...VIEWPORT,
      height,
      mobile: false
    });
  }

  /**
   * Without a crop the capture is the emulated viewport, which at the default
   * height is the 2720x1700 that thirteen of the figures are.
   *
   * `scale: 1` on a crop, and that is not the obvious value: the device scale
   * factor set on the viewport is applied to a clip as well, so `scale: 2` here
   * multiplies with it and returns a 5440-wide image. Verified by reading the
   * PNG header rather than by trusting the number this script prints — which
   * is why it now prints the header.
   */
  async shot(file, crop) {
    const params = { format: 'png' };
    if (crop) {
      params.clip = { x: 0, y: 0, width: VIEWPORT.width, height: crop, scale: 1 };
    }
    const { data } = await this.send('Page.captureScreenshot', params);
    const bytes = Buffer.from(data, 'base64');
    await writeFile(file, bytes);
    return bytes;
  }
}

/**
 * The dimensions a PNG actually has, read out of its IHDR.
 *
 * Reported rather than computed, because a computed figure is a claim about
 * what the capture should have been: this script printed "2720x2900" for an
 * image that was 5440x5800 for exactly as long as the number came from
 * arithmetic instead of from the file.
 */
function pngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// ── the run ────────────────────────────────────────────────────────────────

function parseArgs() {
  const options = {
    langs: LANGS,
    only: null,
    base: 'http://localhost:4202',
    waitForLogin: false,
    user: 'demo',
    password: 'ChangeMe123!'
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--lang') { options.langs = value.split(','); i++; }
    else if (flag === '--only') { options.only = value.split(','); i++; }
    else if (flag === '--base') { options.base = value.replace(/\/$/, ''); i++; }
    else if (flag === '--user') { options.user = value; i++; }
    else if (flag === '--password') { options.password = value; i++; }
    else if (flag === '--wait-for-login') { options.waitForLogin = true; }
    else throw new Error('unknown flag: ' + flag);
  }
  return options;
}

async function launchChrome(headless) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = await mkdtemp(join(tmpdir(), 'kia-shoot-'));
  const flags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    'about:blank'
  ];
  if (headless) flags.unshift('--headless=new', '--disable-gpu');
  else flags.unshift(`--window-size=${VIEWPORT.width},${VIEWPORT.height + 140}`);

  const child = spawn(chromePath(), flags, { stdio: 'ignore' });
  let version = null;
  for (let attempt = 0; attempt < 100 && !version; attempt++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!version) throw new Error('Chrome did not open a debugging port');
  return { child, profile, wsUrl: version.webSocketDebuggerUrl };
}

async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId);
  await page.send('Page.enable', {});
  await page.send('Runtime.enable', {});
  await page.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false });
  return page;
}

/**
 * Sign in once, for the whole run.
 *
 * `--wait-for-login` is the real instance's path: Chrome opens with a window,
 * whoever is running this types their own password into it, and that credential
 * is neither in this file nor in anything this script writes. The scripted path
 * is the demo instance, whose account is invented and whose password README.md
 * names in full.
 */
async function signIn(page, options) {
  await page.goto(`${options.base}/login`);
  if (options.waitForLogin) {
    process.stdout.write('  waiting for a sign-in in the Chrome window that just opened ...');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      if (await page.eval("return !!localStorage.getItem('kia.auth.token');")) {
        process.stdout.write(' done\n');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('nobody signed in within ten minutes');
  }
  await page.waitFor('input[name="username"], #username');
  await page.eval(`
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('no field ' + selector);
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('input[name="username"], #username', ${JSON.stringify(options.user)});
    set('input[name="password"], #password', ${JSON.stringify(options.password)});
    document.querySelector('form').requestSubmit();
    for (let i = 0; i < 80; i++) {
      if (localStorage.getItem('kia.auth.token')) return;
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('sign-in did not produce a token');
  `);
}

/**
 * The language is set by writing the key the application itself reads, and the
 * next navigation picks it up — never by clicking the switcher, which also PUTs
 * /api/users/{id}/language. The real instance must not be written to for a
 * screenshot, and a reload is enough because an account's own language only
 * takes over at login.
 */
async function useLanguage(page, base, lang) {
  await page.goto(`${base}/categories`);
  await page.eval(`localStorage.setItem('kia.lang', ${JSON.stringify(lang)});`);
}

async function main() {
  const options = parseArgs();
  // A figure marked `instance: 'real'` is left out unless it was asked for by
  // name, and that guard is not ceremony: the demo instance has no ai_calls at
  // all, so shooting the cost ledger against it produces an empty table — a
  // figure whose caption's entire argument is that the amounts in it were
  // measured. It would fail nothing and look fine.
  const figures = FIGURES.filter((figure) =>
    options.only ? options.only.includes(figure.name) : figure.instance !== 'real'
  );
  if (!figures.length) throw new Error('no figure matched --only');

  const { child, profile, wsUrl } = await launchChrome(!options.waitForLogin);
  const cdp = await Cdp.attach(wsUrl);
  let failures = 0;
  try {
    const page = await openPage(cdp);
    await signIn(page, options);

    for (const lang of options.langs) {
      await mkdir(join(ROOT, 'shots', lang), { recursive: true });
      await useLanguage(page, options.base, lang);
      console.log(`\n${lang}`);
      for (const figure of figures) {
        const file = join(ROOT, 'shots', lang, `${figure.name}.png`);
        try {
          // The viewport is set before the navigation, so the page lays out at
          // the height it will be captured at rather than being stretched after.
          await page.setViewportHeight(
            typeof figure.viewport === 'number' ? figure.viewport : VIEWPORT.height
          );
          await page.goto(`${options.base}${figure.route}`);
          await page.waitFor(figure.wait);
          await new Promise((resolve) => setTimeout(resolve, figure.settle ?? 700));
          if (figure.setup) await page.eval(figure.setup);
          if (figure.viewport === 'auto') {
            // Above 640px the window itself does not scroll, so
            // documentElement.scrollHeight is exactly the viewport and says
            // nothing about how much page there is. The deficit has to be read
            // off the element that actually scrolls, and then the viewport
            // grown to swallow it.
            const needed = Math.ceil(await page.eval(`
              const main = document.querySelector('.app-main');
              if (!main) throw new Error('no .app-main to measure');
              return ${VIEWPORT.height} + Math.max(0, main.scrollHeight - main.clientHeight);
            `));
            await page.setViewportHeight(needed);
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          const bytes = await page.shot(file, figure.crop);
          const { width, height } = pngSize(bytes);
          console.log(
            `  ${figure.name.padEnd(13)} ${width}x${height}  ${(bytes.length / 1024).toFixed(0)} kB`
          );
        } catch (error) {
          failures++;
          console.error(`  ${figure.name.padEnd(13)} FAILED: ${error.message}`);
        }
      }
    }
  } finally {
    cdp.close();
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  if (failures) {
    console.error(`\n${failures} figure(s) failed`);
    process.exitCode = 1;
  }
}

await main();
