// Builds the stage and one paused GSAP timeline for the whole film.
//
// window.__seek(t)  draws the frame at t seconds (used by tools/render.mjs)
// window.__duration total length in seconds
// window.__cues     [{t, type, ...}] sound cues, read by audio/score.py
// window.__ready    true once fonts are loaded and the timeline is built
//
// Opened directly in a browser it plays in real time: space to pause, arrow
// keys to scrub, a number key to jump to that tenth of the film.
import { phone, scrambleCards, textBlocks, callouts, subtitles } from './screens.js';
// How long Maa's question and the spoken answer run (tools/voices.py).
import { VOICES } from './voices.js';

const gsap = window.gsap;
gsap.registerPlugin(window.TextPlugin);

const PORTRAIT = new URLSearchParams(location.search).get('orientation') === 'portrait';
// The short cut (about a minute, for Reels/Shorts) keeps the story and one
// pass through the product: hook, scramble, insight, the missed call, Gmail
// import, Ask, Hindi voice, resolution. It drops the statistic, Scan, the
// family tree, the emergency card, Reminders and Privacy.
const SHORT = new URLSearchParams(location.search).get('cut') === 'short';
const W = PORTRAIT ? 1080 : 1920;
const H = PORTRAIT ? 1920 : 1080;

// ─── Layout: every position that differs between 16:9 and 9:16 ───────────
// Phone positions are the centre of the device in stage pixels.
// Callouts sit beside the phone in 16:9 and in the band above it in 9:16.
const L = PORTRAIT ? {
  // Day scenes leave room above the phone for a callout to take the paragraph's place.
  hookPhone: [540, 1150, 1.0], callPhone: [540, 1160, 0.96], dayPhone: [540, 1176, 0.94],
  resPhone: [540, 1176, 0.94], coScale: 0.88,
  cards: { mail: [520, 590, -3], work: [590, 820, 3], pdf: [470, 1060, -2], otp: [620, 1290, 2.5], note: [470, 1500, -5] },
  // In 9:16 these take the place of the paragraph once it has been read.
  coGmail: 't-gmail', coScan: 't-scan', coTree: 't-tree', coAlerts: 't-alerts', wave: null, resWave: null,
} : {
  hookPhone: [1260, 540, 0.98], callPhone: [660, 540, 0.95], dayPhone: [1270, 548, 0.94],
  resPhone: [1290, 548, 0.94],
  cards: { mail: [575, 430, -3], work: [1355, 345, 3], pdf: [985, 655, -2], otp: [1440, 790, 2.5], note: [505, 800, -5] },
  coGmail: [1630, 700], coScan: [1628, 690], coTree: [1636, 720], coAlerts: [1636, 730], wave: [1690, 548], resWave: [1705, 548],
};

// ─── Build the stage ─────────────────────────────────────────────────────
const stage = document.getElementById('stage');
stage.className = PORTRAIT ? 'portrait' : 'landscape';
stage.innerHTML = `
  <div id="bg-night" class="layer"></div>
  <div id="bg-day" class="layer"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="grid"></div></div>
  <div id="cards" class="layer">${scrambleCards()}</div>
  <div id="texts" class="layer">${textBlocks()}</div>
  ${phone()}
  <div id="callouts" class="layer">${callouts()}</div>
  <div id="subs">${subtitles()}</div>
  <div id="vignette" class="layer"></div>
  <div id="fade" class="layer"></div>`;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function fit() {
  const k = Math.min(innerWidth / W, innerHeight / H);
  Object.assign(stage.style, {
    position: 'absolute', transform: `scale(${k})`,
    left: `${(innerWidth - W * k) / 2}px`, top: `${(innerHeight - H * k) / 2}px`,
  });
}
fit();
addEventListener('resize', fit);

await Promise.all([
  '700 86px "Bricolage Grotesque"', '300 190px "Bricolage Grotesque"', 'italic 400 120px "Instrument Serif"',
  '400 15px Roboto', '500 15px Roboto', '700 15px Roboto', 'italic 400 12px Roboto',
  '400 15px "Noto Sans Devanagari"', '600 38px Caveat',
].map((f) => document.fonts.load(f)));
// The voice languages' scripts: a subset loads only for text it covers.
await Promise.all([
  ['Noto Sans Devanagari', 'हिन्दी मराठी'], ['Noto Sans Bengali', 'বাংলা'], ['Noto Sans Tamil', 'தமிழ்'],
  ['Noto Sans Telugu', 'తెలుగు'], ['Noto Sans Gujarati', 'ગુજરાતી'], ['Noto Sans Kannada', 'ಕನ್ನಡ'],
  ['Noto Sans Malayalam', 'മലയാളം'], ['Noto Sans Gurmukhi', 'ਪੰਜਾਬੀ'],
].map(([family, text]) => document.fonts.load(`600 30px "${family}"`, text)));
await document.fonts.ready;

// ─── Layout passes: what flexbox would have settled in the app ──────────
// Ask: the chat area runs from under the header to above the save bar.
for (const [areaSel, scrSel] of [['#ask-area', '#scr-ask'], ['#v-area', '#scr-voice']]) {
  const scr = $(scrSel);
  const top = $('.sb-fill', scr).offsetHeight + $('.v4-bar', scr).offsetHeight;
  Object.assign($(areaSel).style, { top: `${top}px`, bottom: `${$('.ask-bottom', scr).offsetHeight + 84}px` });
}
$('#tag-scroll').style.top = `${$('#scr-tag .sb-fill').offsetHeight + $('#scr-tag .v4-bar').offsetHeight}px`;

// The family tree opens scrolled to centre your own card (family-tree.tsx).
{
  const canvas = $('#tree-canvas');
  const content = $('#tree-content');
  const c = canvas.getBoundingClientRect();
  const me = $('#tc-me').getBoundingClientRect();
  const cx = me.left + me.width / 2 - c.left - canvas.clientLeft;
  const max = Math.max(0, content.offsetWidth - canvas.clientWidth);
  const scrollX = Math.min(max, Math.max(0, cx - canvas.clientWidth / 2));
  content.style.transform = `translateX(${-scrollX}px)`;
}

// Upload's text-extracted row is shorter than the progress card it replaces;
// taps are measured in the layout they happen in, after reading.
const ocrSlot = $('.ocr-slot');
ocrSlot.style.height = `${$('#ocr-done').offsetHeight}px`;

// A long question scrolls the input sideways to keep the caret in view.
function inputOverflow(lineSel, text) {
  const line = $(lineSel);
  const typed = line.firstElementChild;
  const before = typed.textContent;
  typed.textContent = text;
  const over = line.offsetWidth - line.parentElement.clientWidth + 6;
  const frac = line.parentElement.clientWidth / line.offsetWidth;
  typed.textContent = before;
  return { over: Math.max(0, over), frac: Math.min(1, frac) };
}
const Q1 = "What is Papa's health insurance policy number?";
const VQ = 'पापा की हेल्थ इंश्योरेंस का पॉलिसी नंबर क्या है?';
const OV = { q1: inputOverflow('#ask-line', Q1), vq: inputOverflow('#v-line', VQ) };

// ─── Measure tap targets before anything is transformed ─────────────────
const screenEl = $('#screen');
function at(el) {
  if (typeof el === 'string') el = $(el);
  const s = screenEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const k = 390 / s.width;
  return { x: (r.left - s.left + r.width / 2) * k, y: (r.top - s.top + r.height / 2) * k, top: (r.top - s.top) * k, h: r.height * k };
}
const P = {
  gmail: at('#up-gmail'), gmFind: at('#gm-find'), gmImport: at('#gm-import'),
  scan: at('#up-scan'), shutter: at('#cam-shutter'), papa: at('#p-papa'), health: at('#c-6'), save: at('#save-btn'),
  whoTitle: at($$('#tag-inner .up-h')[0]), catTitle: at($$('#tag-inner .up-h')[1]), tagTop: at('#tag-inner'),
  askInput: at($('#ask-typed').closest('.ask-inputbox')), askSend: at('#ask-send-on'), askSave: at('#ask-save'),
  mic: at('#v-mic'), vTabHome: at('#v-tab-home'), homeAvatar: at('#home-avatar'), drTree: at('#dr-tree'),
  tcPapa: at('#tc-papa'), ppOpen: at('#pp-open'), pn1: at('#pn1'),
};
const tagView = $('#tag-scroll').offsetHeight;
const tagMax = $('#tag-inner').offsetHeight - tagView;
ocrSlot.style.height = '';
const moreH = { ln1: $('#ln1-more1').offsetHeight };

