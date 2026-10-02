// Percorre cada funil clicando no CTA mais provável e salva cada etapa como .mhtml.
// Uso: node capture.mjs [filtro] [--parallel=3] [--max-actions=60]
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const filter = args.find((x) => !x.startsWith('--'));
const PARALLEL = opt('parallel', 3);
const MAX_ACTIONS = opt('max-actions', 60);
const MAX_STATES = opt('max-states', 40);

const ROOT = path.resolve(import.meta.dirname, '..', 'snapshots');
const DATE = new Date().toISOString().slice(0, 10);

const CHECKOUT_RE =
  /(pay|checkout|kiwify|hotmart|hotm\.art|perfectpay|ggcheckout|lastlink|cakto|payt|monetizze|eduzz|braip|kirvano|stripe|yampi|cartpanda|mercadopago|clickbank|digistore|buygoods|pepper|appmax|ticto|greenn)/i;

// Sites alheios ao funil: se um clique levar pra cá, volta.
const OFFSITE_RE =
  /(^|\.)(google\.[a-z.]+|gstatic\.com|lovable\.dev|apple\.com|microsoft\.com|live\.com|vercel\.com|netlify\.com|cloudflare\.com|github\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|twitter\.com|x\.com|whatsapp\.com|wa\.me|t\.me)$/i;
const DEAD_RE =
  /website takedown notice|has been taken down|DEPLOYMENT_NOT_FOUND|deployment could not be found|site not found|page not found|404: not found|project not found|account has been suspended/i;

const DUMMY = {
  name: 'Maria Silva',
  email: 'maria.silva.teste@gmail.com',
  phone: '11987654321',
  cpf: '529.982.247-25',
};

// Acelera timers para liberar CTAs atrasados (ex.: botão que aparece após X minutos de VSL).
const INIT_SCRIPT = `(() => {
  const F = 20, st = window.setTimeout, si = window.setInterval;
  window.setTimeout = (fn, d, ...a) => st(fn, (d || 0) > 500 ? d / F : d, ...a);
  window.setInterval = (fn, d, ...a) => si(fn, (d || 0) > 500 ? Math.max(d / F, 50) : d, ...a);
})();`;

function slugify(url) {
  const u = new URL(url);
  return (u.host + u.pathname).replace(/\/+$/, '').replace(/[^a-z0-9.-]+/gi, '_');
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function signature(page) {
  const { url, text } = await page
    .evaluate(() => ({
      url: location.origin + location.pathname + location.hash,
      text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 4000),
    }))
    .catch(() => ({ url: page.url(), text: '' }));
  const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
  return { exact: h(url + text), loose: h(url.replace(/\d+/g, '') + text.replace(/\d+/g, '')), text };
}

