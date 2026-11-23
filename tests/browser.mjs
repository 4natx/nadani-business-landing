import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { basePath, serve } from '../tools/serve.mjs';

const candidates = [
  process.env.BROWSER_PATH,
  join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/chromium', '/usr/bin/google-chrome',
];
const executable = candidates.find(path => path && existsSync(path));
if (!executable) throw new Error('Defina BROWSER_PATH para o executável do Chrome, Chromium ou Edge.');

const profileRoot = resolve(tmpdir());
const profile = await mkdtemp(join(profileRoot, 'nadani-browser-'));
const browser = spawn(executable, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
browser.on('error', error => console.error(error.message));
const problems = [];
let server;
let socket;
let cdp;

async function until(callback, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await callback();
    if (result) return result;
    await delay(45);
  }
  throw new Error(`Tempo excedido: ${description}`);
}

async function connect(port) {
  const [page] = await fetch(`http://127.0.0.1:${port}/json/list`).then(res => res.json());
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveConnection, reject) => {
    socket.addEventListener('open', resolveConnection, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const { id: messageId, method, params, result, error } = JSON.parse(data);
    if (pending.has(messageId)) {
      const { resolveCall, reject } = pending.get(messageId);
      pending.delete(messageId);
      if (error) reject(new Error(error.message));
      else resolveCall(result);
    }
    if (method === 'Runtime.exceptionThrown') {
      problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    }
    if (method === 'Log.entryAdded' && params.entry.level === 'error') problems.push(params.entry.text);
    if (method === 'Network.requestWillBeSent' && ['XHR', 'Fetch', 'Ping'].includes(params.type)) problems.push(params.request.url);
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      problems.push(`${params.response.status} ${params.response.url}`);
    }
  });
  return (method, params = {}) => new Promise((resolveCall, reject) => {
    pending.set(++id, { resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? expression);
  return response.result.value;
}

async function key(name, code) {
  const args = { key: name, code: name, windowsVirtualKeyCode: code };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...args, text: name === 'Enter' ? '\r' : undefined });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...args });
}

async function pointer(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y });
}

async function capture(name) {
  if (!process.argv.includes('--screenshots')) return;
  await mkdir(new URL('../docs/screenshots/', import.meta.url), { recursive: true });
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(`../docs/screenshots/${name}.png`, import.meta.url), Buffer.from(data, 'base64'));
}