// Gmail import: the scan card takes the height of whichever state it shows.
const gmH = Object.fromEntries(['idle', 'scanning', 'done'].map((k) => [k, $(`#gm-${k}`).offsetHeight + 32]));
// Scrolls that bring what matters into view, never past the end.
const scrollTo = (innerSel, viewSel, targetSel, margin) => {
  const inner = $(innerSel);
  const max = inner.offsetHeight - $(viewSel).offsetHeight;
  const target = $(targetSel).getBoundingClientRect().top - inner.getBoundingClientRect().top;
  return Math.max(0, Math.min(max, target - margin));
};
const gmScroll = (() => {
  // The list is laid out with the card in its finished state.
  const card = $('.gm-card');
  card.style.height = `${gmH.done}px`;
  const v = scrollTo('#gm-inner', '.gm-scroll', '.gm-group', 12);
  card.style.height = '';
  return v;
})();
const emScroll = scrollTo('#em-inner', '.em-scroll', '#em-ins', 150);

// Chat bubbles are placed absolutely, in order, the way the ScrollView lays
// them out; scrolling to the newest one is then a tween of the stack.
function layoutChat(areaSel, groups) {
  const area = $(areaSel);
  const slots = {};
  let y = 16;
  for (const group of groups) {
    for (const id of group) {
      const el = $(`#${id}`);
      el.style.top = `${y}px`;
      slots[id] = { top: y, h: el.offsetHeight };
    }
    y += slots[group[group.length - 1]].h + 16;
  }
  const areaH = area.offsetHeight;
  return (id) => Math.max(0, slots[id].top + slots[id].h + 8 - areaH);
}
layoutChat('#ask-area', [['ask-q1'], ['ask-l1', 'ask-a1']]);
const vScroll = layoutChat('#v-area', [['v-q1'], ['v-l1', 'v-a1']]);

// ─── Initial state ───────────────────────────────────────────────────────
const place = (el, [x, y, s = 1], extra = {}) => gsap.set(el, { xPercent: -50, yPercent: -50, x, y, scale: s, ...extra });

gsap.set('#bg-day', { autoAlpha: 0, clipPath: 'circle(0% at 50% 50%)' });
gsap.set(['#vignette'], { autoAlpha: 1 });
gsap.set('#fade', { autoAlpha: 1 });
gsap.set($$('#texts > *'), { autoAlpha: 0 });
gsap.set($$('#texts .wi'), { yPercent: 118 });
gsap.set($$('.wh-how'), { autoAlpha: 0 });
gsap.set($$('.lang, .langs-note'), { autoAlpha: 0 });
gsap.set(['#tc1', '#tc2', '#tc3', '#tc4'], { autoAlpha: 0 });
gsap.set($$('.cap-line'), { autoAlpha: 0 });
gsap.set($$('.subline'), { autoAlpha: 0 });
gsap.set($$('.callout, #wave'), { autoAlpha: 0 });
gsap.set($$('.scr'), { autoAlpha: 0 });
gsap.set('#scr-lock', { autoAlpha: 1 });
gsap.set(['#touch', '#shutter'], { autoAlpha: 0 });
gsap.set('#hb-dark', { autoAlpha: 0 });
gsap.set(['#ln1', '#ln2', '#pn1', '#pn2'], { autoAlpha: 0 });
gsap.set('#ln1-more1', { height: 0, autoAlpha: 0 });
gsap.set('#ocr-done', { autoAlpha: 0 });
gsap.set('.gm-card', { height: gmH.idle });
gsap.set('#drawer', { autoAlpha: 0 });
gsap.set('#drawer-dim', { opacity: 0 });
gsap.set('#drawer-panel', { x: -330 });
gsap.set($$('.msg'), { autoAlpha: 0 });
gsap.set('#sc-count', { autoAlpha: 0 });
gsap.set('#call-missed', { autoAlpha: 0 });
gsap.set($$('.call-av .ring'), { autoAlpha: 0 });
gsap.set('#cam-scan', { autoAlpha: 0 });
place('#phone', L.hookPhone, { autoAlpha: 0 });
for (const [name, pos] of Object.entries(L.cards)) place(`#sc-${name}`, [pos[0], pos[1]], { rotation: pos[2], autoAlpha: 0 });
// In 9:16 a callout sits where its scene's paragraph was: centred, top-aligned
// with the paragraph, which fades out as the callout arrives.
function stageTop(el) {
  let y = 0;
  for (let n = el; n && n !== stage; n = n.offsetParent) y += n.offsetTop;
  return y;
}
function bandPos(id, el, s) {
  const top = stageTop($('.sub', $(`#${id}`))) + 6;
  return [W / 2, top + (el.offsetHeight * s) / 2, s];
}
// 9:16: the language cards take the paragraph's place, like a callout.
if (PORTRAIT) {
  const h1 = $('#t-voice .wh-how .h1');
  $('#langs').style.top = `${h1.offsetTop + h1.offsetHeight + 18}px`;
}
const CALLOUTS = { 'co-gmail': 'coGmail', 'co-scan': 'coScan', 'co-tree': 'coTree', 'co-alerts': 'coAlerts', wave: 'wave' };
for (const [id, key] of Object.entries(CALLOUTS)) {
  const el = $(`#${id}`);
  if (L[key]) place(el, typeof L[key] === 'string' ? bandPos(L[key], el, L.coScale) : L[key]);
}

// ─── Timeline helpers ────────────────────────────────────────────────────
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out', duration: 0.6 } });
const cues = [];
const cue = (t, type, extra = {}) => cues.push({ t: Math.round(t * 1000) / 1000, type, ...extra });
const IR = { immediateRender: false };

function showCallout(sel, t) {
  const d = PORTRAIT ? { y: 30 } : { x: 36 };
  const from = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, `+=${v}`]));
  const to = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, `-=${v}`]));
  if (PORTRAIT) tl.to(`#${L[CALLOUTS[sel.slice(1)]]} .sub`, { autoAlpha: 0, duration: 0.3, ease: 'none' }, t - 0.1);
  tl.fromTo(sel, { autoAlpha: 0, ...from }, { autoAlpha: 1, ...to, duration: 0.7, ...IR }, t);
  cue(t + 0.05, 'pop');
}
function reveal(container, t, { stagger = 0.055, dur = 0.95 } = {}) {
  const el = typeof container === 'string' ? $(container) : container;
  tl.set(el, { autoAlpha: 1 }, t);
  tl.fromTo($$('.wi', el), { yPercent: 118 }, { yPercent: 0, duration: dur, ease: 'power4.out', stagger, ...IR }, t);
}
// A feature scene opens on why it exists: read first, bigger and centred...
function whyLift(b) {
  const why = $('.wh-why', b);
  const group = [$('.kicker', b), why];
  // In 9:16 the phone sits under the band, so only Privacy (no phone) moves.
  if (PORTRAIT && b.id !== 't-trust') return { why, group, dy: 0, s: 1 };
  const top = stageTop(group[0]);
  const bottom = stageTop(why) + why.offsetHeight;
  return { why, group, dy: Math.max(0, H / 2 - (top + bottom) / 2), s: PORTRAIT ? 1 : 1.18 };
}
function showWhy(id, t) {
  const b = $(`#${id}`);
  const { why, group, dy, s } = whyLift(b);
  tl.set(b, { autoAlpha: 1, y: 0 }, t);
  tl.set(group, { y: dy }, t);
  tl.set(why, { scale: s, transformOrigin: '0% 0%', opacity: 1 }, t);
  tl.fromTo(group[0], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ...IR }, t);
  tl.fromTo($('.wh-tag', why), { autoAlpha: 0, x: -12 }, { autoAlpha: 1, x: 0, duration: 0.45, ...IR }, t + 0.1);
  tl.fromTo($$('.wi', why), { yPercent: 118 }, { yPercent: 0, duration: 0.9, ease: 'power4.out', stagger: 0.035, ...IR }, t + 0.2);
}
// ...then how FamilyVault answers it. The why moves up into its place and
// stays, quieter, above the how; in 9:16 the how takes its place instead.
function showHow(id, t) {
  const b = $(`#${id}`);
  const { why, group, dy } = whyLift(b);
  if (PORTRAIT && !dy) tl.to(why, { autoAlpha: 0, y: -20, duration: 0.35, ease: 'power2.in' }, t - 0.05);
  else {
    tl.to(group, { y: 0, duration: 0.7, ease: 'power3.inOut' }, t - 0.4);
    tl.to(why, { scale: 1, opacity: PORTRAIT ? 0 : 0.6, duration: 0.7, ease: 'power3.inOut' }, t - 0.4);
  }
  const lag = PORTRAIT ? 0.25 : 0;
  tl.set($('.wh-how', b), { autoAlpha: 1 }, t);
  tl.fromTo($('.wh-how .wh-tag', b), { autoAlpha: 0, x: -12 }, { autoAlpha: 1, x: 0, duration: 0.45, ...IR }, t + lag);
  tl.fromTo($$('.wh-how .h1 .wi', b), { yPercent: 118 }, { yPercent: 0, duration: 0.95, ease: 'power4.out', stagger: 0.06, ...IR }, t + lag + 0.1);
  const s = $('.wh-how .sub', b);
  if (s) tl.fromTo(s, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8, ...IR }, t + lag + 0.5);
  cue(t + lag + 0.1, 'pop-soft');
}
const hide = (sel, t, extra = {}) => tl.to(sel, { autoAlpha: 0, y: -24, duration: 0.45, ease: 'power2.in', ...extra }, t);
const fadeIn = (sel, t, extra = {}) => tl.fromTo(sel, { autoAlpha: 0, y: extra.from ?? 12 }, { autoAlpha: 1, y: 0, duration: 0.4, ...IR, ...extra, from: undefined }, t);
const swap = (a, b, t, dur = 0.18) => { tl.to(a, { autoAlpha: 0, duration: dur, ease: 'none' }, t); tl.to(b, { autoAlpha: 1, duration: dur, ease: 'none' }, t); };