async function fillInputs(page) {
  return page
    .evaluate((D) => {
      let n = 0;
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const set = (el, v) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        n++;
      };
      for (const el of document.querySelectorAll('input, textarea, select')) {
        if (!vis(el) || el.disabled || el.readOnly) continue;
        if (el.tagName === 'SELECT') {
          if (el.selectedIndex <= 0 && el.options.length > 1) {
            el.selectedIndex = 1;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            n++;
          }
          continue;
        }
        const t = (el.type || 'text').toLowerCase();
        if (['hidden', 'submit', 'button', 'image', 'file', 'reset'].includes(t)) continue;
        if (t === 'checkbox') { if (!el.checked) { el.click(); n++; } continue; }
        if (t === 'radio') continue;
        if (el.value) continue;
        const hint = `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
        if (t === 'email' || /mail/.test(hint)) set(el, D.email);
        else if (t === 'tel' || /phone|fone|telefone|celular|whats/.test(hint)) set(el, D.phone);
        else if (/cpf|document/.test(hint)) set(el, D.cpf);
        else if (/pix|chave|key/.test(hint)) set(el, D.email);
        else if (t === 'number' || /valor|amount|quant/.test(hint)) set(el, '100');
        else if (t === 'date') set(el, '1990-01-01');
        else set(el, D.name);
      }
      return n;
    }, DUMMY)
    .catch(() => 0);
}

// Marca elementos clicáveis com data-cap-id e devolve-os ordenados por "cara de CTA".
async function candidates(page, tried) {
  return page
    .evaluate((tried) => {
      const POS = /continu|pr[oó]xim|avan[cç]|come[cç]|inici|start|next|sacar|saque|withdraw|retir|resgat|claim|receb|recib|quero|^sim|yes|^s[ií]\b|acess|acced|access|garant|compr|buy|^get|obter|liber|desbloq|unlock|confirm|enviar|submit|^ok|entendi|vamos|^go\b|assist|watch|ganh|earn|cobr|reclam|avali|rate|gostei|like|curti|empez|siguiente|seguir|aceit|accept|cadastr|regist|sign ?up|join|particip|play|jogar|girar|spin|abrir|open|ver /i;
      const NEG = /^n[aã]o\b|^no\b|cancel|privac|termos|terms|pol[ií]tica|policy|cookie|fechar|close|voltar|back|^x$|recusar|decline|contato|contact|suporte|support|faq/i;
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return false;
        const s = getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
      };
      const out = [];
      const els = new Set(document.querySelectorAll(
        'a[href], button, [role=button], input[type=submit], input[type=button], input[type=radio], label, [onclick], [class*=btn], [class*=button], [class*=cta], [class*=option], [class*=opcao], [class*=resposta], [class*=answer]'
      ));
      for (const el of document.querySelectorAll('div, span, li, img, svg')) {
        if (getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) els.add(el);
      }
      let id = 0;
      for (const el of els) {
        if (!vis(el) || el.disabled) continue;
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.alt || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const href = el.getAttribute('href') || '';
        if (/^(mailto:|tel:|javascript:void)/.test(href)) continue;
        if (/facebook\.com|instagram\.com|twitter\.com|x\.com\/|youtube\.com|tiktok\.com|linkedin\.com|google\.|lovable\.dev|apple\.com/.test(href)) continue;
        if (/google|apple|sign in|log ?in|entrar com|lovable|report|denunc/i.test(text)) continue;
        const key = `${el.tagName}|${text}|${href}`;
        let score = 0;
        if (POS.test(text)) score += 10;
        if (NEG.test(text)) score -= 15;
        if (el.tagName === 'BUTTON' || el.type === 'submit') score += 4;
        if (/btn|button|cta/i.test(el.className?.baseVal ?? el.className ?? '')) score += 3;
        if (/option|opcao|resposta|answer/i.test(el.className?.baseVal ?? el.className ?? '')) score += 2;
        if (el.tagName === 'INPUT' && el.type === 'radio') score += 1;
        const r = el.getBoundingClientRect();
        score += Math.min(4, (r.width * r.height) / 15000);
        if (!text) score -= 3;
        if (tried.includes(key)) score -= 100;
        el.setAttribute('data-cap-id', String(id));
        out.push({ id: id++, key, text, href, score });
      }
      return out.sort((a, b) => b.score - a.score);
    }, tried)
    .catch(() => []);
}

// Torna visíveis links/botões escondidos (CTA que só aparece após o vídeo).
async function revealHidden(page) {
  return page
    .evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll('a[href], button, [class*=btn], [class*=cta]')) {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && r.width > 0) continue;
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          const es = getComputedStyle(e);
          if (es.display === 'none') e.style.setProperty('display', 'block', 'important');
          if (es.visibility === 'hidden') e.style.setProperty('visibility', 'visible', 'important');
          if (Number(es.opacity) < 0.05) e.style.setProperty('opacity', '1', 'important');
          e.removeAttribute('hidden');
        }
        n++;
      }
      return n;
    })
    .catch(() => 0);
}

// Sliders tipo "arraste até a área verde": tenta arrastar o pino até várias posições da trilha.
async function tryDrag(page) {
  const geo = await page
    .evaluate(() => {
      const RE = /drag|arrast|desliz|slide|deslice|swipe/i;
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      let handle = [...document.querySelectorAll('input[type=range], [role=slider]')].find(vis);
      if (!handle) {
        const label = [...document.querySelectorAll('body *')].find((el) => vis(el) && el.children.length < 4 && RE.test(el.textContent || '') && (el.textContent || '').length < 120);
        if (!label) return null;
        let box = label;
        while (box.parentElement && box.getBoundingClientRect().width < 200) box = box.parentElement;
        const scope = box.parentElement || box;
        handle = [...scope.querySelectorAll('*')].filter(vis).find((el) => /grab|move|pointer/.test(getComputedStyle(el).cursor) || el.draggable) || label;
      }
      let track = handle.parentElement;
      while (track && track.parentElement && track.getBoundingClientRect().width < 200) track = track.parentElement;
      handle.scrollIntoView({ block: 'center' });
      const h = handle.getBoundingClientRect(), t = (track || handle).getBoundingClientRect();
      return { hx: h.x + h.width / 2, hy: h.y + h.height / 2, tx: t.x, tw: t.width };
    })
    .catch(() => null);
  if (!geo) return false;
  const before = await signature(page);
  for (const f of [0.5, 0.65, 0.8, 0.95, 0.35, 0.72, 0.58, 0.88]) {
    await page.mouse.move(geo.hx, geo.hy);
    await page.mouse.down();
    await page.mouse.move(geo.tx + geo.tw * f, geo.hy + 2, { steps: 20 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(1800);
    if ((await signature(page)).exact !== before.exact) return true;
  }
  return false;
}

const isOffsite = (url) => { try { return OFFSITE_RE.test(new URL(url).host); } catch { return false; } };

async function snapshot(context, page, file) {
  const cdp = await context.newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
    await fs.writeFile(file, data);
    return data.length;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function crawl(browser, group, startUrl) {
  const dir = path.join(ROOT, group, slugify(startUrl), DATE);
  await fs.mkdir(dir, { recursive: true });
  const context = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true });
  await context.addInitScript(INIT_SCRIPT);
  let page = await context.newPage();
  context.on('page', (p) => { page = p; });
  context.on('dialog', (d) => d.accept().catch(() => {}));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const meta = { startUrl, group, capturedAt: new Date().toISOString(), steps: [], end: null };
  const savedLoose = new Set();
  const triedByState = new Map();
  const retries = new Map();
  const log = (m) => console.log(`[${slugify(startUrl)}] ${m}`);

  try {
    const resp = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    meta.httpStatus = resp?.status() ?? null;
    await settle(page);
    const firstText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if ((meta.httpStatus && meta.httpStatus >= 400) || DEAD_RE.test(firstText.slice(0, 2000))) {
      await snapshot(context, page, path.join(dir, 'step-01.mhtml')).catch(() => {});
      meta.steps.push({ file: 'step-01.mhtml', url: page.url(), title: await page.title().catch(() => ''), via: '(entrada)' });
      meta.end = `fora do ar (HTTP ${meta.httpStatus}${DEAD_RE.test(firstText) ? ', página de remoção/erro' : ''})`;
      throw Object.assign(new Error(meta.end), { dead: true });
    }
    let lastAction = '(entrada)';
    let stuckRounds = 0;

    for (let action = 0; action < MAX_ACTIONS; action++) {
      await settle(page);
      page.on('dialog', (d) => d.accept().catch(() => {}));
      const sig = await signature(page);
      const url = page.url();

      if (!savedLoose.has(sig.loose) && meta.steps.length < MAX_STATES) {
        savedLoose.add(sig.loose);
        const file = `step-${String(meta.steps.length + 1).padStart(2, '0')}.mhtml`;
        const size = await snapshot(context, page, path.join(dir, file)).catch((e) => (log(`snapshot falhou: ${e.message}`), 0));
        const title = await page.title().catch(() => '');
        meta.steps.push({ file, url, title, via: lastAction, bytes: size });
        log(`#${meta.steps.length} ${url} — ${title.slice(0, 50)}`);
      }

      const host = new URL(url).host;
      if (host !== new URL(startUrl).host && CHECKOUT_RE.test(host)) { meta.end = `checkout: ${host}`; break; }
      if (await page.locator('input[autocomplete="cc-number"], input[name*="card" i]').count().catch(() => 0)) { meta.end = 'formulário de cartão'; break; }
      if (meta.steps.length >= MAX_STATES) { meta.end = 'limite de etapas'; break; }

      await fillInputs(page);
      const tried = triedByState.get(sig.exact) || [];
      triedByState.set(sig.exact, tried);
      let cands = (await candidates(page, tried)).filter((c) => c.score > -50);

      if (!cands.length) {
        await page.waitForTimeout(8000); // timers acelerados ≈ 2-3 min reais
        cands = (await candidates(page, tried)).filter((c) => c.score > -50);
      }
      if (!cands.length && (await tryDrag(page))) { lastAction = '(slider arrastado)'; continue; }
      if (!cands.length && (await revealHidden(page))) {
        cands = (await candidates(page, tried)).filter((c) => c.score > -50);
      }
      if (!cands.length && (retries.get(sig.exact) || 0) < 3) {
        retries.set(sig.exact, (retries.get(sig.exact) || 0) + 1);
        tried.length = 0; // re-tenta os mesmos botões (podem estar esperando uma animação)
        cands = (await candidates(page, tried)).filter((c) => c.score > -50);
      }
      if (!cands.length) { meta.end = 'sem mais elementos clicáveis'; break; }

      const c = cands[0];
      tried.push(c.key);
      lastAction = c.text || c.href || c.key;
      const before = page;
      const loc = page.locator(`[data-cap-id="${c.id}"]`).first();
      await loc.click({ timeout: 4000 }).catch(() => loc.click({ timeout: 2000, force: true })).catch(() => loc.evaluate((el) => el.click())).catch(() => {});
      await page.waitForTimeout(2500);
      if (page !== before) {
        if (isOffsite(page.url())) { await page.close().catch(() => {}); page = before; }
        else log(`nova aba: ${page.url()}`);
      }
      if (isOffsite(page.url())) {
        log(`saiu do funil (${new URL(page.url()).host}), voltando`);
        await page.goBack({ timeout: 15000 }).catch(() => {});
        if (isOffsite(page.url())) { meta.end = `saiu do funil: ${page.url()}`; break; }
        continue;
      }

      const after = await signature(page);
      if (after.exact === sig.exact) {
        if (++stuckRounds >= 12) { meta.end = 'travado (nenhum clique mudou a página)'; break; }
      } else stuckRounds = 0;
    }
    if (!meta.end) meta.end = 'limite de ações';
  } catch (e) {
    if (!e.dead) meta.end = `erro: ${e.message.split('\n')[0]}`;
    log(meta.end);
  } finally {
    meta.finalUrl = page.url();
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    await context.close().catch(() => {});
  }
  log(`fim (${meta.steps.length} etapas) — ${meta.end}`);
  return meta;
}

const urls = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'urls.json'), 'utf8'));
const jobs = Object.entries(urls)
  .flatMap(([group, list]) => list.map((url) => ({ group, url })))
  .filter((j) => !filter || j.url.includes(filter));

const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
const results = [];
const queue = [...jobs];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const j = queue.shift();
      const m = await crawl(browser, j.group, j.url);
      results.push({ group: j.group, url: j.url, steps: m.steps.length, end: m.end, finalUrl: m.finalUrl });
    }
  })
);
await browser.close();
console.table(results.map((r) => ({ url: r.url.replace(/^https:\/\//, ''), etapas: r.steps, fim: r.end })));