try {
  server = await serve(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + basePath;
  const portFile = join(profile, 'DevToolsActivePort');
  const port = await until(async () => {
    const content = await readFile(portFile, 'utf8').catch(() => '');
    return Number(content.split('\n')[0]);
  }, 'inicializar Chromium');
  cdp = await connect(port);
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await cdp(`${domain}.enable`);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp('Page.navigate', { url });
  await until(() => evaluate('document.readyState === "complete" && document.querySelector(".menu-ready") !== null'), 'carregar página e módulos');

  for (const width of [1440, 1024, 768, 375, 320]) {
    const height = width < 600 ? 900 : 950;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate('window.scrollTo(0, 0)');
    const layout = await evaluate(`({
      viewport: innerWidth, width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      columns: getComputedStyle(document.querySelector('.hero')).gridTemplateColumns.split(' ').length,
      toggle: getComputedStyle(document.querySelector('.menu-toggle')).display,
      motion: getComputedStyle(document.documentElement).scrollBehavior
    })`);
    assert.equal(layout.viewport, width);
    if (layout.scrollWidth > layout.width) console.log(await evaluate("[...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 2).map(el => [el.tagName, el.className, el.getBoundingClientRect().right]).slice(0, 20)"));
    assert.equal(layout.scrollWidth, layout.width, `Overflow em ${width}px`);
    assert.equal(layout.columns, width >= 768 ? 2 : 1);
    assert.equal(layout.toggle === 'none', width >= 928);
    assert.equal(layout.motion, 'auto');
    if (width === 1440 && process.argv.includes('--screenshots')) {
      await capture('desktop');
      await evaluate(`new Promise(resolve => {
        document.getElementById('agendamento').scrollIntoView({ behavior: 'instant' });
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })`);
      assert.ok(await evaluate('document.getElementById("booking-title").getBoundingClientRect().top < 450 && document.getElementById("booking-title").getBoundingClientRect().top > 80'));
      await capture('agendamento');
    }
    if (width === 375) await capture('mobile');
  }
  console.log('Layout em 320, 375, 768, 1024 e 1440 px, com movimento reduzido.');

  const internalIssues = await evaluate(`[...document.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(a.hash.slice(1))).map(a => a.hash)`);
  assert.deepEqual(internalIssues, []);
  assert.equal(await evaluate('new Set([...document.querySelectorAll("[id]")].map(el => el.id)).size === document.querySelectorAll("[id]").length'), true);
  const assetPaths = await evaluate(`[...document.querySelectorAll('img[src], script[src], link[href], use[href], .gallery-open')].map(el => new URL(el.getAttribute('src') || el.getAttribute('href'), location.href).pathname)`);
  for (const path of new Set([...assetPaths, basePath + 'css/responsive.css', basePath + 'js/booking.js', basePath + 'js/config.js'])) {
    assert.ok(path.startsWith(basePath), path);
    assert.equal((await fetch(origin + path)).status, 200, path);
  }
  assert.equal(await evaluate('document.querySelector(".footer-bottom a").href'), 'https://nadani.space/');

  await evaluate('document.querySelector(".menu-toggle").focus()');
  await key('Enter', 13);
  assert.equal(await evaluate('document.querySelector(".menu-toggle").getAttribute("aria-expanded")'), 'true');
  await key('Tab', 9);
  assert.equal(await evaluate('document.activeElement.hash'), '#sobre');
  await key('Escape', 27);
  assert.equal(await evaluate('document.activeElement.classList.contains("menu-toggle")'), true);
  assert.equal(await evaluate('document.querySelector(".menu-toggle").getAttribute("aria-expanded")'), 'false');
  await key('Enter', 13);
  await key('Tab', 9);
  await key('Enter', 13);
  assert.equal(await evaluate('location.hash'), '#sobre');
  await until(() => evaluate('document.activeElement.id === "about-title"'), 'mover foco para a seção');
  await until(() => evaluate('document.querySelector("#nav a[aria-current]")?.hash === "#sobre"'), 'atualizar seção ativa');
  assert.equal(await evaluate('document.querySelector(".site-header").getBoundingClientRect().top'), 0);

  await evaluate('document.querySelector("#faq summary").focus()');
  await key('Enter', 13);
  assert.equal(await evaluate('document.querySelector("#faq details").open'), true);
  await evaluate('document.querySelectorAll("#faq summary")[1].click()');
  assert.equal(await evaluate('document.querySelectorAll("#faq details[open]").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll("#faq details")[1].open'), true);

  await evaluate('document.querySelector(".gallery-open").focus()');
  await key('Enter', 13);
  assert.equal(await evaluate('document.querySelector("dialog").open'), true);
  assert.equal(await evaluate('document.activeElement.classList.contains("gallery-close")'), true);
  await key('ArrowRight', 39);
  assert.equal(await evaluate('document.querySelector("#gallery-position").textContent'), '2 de 3');
  await evaluate('document.querySelector("#gallery-prev").click()');
  assert.equal(await evaluate('document.querySelector("#gallery-position").textContent'), '1 de 3');
  await key('Escape', 27);
  await until(() => evaluate('!document.querySelector("dialog").open && document.activeElement.classList.contains("gallery-open")'), 'restaurar foco após Escape');
  await evaluate('document.querySelector(".gallery-open").click()');
  await evaluate('document.querySelector(".gallery-close").click()');
  assert.equal(await evaluate('document.querySelector("dialog").open'), false);
  await evaluate('document.querySelector(".gallery-open").click()');
  await pointer(2, 2);
  assert.equal(await evaluate('document.querySelector("dialog").open'), false);
  console.log('Âncoras, seção ativa, menu por teclado, FAQ e galeria verificados.');

  assert.equal(await evaluate(`
    [...document.querySelectorAll('[data-service]')].every(link => {
      link.click();
      return document.querySelector('#service').value === link.dataset.service;
    })
  `), true);
  assert.equal(await evaluate('location.hash'), '#agendamento');
  await evaluate('document.querySelector("#booking-form").requestSubmit()');
  assert.equal(await evaluate('document.querySelectorAll("[aria-invalid=true]").length'), 5);
  assert.equal(await evaluate('document.activeElement.id'), 'guardian');
  await evaluate('document.querySelector("#fill-example").click()');
  assert.equal(await evaluate('document.querySelector("#service").value'), 'cuidados');
  await evaluate(`
    const date = document.querySelector('#date');
    date.value = '1999-01-01';
    document.querySelector('#booking-form').requestSubmit();
  `);
  assert.equal(await evaluate('document.querySelector("#date").getAttribute("aria-invalid")'), 'true');
  await evaluate(`
    document.querySelector('#fill-example').click();
    document.querySelector('#notes').value = '<strong>Teste</strong>';
    const form = document.querySelector('#booking-form');
    form.requestSubmit();
    form.requestSubmit();
  `);
  assert.equal(await evaluate('document.querySelector("#booking-result").hidden'), false);
  assert.equal(await evaluate('document.activeElement.id'), 'result-title');
  assert.equal(await evaluate('document.querySelectorAll("#result-fields dd").length'), 7);
  assert.equal(await evaluate('document.querySelector("#result-fields strong")'), null);
  assert.equal(await evaluate('document.querySelector(".success-note").textContent.includes("Nenhum agendamento real foi realizado.")'), true);
  assert.equal(await evaluate('localStorage.length + sessionStorage.length'), 0);

  await evaluate(`
    window.copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.copied = text; }
    }});
    document.querySelector('#copy-summary').click();
  `);
  await until(() => evaluate('window.copied.includes("Marina Demo")'), 'copiar resumo');
  assert.equal(await evaluate('document.querySelector("#copy-feedback").textContent'), 'Resumo copiado.');
  await evaluate(`
    Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async () => { throw new Error('Denied'); }
    }});
    document.querySelector('#copy-summary').click();
  `);
  await until(() => evaluate('!document.querySelector("#manual-copy").hidden'), 'exibir cópia manual');
  assert.equal(await evaluate('document.querySelector("#manual-text").value === window.copied'), true);
  await evaluate('document.querySelector("#new-booking").click()');
  assert.equal(await evaluate('document.querySelector("#booking-result").hidden && document.querySelector("#guardian").value === ""'), true);
  assert.equal(await evaluate('document.activeElement.id'), 'guardian');

  await evaluate(`Promise.all([...document.images].map(img => { img.loading = 'eager'; return img.decode(); }))`);
  assert.deepEqual(problems, []);
  console.log('Formulário, datas, preenchimento, resumo, duplicidade e cópia verificados.');
  console.log('Recursos estáticos no subdiretório carregados sem erros HTTP nem erros de console.');
} finally {
  if (cdp && socket.readyState === WebSocket.OPEN) {
    await Promise.race([cdp('Browser.close').catch(() => {}), delay(700)]);
    socket.close();
  }
  if (browser.exitCode === null) {
    await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), delay(2000)]);
  }
  if (browser.exitCode === null) browser.kill();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  if (dirname(profile) === profileRoot) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