let z = 1;
function nav(from, to, t, how = 'push', dur = 0.45) {
  const a = $(`#${from}`);
  const b = $(`#${to}`);
  tl.set(b, { zIndex: ++z, autoAlpha: 1, xPercent: 0, yPercent: 0, scale: 1 }, t);
  if (how === 'push') {
    tl.fromTo(b, { xPercent: 100 }, { xPercent: 0, duration: dur, ease: 'power3.inOut', ...IR }, t);
    tl.to(a, { xPercent: -28, duration: dur, ease: 'power3.inOut' }, t);
  } else if (how === 'back') {
    // Back: the screen in front slides away and uncovers the one behind it.
    tl.set(a, { zIndex: ++z }, t);
    tl.fromTo(b, { xPercent: -28 }, { xPercent: 0, duration: dur, ease: 'power3.inOut', ...IR }, t);
    tl.to(a, { xPercent: 100, duration: dur, ease: 'power3.inOut' }, t);
  } else if (how === 'zoom') {
    tl.fromTo(b, { scale: 0.92, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: dur, ease: 'power2.out', ...IR }, t);
  } else {
    tl.fromTo(b, { autoAlpha: 0 }, { autoAlpha: 1, duration: dur, ease: 'power1.inOut', ...IR }, t);
  }
  tl.set(a, { autoAlpha: 0, xPercent: 0 }, t + dur);
}
// The status bar is white throughout: over the night wallpaper, the camera,
// and the theme-colour strip the web app paints. The gesture bar follows the
// bottom of the screen: dark over the app, light over the system's own screens.
function chrome(t, mode, time) {
  const app = mode === 'app';
  tl.to('#hb-light', { autoAlpha: app ? 0 : 1, duration: 0.2, ease: 'none' }, t);
  tl.to('#hb-dark', { autoAlpha: app ? 1 : 0, duration: 0.2, ease: 'none' }, t);
  if (time) tl.set('.sb-time', { text: time }, t);
}
function tap(t, p, { scroll = 0, press } = {}) {
  tl.set('#touch', { x: p.x, y: p.y - scroll }, t - 0.2);
  tl.fromTo('#touch', { autoAlpha: 0, scale: 1.6 }, { autoAlpha: 1, scale: 1, duration: 0.18, ease: 'power2.out', ...IR }, t - 0.2);
  tl.to('#touch', { scale: 0.8, duration: 0.08, ease: 'power1.in' }, t - 0.02);
  tl.to('#touch', { autoAlpha: 0, scale: 1.3, duration: 0.32, ease: 'power2.out' }, t + 0.08);
  if (press) {
    tl.to(press, { opacity: 0.72, duration: 0.07, ease: 'none' }, t - 0.02);
    tl.to(press, { opacity: 1, duration: 0.25, ease: 'none' }, t + 0.1);
  }
  cue(t, 'tap');
}
function type(sel, text, t, dur, delimiter = '') {
  tl.to(sel, { text: { value: text, delimiter }, duration: dur, ease: 'none' }, t);
  cue(t, 'typing', { dur, n: delimiter ? text.split(delimiter).length : text.length });
}
function vibrate(t) {
  tl.to('.shell', { x: 3.5, duration: 0.035, yoyo: true, repeat: 11, ease: 'sine.inOut' }, t);
  cue(t, 'buzz');
}
function phoneTo(t, [x, y, s], dur = 0.9, extra = {}) {
  tl.to('#phone', { x, y, scale: s, duration: dur, ease: 'power3.inOut', ...extra }, t);
}
function phoneIn(t) {
  tl.fromTo('#phone', { autoAlpha: 0, x: L.dayPhone[0] + (PORTRAIT ? 0 : 260), y: L.dayPhone[1] + (PORTRAIT ? 260 : 0), scale: L.dayPhone[2], rotation: PORTRAIT ? 0 : 6 },
    { autoAlpha: 1, x: L.dayPhone[0], y: L.dayPhone[1], rotation: 0, duration: 1.0, ...IR }, t);
  cue(t, 'whoosh-soft');
}
function popCard(sel, t) {
  tl.fromTo(sel, { autoAlpha: 0, scale: 0.82, y: '+=46' }, { autoAlpha: 1, scale: 1, y: '-=46', duration: 0.6, ease: 'back.out(1.5)', ...IR }, t);
  cue(t, 'pop');
}
function sub(id, t0, t1) {
  tl.fromTo(`#${id}`, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3, ...IR }, t0);
  tl.to(`#${id}`, { autoAlpha: 0, duration: 0.25, ease: 'none' }, t1);
}
// A number on screen that counts up, driven by the playhead so it survives seeking.
function count(t, dur, draw) {
  const o = { v: 0 };
  tl.fromTo(o, { v: 0 }, { v: 1, duration: dur, ease: 'power1.inOut', ...IR, onUpdate: () => draw(o.v) }, t);
}

// Continuous motion, driven by the playhead so it survives seeking.
const motion = { t: 0, amp: 0 };
const bars = $$('#wave i');
function renderMotion() {
  const t = motion.t;
  bars.forEach((b, i) => {
    const n = Math.abs(Math.sin(t * 9.1 + i * 0.83) * 0.6 + Math.sin(t * 13.7 + i * 1.91) * 0.4);
    const env = 0.55 + 0.45 * Math.sin(Math.PI * (i + 0.5) / bars.length);
    b.style.transform = `scaleY(${0.06 + motion.amp * n * env * 0.94})`;
  });
}

// ═════════════════════════════════════════════════════════════════════════
// SCENES
// ═════════════════════════════════════════════════════════════════════════
const S = {};

// ─── 1. 2:14 AM ──────────────────────────────────────────────────────────
S.hook = 0;
cue(0, 'section', { name: 'night' });
tl.to('#fade', { autoAlpha: 0, duration: 1.2, ease: 'power1.inOut' }, 0);
tl.fromTo('#phone', { autoAlpha: 0, y: `+=70`, scale: L.hookPhone[2] * 0.94 },
  { autoAlpha: 1, y: L.hookPhone[1], scale: L.hookPhone[2], duration: 1.4, ...IR }, 0.25);
