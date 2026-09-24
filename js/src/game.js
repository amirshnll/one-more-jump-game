const $ = (s) => document.querySelector(s);
const canvas = $('#game'), ctx = canvas.getContext('2d');
const STEP = 1 / 120, GRAVITY = 1850, JUMP = 650, START_SPEED = 250;
const locales = ['en', 'fa', 'ar', 'es', 'fr', 'de', 'tr', 'sv', 'et', 'ja', 'ko', 'zh', 'it'];
const languageNames = { en: 'English', fa: 'فارسی', ar: 'العربية', es: 'Español', fr: 'Français', de: 'Deutsch', tr: 'Türkçe', sv: 'Svenska', et: 'Eesti', ja: '日本語', ko: '한국어', zh: '中文', it: 'Italiano' };
let strings = {}, state, settings = { language: 'en', sound: true, reducedMotion: false, bestDistance: 0, highScore: 0, gamesPlayed: 0 };
let view = { w: 0, h: 0, dpr: 1 }, last = 0, accumulator = 0, audio, jumpQueued = false, jumpQueuedByKeyboard = false;

const storage = {
  get: () => new Promise(resolve => chrome.storage.local.get(settings, resolve)),
  set: (x) => chrome.storage.local.set(x)
};
async function loadStrings(lang) { return (await fetch(`_locales/${lang}/messages.json`)).json(); }
function t(key) { return strings[key]?.message || key; }
function metric(value) { return `\u2066${value} m\u2069`; }
function rtl(lang) { return lang === 'fa' || lang === 'ar'; }
function populateLanguages() {
  const fragment = document.createDocumentFragment();
  for (const locale of locales) {
    const option = document.createElement('option'); option.value = locale; option.textContent = languageNames[locale]; fragment.append(option);
  }
  $('#language').replaceChildren(fragment);
}
async function applyLanguage(lang) {
  strings = await loadStrings(lang); settings.language = lang;
  document.documentElement.lang = lang; document.documentElement.dir = rtl(lang) ? 'rtl' : 'ltr';
  document.body.classList.toggle('rtl', rtl(lang));
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  document.title = t('gameTitle');
  canvas.setAttribute('aria-label', t('gameArea'));
  $('#language').value = lang; $('#sound').checked = settings.sound; $('#motion').checked = settings.reducedMotion;
  await storage.set({ language: lang }); renderHud();
}
function resize() { view.dpr = Math.min(devicePixelRatio || 1, 2); view.w = innerWidth; view.h = innerHeight; canvas.width = view.w * view.dpr; canvas.height = view.h * view.dpr; ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); }
function freshState() {
  return { running: false, dead: false, x: 120, y: 0, vy: 0, onGround: true, speed: START_SPEED, camera: 0, distance: 0, coins: 0, score: 0, platforms: [{ x: -300, y: 0, w: 650 }], coinsWorld: [], spikes: [], particles: [], shake: 0, nextX: 350, lastY: 0, checkpoint: 0, lastCheckpoint: 0 };
}
function safeGenerate() {
  const airtime = (2 * JUMP) / GRAVITY;
  const maxGap = Math.min(285, state.speed * airtime * .62);
  const gap = 90 + Math.random() * Math.max(25, maxGap - 105);
  const deltaY = (Math.random() - .5) * 105;
  const y = Math.max(-155, Math.min(85, state.lastY + deltaY));
  const width = 165 + Math.random() * 150;
  const x = state.nextX + gap;
  state.platforms.push({ x, y, w: width }); state.nextX = x + width; state.lastY = y;
  if (Math.random() < .57) state.coinsWorld.push({ x: x + width * (.35 + Math.random() * .35), y: y - 58, taken: false });
  if (width > 245 && state.distance > 180 && Math.random() < .22) state.spikes.push({ x: x + width * .55, y });
  if (state.platforms.length % 12 === 0) state.lastCheckpoint = x;
}
function start() {
  state = freshState(); jumpQueued = false; jumpQueuedByKeyboard = false; for (let i = 0; i < 9; i++) safeGenerate(); state.running = true;
  $('#menu').classList.add('hidden'); $('#over').classList.add('hidden'); $('#jump').classList.remove('hidden'); canvas.focus();
  settings.gamesPlayed++; storage.set({ gamesPlayed: settings.gamesPlayed });
}
function jump(fromKeyboard = false) { if (!state?.running) return; if (!state.onGround) { jumpQueued = true; jumpQueuedByKeyboard = fromKeyboard; return; } jumpQueued = false; jumpQueuedByKeyboard = false; state.vy = -JUMP; state.onGround = false; beep(430, .045); }
function beep(freq, time) { if (!settings.sound) return; try { audio ||= new AudioContext(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = freq; g.gain.setValueAtTime(.035, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + time); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + time); } catch { } }
function update(dt) {
  if (!state.running) return;
  state.speed = Math.min(500, START_SPEED + state.distance * .32);
  const oldY = state.y; state.x += state.speed * dt; state.vy += GRAVITY * dt; state.y += state.vy * dt; state.onGround = false;
  for (const p of state.platforms) if (state.vy >= 0 && oldY <= p.y && state.y >= p.y && state.x + 20 > p.x && state.x - 15 < p.x + p.w) { state.y = p.y; state.vy = 0; state.onGround = true; }
  if (state.onGround && jumpQueued) jump();
  for (const c of state.coinsWorld) if (!c.taken && Math.hypot(state.x - c.x, state.y - c.y) < 32) { c.taken = true; state.coins++; state.score += 25; beep(760, .05); }
  for (const spike of state.spikes) if (state.x + 14 > spike.x - 13 && state.x - 14 < spike.x + 13 && state.y > spike.y - 32) { die(); return; }
  state.distance = Math.max(0, Math.floor((state.x - 120) / 10)); state.score = state.distance + state.coins * 25;
  state.camera += ((state.x - view.w * .30) - state.camera) * Math.min(1, dt * (settings.reducedMotion ? 14 : 5));
  while (state.nextX < state.x + view.w * 2) safeGenerate();
  state.platforms = state.platforms.filter(p => p.x + p.w > state.camera - 200); state.coinsWorld = state.coinsWorld.filter(c => !c.taken && c.x > state.camera - 150); state.spikes = state.spikes.filter(s => s.x > state.camera - 150);
  if (state.y > 320) die();
}
function die() {
  state.running = false; state.dead = true; jumpQueued = false; jumpQueuedByKeyboard = false; $('#jump').classList.add('hidden'); const isBest = state.distance > settings.bestDistance;
  settings.bestDistance = Math.max(settings.bestDistance, state.distance); settings.highScore = Math.max(settings.highScore, state.score); storage.set({ bestDistance: settings.bestDistance, highScore: settings.highScore });
  $('#result').textContent = `${t('distance')}: ${metric(state.distance)} · ${t('coins')}: ${state.coins} · ${t('score')}: ${state.score}`;
  $('#newBest').textContent = isBest ? t('newBest') : ''; $('#over').classList.remove('hidden'); $('#again').focus(); beep(140, .16);
}
function renderHud() { const s = state || freshState(); $('#distance').textContent = metric(s.distance); $('#coinCount').textContent = s.coins; $('#best').textContent = metric(settings.bestDistance); }
function render() {
  const { w, h } = view; ctx.clearRect(0, 0, w, h); const sky = ctx.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#0b1c35'); sky.addColorStop(1, '#07111f'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  const cam = state?.camera || 0, base = h * .67; ctx.save(); ctx.translate(-cam, base);
  ctx.globalAlpha = .18; ctx.fillStyle = '#7de0ff'; for (let x = Math.floor(cam / 90) * 90; x < cam + w + 100; x += 90) { ctx.fillRect(x, -300, 1, 300) } ctx.globalAlpha = 1;
  if (state) {
    for (const p of state.platforms) { ctx.fillStyle = '#284768'; ctx.fillRect(p.x, p.y, p.w, 18); ctx.fillStyle = '#7de0ff'; ctx.fillRect(p.x, p.y, p.w, 5) } for (const spike of state.spikes) { ctx.fillStyle = '#ff6f79'; ctx.beginPath(); ctx.moveTo(spike.x - 12, spike.y); ctx.lineTo(spike.x, spike.y - 23); ctx.lineTo(spike.x + 12, spike.y); ctx.fill() } for (const c of state.coinsWorld) { ctx.fillStyle = '#ffdb71'; ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#d79c27'; ctx.fillRect(c.x - 2, c.y - 5, 4, 10) }
    const px = state.x, py = state.y; ctx.fillStyle = '#ffdb71'; ctx.beginPath(); ctx.arc(px, py - 18, 18, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#0b1c35'; ctx.beginPath(); ctx.arc(px + 7, py - 22, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore(); renderHud();
}
function frame(now) { const elapsed = Math.min(.1, (now - last) / 1000 || 0); last = now; accumulator += elapsed; while (accumulator >= STEP) { update(STEP); accumulator -= STEP } render(); requestAnimationFrame(frame); }
function showMenu() { if (state) state.running = false; jumpQueued = false; jumpQueuedByKeyboard = false; $('#over').classList.add('hidden'); $('#settings').classList.add('hidden'); $('#menu').classList.remove('hidden'); $('#jump').classList.add('hidden'); $('#play').focus(); }
$('#play').onclick = start; $('#again').onclick = start; $('#menuBtn').onclick = showMenu; $('#settingsBtn').onclick = () => { $('#menu').classList.add('hidden'); $('#settings').classList.remove('hidden'); $('#language').focus() }; $('#closeSettings').onclick = showMenu;
$('#language').onchange = e => applyLanguage(e.target.value); $('#sound').onchange = e => { settings.sound = e.target.checked; storage.set({ sound: settings.sound }) }; $('#motion').onchange = e => { settings.reducedMotion = e.target.checked; storage.set({ reducedMotion: settings.reducedMotion }) };
$('#jump').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); jump() }); canvas.addEventListener('pointerdown', jump); addEventListener('keydown', e => { if (e.code === 'Space') { if (!$('#settings').classList.contains('hidden')) return; e.preventDefault(); if (e.repeat) return; if (!$('#menu').classList.contains('hidden') || !$('#over').classList.contains('hidden')) start(); else jump(true) } else if (e.code === 'ArrowUp') { e.preventDefault(); if (!e.repeat) jump(true) } if (e.code === 'Escape') showMenu() }); addEventListener('keyup', e => { if (['Space', 'ArrowUp'].includes(e.code) && jumpQueuedByKeyboard) { jumpQueued = false; jumpQueuedByKeyboard = false } }); addEventListener('resize', resize);
(async () => { Object.assign(settings, await storage.get()); populateLanguages(); await applyLanguage(settings.language); resize(); state = freshState(); requestAnimationFrame(frame); })();