chrome(0, 'os', '2:14');
tl.set('#t-hook', { autoAlpha: 1 }, 0.5);
tl.fromTo('#t-hook .clock-big', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 1.1, ...IR }, 0.5);
tl.fromTo('#t-hook .where', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 1.0, ...IR }, 1.0);
vibrate(1.45);
tl.fromTo('#ln1', { autoAlpha: 0, y: -26, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)', ...IR }, 1.5);
cue(1.5, 'notif');
sub('sub-1', 1.85, 3.45);
vibrate(3.25);
tl.to('#ln1-more1', { height: moreH.ln1, autoAlpha: 1, duration: 0.45, ease: 'power3.out' }, 3.3);
cue(3.3, 'notif');
sub('sub-2', 3.55, 6.05);
tl.to('#phone', { autoAlpha: 0, scale: L.hookPhone[2] * 0.9, y: '+=40', duration: 0.6, ease: 'power2.in' }, 6.25);
hide('#t-hook', 6.2, { x: -30, y: 0 });

// ─── 2. The scramble ─────────────────────────────────────────────────────
S.scramble = 6.9;
{
  const t0 = S.scramble;
  tl.set('#caps', { autoAlpha: 1 }, t0);
  fadeIn('#time-chip', t0, { from: -10 });
  const all = [
    ['cap1', '#sc-mail', '2:16 AM'], ['cap2', '#sc-work', '2:19 AM'], ['cap3', '#sc-pdf', '2:23 AM'],
    ['cap4', '#sc-otp', '2:26 AM'], ['cap5', '#sc-note', '2:31 AM'],
  ];
  const beats = SHORT ? [all[0], all[2], all[4]] : all;
  const step = SHORT ? 1.7 : 1.85;
  beats.forEach(([cap, card, time], i) => {
    const t = t0 + 0.15 + i * step;
    if (i > 0) {
      tl.set('#chip-time', { text: time }, t);
      tl.fromTo('#time-chip', { scale: 1.12 }, { scale: 1, duration: 0.4, ...IR }, t);
      cue(t, 'tick');
      // Earlier cards fall back as the pile grows.
      tl.to(beats.slice(0, i).map((b) => b[1]), { opacity: 0.55, duration: 0.5, ease: 'power1.out' }, t);
    }
    reveal(`#${cap}`, t);
    popCard(card, t + 0.05);
    tl.to(`#${cap}`, { autoAlpha: 0, duration: 0.3, ease: 'power1.in' }, t + step - 0.3);
  });
  type('#sc-q', 'policy number', t0 + 0.55, 0.85);
  tl.to('#sc-caret', { autoAlpha: 0, duration: 0.01 }, t0 + 1.5);
  fadeIn('#sc-count', t0 + 1.55, { from: 4 });
  const pdfAt = t0 + 0.15 + beats.findIndex((b) => b[1] === '#sc-pdf') * step + 0.75;
  tl.fromTo('#sc-pwd', { x: 0 }, { x: 9, duration: 0.05, yoyo: true, repeat: 7, ease: 'sine.inOut', ...IR }, pdfAt);
  cue(pdfAt, 'error');
  const out = t0 + 0.15 + beats.length * step;
  tl.to(['#sc-mail', '#sc-work', '#sc-pdf', '#sc-otp', '#sc-note'], {
    autoAlpha: 0, y: '+=160', rotation: (i) => [-8, 7, -5, 9, -10][i], duration: 0.55, ease: 'power2.in', stagger: 0.04,
  }, out - 0.2);
  hide('#time-chip', out - 0.2);
  S.insight = out + 0.45;
}

// ─── 3. The insight, the number, the call nobody answers ────────────────
{
  const t0 = S.insight;
  tl.set('#t-insight', { autoAlpha: 1 }, t0);
  reveal('#ins-1', t0 + 0.05);
  reveal('#ins-2', t0 + 1.45, { stagger: 0.09, dur: 1.1 });
  cue(t0 + 1.45, 'hit');
  hide('#t-insight', t0 + 3.2);

  const s0 = t0 + 3.75;
  S.stat = s0;
  const stat = { v: 0 };
  if (!SHORT) {
    tl.set('#t-stat', { autoAlpha: 1, y: 0 }, s0);
    tl.fromTo('#stat-num', { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.8, ...IR }, s0);
    tl.fromTo(stat, { v: 0 }, {
      v: 1.84, duration: 1.3, ease: 'power2.out', ...IR,
      onUpdate: () => { $('#stat-val').textContent = stat.v.toFixed(2); },
    }, s0);
    fadeIn('#stat-line', s0 + 0.7, { from: 18, duration: 0.7 });
    fadeIn('#stat-src', s0 + 1.2, { from: 8, duration: 0.6 });
    hide('#t-stat', s0 + 3.75);
  }

  const c0 = SHORT ? s0 : s0 + 4.25;
  S.call = c0;
  tl.set('#scr-call', { autoAlpha: 1, zIndex: ++z }, c0);
  tl.set('#scr-lock', { autoAlpha: 0 }, c0);
  chrome(c0, 'os', '2:14');
  tl.fromTo('#phone', { autoAlpha: 0, x: L.callPhone[0], y: L.callPhone[1] + 40, scale: L.callPhone[2] * 0.95 },
    { autoAlpha: 1, x: L.callPhone[0], y: L.callPhone[1], scale: L.callPhone[2], duration: 0.9, ...IR }, c0);
  [0, 1, 2].forEach((i) => {
    tl.fromTo(`#ring${i + 1}`, { autoAlpha: 0.7, scale: 1 }, { autoAlpha: 0, scale: 2.1, duration: 1.5, ease: 'power1.out', repeat: 1, ...IR }, c0 + 0.2 + i * 0.5);
  });
  cue(c0 + 0.25, 'ring');
  cue(c0 + 1.65, 'ring');
  vibrate(c0 + 0.25);
  vibrate(c0 + 1.65);
  tl.set('#t-question', { autoAlpha: 1 }, c0 + 0.35);
  reveal('#t-question .big', c0 + 0.35, { stagger: 0.07 });
  tl.to('#call-actions', { autoAlpha: 0, y: 20, duration: 0.3 }, c0 + 3.1);
  tl.to('#call-label', { text: 'Call ended', duration: 0.01 }, c0 + 3.1);
  fadeIn('#call-missed', c0 + 3.2, { from: 6 });
  cue(c0 + 3.15, 'ring-stop');
  tl.to('#fade', { autoAlpha: 1, duration: 0.7, ease: 'power1.in' }, c0 + 4.0);
  tl.set(['#t-question', '#phone'], { autoAlpha: 0 }, c0 + 4.7);
  S.reveal = c0 + 4.75;
}

// ─── 4. FamilyVault ──────────────────────────────────────────────────────
{
  const t0 = S.reveal;
  cue(t0, 'section', { name: 'reveal' });
  cue(t0, 'whoosh');
  tl.set('#vignette', { autoAlpha: 0 }, t0);
  tl.set('#bg-day', { autoAlpha: 1 }, t0);
  tl.to('#fade', { autoAlpha: 0, duration: 0.25, ease: 'none' }, t0);
  tl.to('#bg-day', { clipPath: 'circle(80% at 50% 50%)', duration: 1.1, ease: 'power3.inOut' }, t0);
  tl.set('#brand', { autoAlpha: 1 }, t0 + 0.3);
  tl.fromTo('#logo', { scale: 0.4, rotation: -14, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 1.0, ease: 'back.out(1.7)', ...IR }, t0 + 0.35);
  cue(t0 + 0.4, 'pop');
  tl.fromTo('#wordmark', { clipPath: 'inset(0% 100% 0% 0%)', y: 12 }, { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: 0.8, ease: 'power3.out', ...IR }, t0 + 0.85);
  fadeIn('#tagline', t0 + 1.5, { from: 16, duration: 0.7 });
  hide('#brand', t0 + (SHORT ? 2.8 : 3.9), { y: -40 });
  S.gmail = t0 + (SHORT ? 3.25 : 4.4);
}

// ─── 5. Import from Gmail ────────────────────────────────────────────────
// Each feature scene opens on its why while the phone gets into place, and
// shows its how as the app does the work.
{
  const t0 = S.gmail;
  // The short cut runs the same steps a little faster.
  const k = SHORT ? { open: 1.2, find: 2.15, scan: 1.1, scroll: 0.45, imp: 1.35, row: 0.22, out: 0.95 }
    : { open: 1.3, find: 2.35, scan: 1.45, scroll: 0.6, imp: 1.75, row: 0.3, out: 1.2 };
  const d = t0 + 0.8;
  cue(t0, 'section', { name: 'day' });
  showWhy('t-gmail', t0);
  tl.set('#scr-upload', { autoAlpha: 1, zIndex: ++z }, t0);
  tl.set(['#scr-call', '#scr-lock'], { autoAlpha: 0 }, t0);
  chrome(t0, 'app', '9:41');
  phoneIn(t0 + 0.05);
  tap(d + k.open, P.gmail, { press: '#up-gmail' });
  nav('scr-upload', 'scr-gmail', d + k.open + 0.15, 'push');
  showHow('t-gmail', d + k.open + 0.1);
  tap(d + k.find, P.gmFind, { press: '#gm-find' });
  swap('#gm-idle', '#gm-scanning', d + k.find + 0.05, 0.2);
  tl.to('.gm-card', { height: gmH.scanning, duration: 0.3, ease: 'power2.out' }, d + k.find + 0.05);
  count(d + k.find + 0.1, k.scan, (v) => { $('#gm-count').textContent = `${Math.round(412 * v)} checked, ${Math.floor(10 * v ** 1.15 + 0.0001)} found`; });
  cue(d + k.find + 0.1, 'process', { dur: k.scan });
  showCallout('#co-gmail', d + k.find + 0.35);
  tl.fromTo($$('#co-gmail .co-check'), { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.14, ...IR }, d + k.find + 0.55);
  const d0 = d + k.find + 0.15 + k.scan;
  swap('#gm-scanning', '#gm-done', d0, 0.2);
  tl.to('.gm-card', { height: gmH.done, duration: 0.3, ease: 'power2.out' }, d0);
  fadeIn('#gm-list', d0 + 0.05, { from: 10, duration: 0.4 });
  fadeIn('#gm-footer', d0 + 0.1, { from: 20, duration: 0.4 });
  cue(d0 + 0.05, 'ding');
  tl.to('#gm-inner', { y: -gmScroll, duration: SHORT ? 0.7 : 0.8, ease: 'power2.inOut' }, d0 + k.scroll);
  const i0 = d0 + k.imp;
  tap(i0, P.gmImport, { press: '#gm-import' });
  tl.to('#gm-busy', { autoAlpha: 1, duration: 0.12, ease: 'none' }, i0 + 0.02);
  tl.to('#gm-import', { opacity: 0.8, duration: 0.12, ease: 'none' }, i0 + 0.3);
  ['gm-r1', 'gm-r2', 'gm-r3', 'gm-r4', 'gm-r5'].forEach((id, i) => {
    const t = i0 + 0.35 + i * k.row;
    if (i < 4) tl.set('#gm-busy-label', { text: `Importing ${i + 2} of 5…` }, t + 0.02);
    swap(`#${id} .gm-on`, `#${id} .gm-ok`, t, 0.12);
    swap(`#${id} .gm-why`, `#${id} .gm-imported`, t, 0.12);
  });
  cue(i0 + 0.35, 'process', { dur: 5 * k.row - 0.1 });
  const done = i0 + 0.35 + 5 * k.row;
  tl.to('#gm-footer', { autoAlpha: 0, y: 24, duration: 0.3, ease: 'power2.in' }, done);
  cue(done + 0.05, 'success');
  hide('#t-gmail', done + k.out - 0.45);
  hide('#co-gmail', done + k.out - 0.55, { y: '-=20' });
  S.scan = done + k.out;
}

// ─── 6. Scan the paper ones ──────────────────────────────────────────────
S.ask = S.scan;
if (!SHORT) {
  const t0 = S.scan;
  const d = t0 + 1.0;
  showWhy('t-scan', t0);
  nav('scr-gmail', 'scr-upload', t0, 'back', 0.4);
  tap(d + 1.0, P.scan, { press: '#up-scan' });
  nav('scr-upload', 'scr-camera', d + 1.15, 'zoom', 0.4);
  showHow('t-scan', d + 1.1);
  chrome(d + 1.15, 'os');
  tl.fromTo('#cam-guides', { scale: 1.08, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ...IR }, d + 1.5);
  tl.set('#cam-scan', { autoAlpha: 1 }, d + 1.7);
  tl.fromTo('#cam-scan', { y: 0 }, { y: 440, duration: 1.0, ease: 'power1.inOut', ...IR }, d + 1.7);
  tl.set('#cam-scan', { autoAlpha: 0 }, d + 2.7);
  cue(d + 1.7, 'scan', { dur: 1.0 });
  tap(d + 2.9, P.shutter, { press: '#cam-shutter' });
  tl.fromTo('#shutter', { autoAlpha: 0 }, { autoAlpha: 0.95, duration: 0.06, ease: 'none', ...IR }, d + 2.92);
  tl.to('#shutter', { autoAlpha: 0, duration: 0.35, ease: 'power1.out' }, d + 3.0);
  cue(d + 2.92, 'shutter');
  nav('scr-camera', 'scr-tag', d + 3.25, 'fade', 0.35);
  chrome(d + 3.25, 'app');
  tl.fromTo('#ocr-fill', { scaleX: 0 }, { scaleX: 1, duration: 1.55, ease: 'power1.inOut', ...IR }, d + 3.5);
  cue(d + 3.5, 'process', { dur: 1.55 });
  const r0 = d + 5.1;
  tl.to('#ocr-card', { autoAlpha: 0, duration: 0.2, ease: 'none' }, r0);
  fadeIn('#ocr-done', r0, { from: 4, duration: 0.3 });
  tl.to(ocrSlot, { height: $('#ocr-done').offsetHeight, duration: 0.3, ease: 'power2.out' }, r0);
  cue(r0 + 0.05, 'ding');
  showCallout('#co-scan', r0 + 0.2);
  tl.fromTo($$('#co-scan .co-row, #co-scan .co-foot'), { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.12, ...IR }, r0 + 0.4);
  // Scrolls are measured in the after-reading layout, like the taps.
  const scroll1 = Math.min(tagMax, P.whoTitle.top - P.tagTop.top - 12);
  const scroll2 = Math.min(tagMax, P.catTitle.top - P.tagTop.top - 12);
  // The Save button may still be below the fold once the categories are in view.
  const scroll3 = Math.max(scroll2, Math.min(tagMax, P.save.top + P.save.h + 16 - (P.tagTop.top + tagView)));
  tl.to('#tag-inner', { y: -scroll1, duration: 0.65, ease: 'power2.inOut' }, r0 + 0.75);
  tap(r0 + 1.6, P.papa, { scroll: scroll1 });
  swap('#p-me-sel', '#p-papa-sel', r0 + 1.61, 0.16);
  tl.to('#tag-inner', { y: -scroll2, duration: 0.6, ease: 'power2.inOut' }, r0 + 2.0);
  tap(r0 + 2.8, P.health, { scroll: scroll2 });
  swap('#c-0-sel', '#c-6-sel', r0 + 2.81, 0.16);
  if (scroll3 > scroll2 + 2) tl.to('#tag-inner', { y: -scroll3, duration: 0.45, ease: 'power2.inOut' }, r0 + 3.05);
  tap(r0 + 3.55, P.save, { scroll: scroll3 });
  tl.to('#save-busy', { autoAlpha: 1, duration: 0.12, ease: 'none' }, r0 + 3.57);
  tl.to('#save-btn', { opacity: 0.7, duration: 0.12, ease: 'none' }, r0 + 3.6);
  // The upload is done when the dialog opens: the button is itself again.
  tl.set('#save-busy', { autoAlpha: 0 }, r0 + 4.2);
  tl.set('#save-btn', { opacity: 1 }, r0 + 4.2);
  tl.fromTo('#up-dialog', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: 'none', ...IR }, r0 + 4.2);
  tl.fromTo('#up-dialog-box', { scale: 0.92 }, { scale: 1, duration: 0.35, ease: 'power2.out', ...IR }, r0 + 4.2);
  cue(r0 + 4.25, 'success');
  hide('#t-scan', r0 + 4.95);
  hide('#co-scan', r0 + 4.85, { y: '-=20' });
  S.ask = r0 + 5.4;
}

// ─── 7. Ask ──────────────────────────────────────────────────────────────
{
  const t0 = S.ask;
  const d = t0 + 1.4;
  // Typing, sending, the answer: a touch quicker in the short cut.
  const k = SHORT ? { type: 1.6, think: 1.25 } : { type: 1.9, think: 1.4 };
  const sent = d + 0.9 + k.type + 0.3;
  const ans = sent + 0.25 + k.think;
  showWhy('t-ask', t0);
  nav(SHORT ? 'scr-gmail' : 'scr-tag', 'scr-ask', t0, 'fade', 0.4);
  showHow('t-ask', d + 0.6);
  tap(d + 0.75, P.askInput);
  tl.set('#ask-ph', { autoAlpha: 0 }, d + 0.9);
  tl.set('#ask-caret', { autoAlpha: 1 }, d + 0.8);
  swap('#ask-send-off', '#ask-send-on', d + 0.95, 0.15);
  type('#ask-typed', Q1, d + 0.9, k.type);
  if (OV.q1.over) tl.to('#ask-line', { x: -OV.q1.over, duration: k.type * (1 - OV.q1.frac), ease: 'none' }, d + 0.9 + k.type * OV.q1.frac);
  tap(sent, P.askSend, { press: '#ask-send-on' });
  cue(sent + 0.02, 'send');
  tl.set('#ask-typed', { text: '' }, sent + 0.05);
  tl.set('#ask-line', { x: 0 }, sent + 0.05);
  tl.set('#ask-caret', { autoAlpha: 0 }, sent + 0.05);
  tl.set('#ask-ph', { autoAlpha: 1 }, sent + 0.05);
  swap('#ask-send-on', '#ask-send-off', sent + 0.05, 0.1);
  tl.to('#ask-empty', { autoAlpha: 0, duration: 0.2, ease: 'none' }, sent + 0.05);
  tl.to('#ask-new', { autoAlpha: 1, duration: 0.2, ease: 'none' }, sent + 0.05);
  // The save bar comes with the first message, and wakes once there is an answer.
  tl.set('#ask-save', { opacity: 0.45 }, sent + 0.05);
  tl.to('#ask-savebar', { autoAlpha: 1, duration: 0.2, ease: 'none' }, sent + 0.05);
  fadeIn('#ask-q1', sent + 0.1, { duration: 0.3 });
  fadeIn('#ask-l1', sent + 0.25, { duration: 0.3 });
  tl.to('#ask-l1', { autoAlpha: 0, duration: 0.15, ease: 'none' }, ans);
  fadeIn('#ask-a1', ans, { from: 8, duration: 0.4 });
  tl.to('#ask-save', { opacity: 1, duration: 0.2, ease: 'none' }, ans + 0.05);
  cue(ans, 'answer');
  tl.to('#ask-hl', { backgroundSize: '100% 100%', duration: 0.6, ease: 'power2.inOut' }, ans + 0.6);
  if (SHORT) {
    hide('#t-ask', ans + 1.3);
    S.voice = ans + 1.75;
  } else {
    // Save chat: kept for later behind the clock at the top (saved-chats.tsx).
    tap(ans + 1.55, P.askSave, { press: '#ask-save' });
    tl.to('#ask-saved', { autoAlpha: 1, duration: 0.18, ease: 'none' }, ans + 1.57);
    fadeIn('#ask-savenote', ans + 1.65, { from: 4, duration: 0.3 });
    cue(ans + 1.6, 'ding');
    tl.fromTo('#ask-clock', { scale: 1 }, { scale: 1.22, duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.inOut', ...IR }, ans + 2.15);
    hide('#t-ask', ans + 2.8);
    S.voice = ans + 3.25;
  }
}

// ─── 8. Voice, in every language the app offers ──────────────────────────
{
  const t0 = S.voice;
  const d = t0 + 1.3;
  const langs = $$('#langs .lang');
  showWhy('t-voice', t0);
  nav('scr-ask', 'scr-voice', t0, 'fade', 0.4);
  showHow('t-voice', d + 0.75);
  // The languages, each in its own script: under the paragraph in 16:9, in
  // its place in 9:16, where they stay for the whole demo.
  const l0 = d + (PORTRAIT ? 1.15 : 1.75);
  tl.fromTo(langs, { autoAlpha: 0, y: 14, scale: 0.94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.06, ease: 'back.out(1.6)', ...IR }, l0);
  tl.fromTo('#langs .langs-note', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ...IR }, l0 + 0.7);
  cue(l0, 'pop-soft');
  tap(d + 1.0, P.mic);
  cue(d + 1.0, 'mic-on');
  swap('#mic-idle', '#mic-listen', d + 1.02, 0.15);
  swap('#v-ph-idle', '#v-ph-listen', d + 1.02, 0.15);
  tl.to('#v-icon-on', { autoAlpha: 1, duration: 0.15 }, d + 1.02);
  // 9:16 has no room left for the waveform: the mic's own colours carry it.
  if (!PORTRAIT) {
    tl.to('#wave', { autoAlpha: 1, duration: 0.3 }, d + 1.0);
    tl.to(motion, { amp: 1, duration: 0.4, ease: 'power1.out' }, d + 1.2);
  }
  // Maa asks; the words appear a beat behind her, as a recogniser's do.
  const q0 = d + 1.3;
  const q1 = q0 + VOICES.ask.dur;
  cue(q0, 'voice', { line: 'ask' });
  sub('sub-3', q0, q1 + 0.5);
  const typing = q1 - q0 - 0.2;
  tl.set('#v-ph-listen', { autoAlpha: 0 }, q0 + 0.3);
  type('#v-typed', VQ, q0 + 0.3, typing, ' ');
  if (OV.vq.over) tl.to('#v-line', { x: -OV.vq.over, duration: typing * (1 - OV.vq.frac), ease: 'none' }, q0 + 0.3 + typing * OV.vq.frac);
  if (!PORTRAIT) {
    tl.to(motion, { amp: 0, duration: 0.35, ease: 'power1.in' }, q1);
    tl.to('#wave', { autoAlpha: 0, duration: 0.25 }, q1 + 0.15);
  }
  const think = q1 + 0.4;
  tl.set('#v-typed', { text: '' }, think);
  tl.set('#v-line', { x: 0 }, think);
  swap('#mic-listen', '#mic-think', think, 0.15);
  tl.to('#v-icon-on', { autoAlpha: 0, duration: 0.15 }, think);
  tl.set('#v-ph-think', { autoAlpha: 1 }, think);
  tl.to('#v-empty', { autoAlpha: 0, duration: 0.2, ease: 'none' }, think);
  tl.to('#v-new', { autoAlpha: 1, duration: 0.2, ease: 'none' }, think);
  tl.set('#v-save', { opacity: 0.45 }, think);
  tl.to('#v-savebar', { autoAlpha: 1, duration: 0.2, ease: 'none' }, think);
  fadeIn('#v-q1', think + 0.05, { duration: 0.3 });
  fadeIn('#v-l1', think + 0.2, { duration: 0.3 });
  const ans = think + 1.5;
  tl.to('#v-l1', { autoAlpha: 0, duration: 0.15, ease: 'none' }, ans);
  fadeIn('#v-a1', ans, { from: 8, duration: 0.4 });
  tl.to('#v-save', { opacity: 1, duration: 0.2, ease: 'none' }, ans + 0.05);
  tl.to('#v-stack', { y: -vScroll('v-a1'), duration: 0.45, ease: 'power2.out' }, ans);
  swap('#mic-think', '#mic-speak', ans, 0.15);
  swap('#v-ph-think', '#v-ph-again', ans, 0.15);
  cue(ans, 'answer');
  // The answer, read aloud. The short cut leaves after its first sentence and
  // lets the second carry on over the night scene, on Maa's phone.
  const a0 = ans + 0.35;
  const a2 = a0 + VOICES.answer.sentence2;
  const a1 = SHORT ? a2 - 0.4 : a0 + VOICES.answer.dur;
  cue(a0, 'voice', { line: 'answer', ...(SHORT ? { to: VOICES.answer.sentence2 } : {}) });
  if (!PORTRAIT) {
    tl.to($$('#wave i'), { backgroundColor: '#2F7D5C', duration: 0.2, ease: 'none' }, ans - 0.05);
    tl.to('#wave', { autoAlpha: 1, duration: 0.25 }, ans);
    tl.to(motion, { amp: 0.85, duration: 0.4 }, a0);
  }
  sub('sub-4', a0 + 0.1, SHORT ? a1 + 0.35 : a2 - 0.15);
  if (!SHORT) sub('sub-4b', a2, a1 + 0.35);
  tl.to('#v-hl', { backgroundSize: '100% 100%', duration: 0.6, ease: 'power2.inOut' }, a0 + VOICES.answer.number);
  if (!PORTRAIT) tl.to(motion, { amp: 0, duration: 0.4, ease: 'power1.in' }, a1 - 0.15);
  if (!SHORT) {
    swap('#mic-speak', '#mic-idle', a1 + 0.3, 0.2);
    swap('#v-stop1', '#v-again1', a1 + 0.3, 0.2);
  }
  if (!PORTRAIT) tl.to('#wave', { autoAlpha: 0, duration: 0.3 }, a1 + 0.3);
  // The same, in any of these: a ripple across the languages.
  const ripple = SHORT ? a1 - 0.5 : a1 + 0.45;
  tl.fromTo(langs, { scale: 1 }, { scale: 1.08, duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.inOut', stagger: 0.07, ...IR }, ripple);
  hide('#t-voice', ripple + (SHORT ? 1.1 : 1.5));
  S.tree = ripple + (SHORT ? 1.5 : 1.95);
}

// ─── 9. The family tree ──────────────────────────────────────────────────
if (SHORT) S.res = S.tree;
if (!SHORT) {
  const t0 = S.tree;
  showWhy('t-tree', t0);
  // Home, then the drawer behind your initial, then Family tree.
  tap(t0 + 0.6, P.vTabHome);
  nav('scr-voice', 'scr-home', t0 + 0.7, 'fade', 0.3);
  tap(t0 + 1.75, P.homeAvatar, { press: '#home-avatar' });
  tl.set('#drawer', { autoAlpha: 1 }, t0 + 1.83);
  tl.to('#drawer-dim', { opacity: 1, duration: 0.22, ease: 'power3.out' }, t0 + 1.83);
  tl.to('#drawer-panel', { x: 0, duration: 0.22, ease: 'power3.out' }, t0 + 1.83);
  cue(t0 + 1.83, 'whoosh-soft');
  tap(t0 + 2.75, P.drTree, { press: '#dr-tree' });
  tl.to('#drawer-panel', { x: -330, duration: 0.18, ease: 'power3.in' }, t0 + 2.85);
  tl.to('#drawer-dim', { opacity: 0, duration: 0.18, ease: 'power3.in' }, t0 + 2.85);
  tl.set('#drawer', { autoAlpha: 0 }, t0 + 3.05);
  nav('scr-home', 'scr-tree', t0 + 3.0, 'push');
  showHow('t-tree', t0 + 3.0);
  // Generation by generation, as the cards settle in.
  const gens = [['#tc-dadi'], ['#tc-papa', '#tc-maa'], ['#tc-neha', '#tc-me', '#tc-priya'], ['#tc-aarav']];
  gens.forEach((g, i) => tl.fromTo(g, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4, ...IR }, t0 + 3.3 + i * 0.12));
  tl.fromTo($$('#tree-content .vl, #tree-content .ml, #tree-content .bar'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ...IR }, t0 + 3.45);
  // The ones who never sign in are in it too: Dadi, Neha, Aarav.
  [['#tc-dadi', 4.15], ['#tc-neha', 4.3], ['#tc-aarav', 4.45]].forEach(([card, at]) => {
    tl.fromTo(card, { boxShadow: '0 0 0 0px rgba(42,61,102,0)' }, { boxShadow: '0 0 0 4px rgba(42,61,102,0.28)', duration: 0.3, yoyo: true, repeat: 1, ease: 'sine.inOut', ...IR }, t0 + at);
  });
  showCallout('#co-tree', t0 + 5.0);
  tl.fromTo($$('#co-tree .co-ask, #co-tree .co-quiet'), { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.14, ...IR }, t0 + 5.2);
  // Each relation lights the card it means.
  [['#tc-papa', 5.3], ['#tc-dadi', 5.44]].forEach(([card, at]) => {
    tl.fromTo(card, { boxShadow: '0 0 0 0px rgba(212,128,123,0)' }, { boxShadow: '0 0 0 4px rgba(212,128,123,0.45)', duration: 0.3, yoyo: true, repeat: 1, ease: 'sine.inOut', ...IR }, t0 + at);
  });
  hide('#t-tree', t0 + 7.6);
  hide('#co-tree', t0 + 7.5, { y: '-=20' });
  S.emerg = t0 + 8.05;
}

// ─── 10. The emergency card ──────────────────────────────────────────────
if (!SHORT) {
  const t0 = S.emerg;
  showWhy('t-emerg', t0);
  tap(t0 + 0.8, P.tcPapa, { press: '#tc-papa' });
  nav('scr-tree', 'scr-person', t0 + 0.95, 'push');
  tap(t0 + 2.3, P.ppOpen, { press: '#pp-open' });
  nav('scr-person', 'scr-emerg', t0 + 2.45, 'push');
  showHow('t-emerg', t0 + 2.45);
  tl.to('#em-inner', { y: -emScroll, duration: 1.0, ease: 'power2.inOut' }, t0 + 4.5);
  tl.to('#em-hl', { backgroundSize: '100% 100%', duration: 0.6, ease: 'power2.inOut' }, t0 + 5.45);
  hide('#t-emerg', t0 + 7.2);
  S.alerts = t0 + 7.65;
}

// ─── 11. Reminders ───────────────────────────────────────────────────────
if (!SHORT) {
  const t0 = S.alerts;
  showWhy('t-alerts', t0);
  // The next morning: a reminder reaches the phone, as a web push.
  nav('scr-emerg', 'scr-lockday', t0, 'fade', 0.45);
  chrome(t0, 'os', '9:05');
  vibrate(t0 + 1.6);
  tl.fromTo('#pn1', { autoAlpha: 0, y: -26, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)', ...IR }, t0 + 1.65);
  cue(t0 + 1.65, 'notif');
  showHow('t-alerts', t0 + 1.9);
  vibrate(t0 + 2.35);
  tl.fromTo('#pn2', { autoAlpha: 0, y: -26, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)', ...IR }, t0 + 2.4);
  cue(t0 + 2.4, 'notif');
  showCallout('#co-alerts', t0 + 3.6);
  tl.fromTo('#co-alerts .track', { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: 'power2.inOut', ...IR }, t0 + 3.8);
  tl.fromTo($$('#co-alerts .co-step'), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.16, ...IR }, t0 + 3.8);
  tl.fromTo('#co-alerts .co-foot', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ...IR }, t0 + 4.5);
  // Tapping it opens Notifications (public/sw.js).
  tap(t0 + 5.2, P.pn1, { press: '#pn1' });
  nav('scr-lockday', 'scr-notifs', t0 + 5.35, 'zoom', 0.4);
  chrome(t0 + 5.35, 'app');
  tl.fromTo($$('#nt-list .nt-card'), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.08, ...IR }, t0 + 5.5);
  hide('#t-alerts', t0 + 7.6);
  hide('#co-alerts', t0 + 7.5, { y: '-=20' });
  tl.to('#phone', { autoAlpha: 0, y: `+=60`, duration: 0.55, ease: 'power2.in' }, t0 + 7.6);
  S.trust = t0 + 8.15;
}

// ─── 12. Privacy ─────────────────────────────────────────────────────────
if (!SHORT) {
  const t0 = S.trust;
  const cards = ['#tc1', '#tc2', '#tc3', '#tc4'];
  showWhy('t-trust', t0);
  showHow('t-trust', t0 + 2.2);
  tl.fromTo(cards, { autoAlpha: 0, y: 50 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.14, ...IR }, t0 + 2.75);
  cards.forEach((c, i) => cue(t0 + 2.8 + i * 0.14, 'pop-soft'));
  hide('#t-trust', t0 + 7.0, { y: -30 });
  S.res = t0 + 7.55;
}

// ─── 13. The same night ──────────────────────────────────────────────────
{
  const t0 = S.res;
  cue(t0, 'section', { name: 'night2' });
  tl.to('#bg-day', { autoAlpha: 0, duration: 0.9, ease: 'power1.inOut' }, t0);
  tl.to('#vignette', { autoAlpha: 1, duration: 0.9 }, t0);
  tl.set('#t-res', { autoAlpha: 1, y: 0 }, t0 + 0.4);
  tl.set(['#res-h1b', '#res-sub'], { autoAlpha: 0 }, t0 + 0.4);
  tl.fromTo('#t-res .kicker', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, ...IR }, t0 + 0.4);
  tl.fromTo('#t-res .clock-big', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.8, ...IR }, t0 + 0.45);
  tl.fromTo($$('#res-h1a .wi'), { yPercent: 118 }, { yPercent: 0, duration: 0.95, ease: 'power4.out', stagger: 0.06, ...IR }, t0 + 0.7);
  // Maa's phone: the answer she just got, being read to her.
  tl.set($$('.scr'), { autoAlpha: 0 }, t0 + 0.3);
  tl.set('#scr-voice', { autoAlpha: 1, zIndex: ++z, xPercent: 0 }, t0 + 0.3);
  tl.set(['#mic-idle', '#v-again1'], { autoAlpha: 0 }, t0 + 0.3);
  tl.set(['#mic-speak', '#v-stop1', '#v-ph-again'], { autoAlpha: 1 }, t0 + 0.3);
  chrome(t0 + 0.3, 'app', '2:14');
  if (SHORT) phoneTo(t0, L.resPhone, 1.0);
  else {
    tl.fromTo('#phone', { autoAlpha: 0, x: L.resPhone[0], y: L.resPhone[1] + 50, scale: L.resPhone[2] },
      { autoAlpha: 1, y: L.resPhone[1], duration: 1.0, ...IR }, t0 + 0.4);
  }
  // What Maa hears, from her phone's speaker: the policy number. The short cut
  // heard the number a moment ago, so its reading carries on with the rest.
  const [from, to] = SHORT ? [VOICES.answer.sentence2, VOICES.answer.dur] : [VOICES.answer.number, VOICES.answer.sentence2 - 0.4];
  const r0 = t0 + 1.0;
  const r1 = r0 + to - from;
  cue(r0, 'voice', { line: 'answer', from, to, phone: true });
  sub(SHORT ? 'sub-4b' : 'sub-4', r0 + 0.1, r1 + 0.3);
  if (L.resWave) {
    tl.set('#wave', { x: L.resWave[0], y: L.resWave[1] }, t0);
    tl.set($$('#wave i'), { backgroundColor: '#2F7D5C' }, t0);
    tl.to('#wave', { autoAlpha: 1, duration: 0.4 }, r0 - 0.1);
    tl.to(motion, { amp: 0.8, duration: 0.4 }, r0 - 0.1);
    tl.to(motion, { amp: 0, duration: 0.4 }, r1 - 0.15);
    tl.to('#wave', { autoAlpha: 0, duration: 0.3 }, r1 + 0.15);
  }
  // Rohan's phone, a minute later.
  const m = r1 + 0.45;
  nav('scr-voice', 'scr-lock2', m, 'fade', 0.5);
  chrome(m, 'os', '2:15');
  tl.to('#res-time', { text: '2:15', duration: 0.01 }, m + 0.1);
  tl.fromTo('#t-res .clock-big', { scale: 1.06 }, { scale: 1, duration: 0.5, ...IR }, m + 0.1);
  tl.to('#res-h1a', { autoAlpha: 0, duration: 0.3 }, m + 0.1);
  tl.set('#res-h1b', { autoAlpha: 1 }, m + 0.3);
  tl.fromTo($$('#res-h1b .wi'), { yPercent: 118 }, { yPercent: 0, duration: 0.95, ease: 'power4.out', stagger: 0.06, ...IR }, m + 0.3);
  vibrate(m + 0.65);
  tl.fromTo('#ln2', { autoAlpha: 0, y: -26, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)', ...IR }, m + 0.7);
  cue(m + 0.7, 'notif');
  sub('sub-5', m + 1.0, m + 4.1);
  fadeIn('#res-sub', m + 1.4, { from: 16, duration: 0.7 });
  hide(['#t-res'], m + 4.25);
  tl.to('#phone', { autoAlpha: 0, y: `+=40`, duration: 0.5, ease: 'power2.in' }, m + 4.25);
  S.end = m + 4.8;
}

// ─── 14. End card ────────────────────────────────────────────────────────
{
  const t0 = S.end;
  cue(t0, 'section', { name: 'end' });
  cue(t0, 'whoosh');
  tl.set('#bg-day', { autoAlpha: 1, clipPath: 'circle(0% at 50% 50%)' }, t0);
  tl.to('#bg-day', { clipPath: 'circle(80% at 50% 50%)', duration: 1.1, ease: 'power3.inOut' }, t0);
  tl.to('#vignette', { autoAlpha: 0, duration: 0.6 }, t0 + 0.3);
  tl.set('#endcard', { autoAlpha: 1 }, t0 + 0.3);
  tl.fromTo('#end-logo', { scale: 0.4, rotation: -14, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 1.0, ease: 'back.out(1.7)', ...IR }, t0 + 0.35);
  cue(t0 + 0.4, 'pop');
  tl.fromTo('#end-word', { clipPath: 'inset(0% 100% 0% 0%)', y: 12 }, { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: 0.8, ...IR }, t0 + 0.85);
  fadeIn('#end-tag', t0 + 1.45, { from: 16, duration: 0.7 });
  tl.fromTo('#end-cta', { autoAlpha: 0, scale: 0.9, y: 16 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.7, ease: 'back.out(1.6)', ...IR }, t0 + 2.1);
  cue(t0 + 2.15, 'pop-soft');
  if ($('#end-note')) fadeIn('#end-note', t0 + 2.55, { from: 10, duration: 0.6 });
  if ($('#end-url')) fadeIn('#end-url', t0 + 2.75, { from: 8 });
  S.total = t0 + (SHORT ? 5.0 : 5.8);
}

// Whole-film motion: blobs drift, spinners spin, waveform breathes.
const T = S.total;
tl.to(motion, { t: T, duration: T, ease: 'none' }, 0);
tl.to($$('.spinner'), { rotation: 360 * T / 0.75, duration: T, ease: 'none' }, 0);
tl.to('#bg-day .b1', { x: 260, y: 140, duration: T, ease: 'sine.inOut' }, 0);
tl.to('#bg-day .b2', { x: -220, y: -160, duration: T, ease: 'sine.inOut' }, 0);
tl.to('#bg-day .b3', { x: -180, y: 90, duration: T, ease: 'sine.inOut' }, 0);
tl.set({}, {}, T); // pad to the full length

cue(T, 'section', { name: 'out' });
cues.sort((a, b) => a.t - b.t);

// ─── API for the renderer / preview controls ─────────────────────────────
window.__duration = T;
window.__cues = cues;
window.__scenes = S;
window.__seek = (t) => { tl.seek(t, false); renderMotion(); };
window.__seek(0);
window.__ready = true;

if (!navigator.webdriver) {
  // Live preview: play in real time with simple keyboard controls.
  let playing = true;
  let last = performance.now();
  let now = 0;
  const loop = (ms) => {
    if (playing) now = (now + (ms - last) / 1000) % T;
    last = ms;
    window.__seek(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener('keydown', (e) => {
    if (e.key === ' ') playing = !playing;
    if (e.key === 'ArrowRight') now = Math.min(T, now + 2);
    if (e.key === 'ArrowLeft') now = Math.max(0, now - 2);
    if (/^[0-9]$/.test(e.key)) now = (T * Number(e.key)) / 10;
  });
}
