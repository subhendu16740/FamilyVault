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

const gsap = window.gsap;
gsap.registerPlugin(window.TextPlugin);

const PORTRAIT = new URLSearchParams(location.search).get('orientation') === 'portrait';
// The short cut (~55s, for Reels/Shorts) keeps the story and one pass through
// the product: hook, scramble, insight, the missed call, Ask, Hindi voice,
// resolution. It drops the statistic, Scan, Family, Reminders and Privacy.
const SHORT = new URLSearchParams(location.search).get('cut') === 'short';
const W = PORTRAIT ? 1080 : 1920;
const H = PORTRAIT ? 1920 : 1080;

// ─── Layout: every position that differs between 16:9 and 9:16 ───────────
// Phone positions are the centre of the device in stage pixels.
// Callouts sit beside the phone in 16:9 and in the band above it in 9:16.
const L = PORTRAIT ? {
  hookPhone: [540, 1150, 1.0], callPhone: [540, 1160, 0.96], dayPhone: [540, 1150, 1.0],
  resPhone: [540, 1150, 1.0],
  cards: { mail: [520, 590, -3], work: [590, 820, 3], pdf: [470, 1060, -2], otp: [620, 1290, 2.5], note: [470, 1500, -5] },
  // In 9:16 these take the place of the paragraph once it has been read.
  coScan: 't-scan', coFamily: 't-family', coAlerts: 't-alerts', wave: 't-voice', resWave: null,
} : {
  hookPhone: [1260, 540, 0.98], callPhone: [660, 540, 0.95], dayPhone: [1270, 548, 0.94],
  resPhone: [1290, 548, 0.94],
  cards: { mail: [575, 430, -3], work: [1355, 345, 3], pdf: [985, 655, -2], otp: [1440, 790, 2.5], note: [505, 800, -5] },
  coScan: [1628, 690], coFamily: [1628, 760], coAlerts: [1628, 770], wave: [1690, 548], resWave: [1705, 548],
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
  '400 15px Roboto', '500 15px Roboto', '700 15px Roboto', '400 15px "Noto Sans Devanagari"', '600 38px Caveat',
].map((f) => document.fonts.load(f)));
await document.fonts.ready;

// Scroll areas start where their header ends, as a flex layout would place them.
for (const [areaSel, scrSel] of [['#ask-area', '#scr-ask'], ['#v-area', '#scr-voice']]) {
  const scr = $(scrSel);
  Object.assign($(areaSel).style, { top: `${$('.app-header', scr).offsetHeight}px`, bottom: `${$('.ask-inputbar', scr).offsetHeight + 80}px` });
}
$('#tag-scroll').style.top = `${$('#scr-tag .app-header').offsetHeight}px`;

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
const Q2 = "When does Maa's passport expire?";
const VQ = 'पापा की हेल्थ इंश्योरेंस का पॉलिसी नंबर क्या है?';
const OV = { q1: inputOverflow('#ask-line', Q1), q2: inputOverflow('#ask-line', Q2), vq: inputOverflow('#v-line', VQ) };

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
  scan: at('#up-scan'), shutter: at('#cam-shutter'), papa: at('#p-papa'), health: at('#c-6'),
  save: at('#save-btn'), askInput: at($('#ask-typed').closest('.ask-inputbox')),
  askSend: at('#ask-send-on'), mic: at('#v-mic'), famAdd: at('#fam-add'),
  email: at($('#inv-email').parentElement), sister: at('#rel-sister'), alias: at($('#inv-alias').parentElement),
  invSend: at('#inv-send'), bell: at('#home-bell'),
  whoTitle: at($$('#tag-inner .up-sec')[0]), catTitle: at($$('#tag-inner .up-sec')[1]),
  tagTop: at('#tag-inner'),
};
const moreH = { ln1: $('#ln1-more1').offsetHeight };

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
const askScroll = layoutChat('#ask-area', [['ask-q1'], ['ask-l1', 'ask-a1'], ['ask-q2'], ['ask-l2', 'ask-a2']]);
const vScroll = layoutChat('#v-area', [['v-q1'], ['v-l1', 'v-a1']]);

// ─── Initial state ───────────────────────────────────────────────────────
const place = (el, [x, y, s = 1], extra = {}) => gsap.set(el, { xPercent: -50, yPercent: -50, x, y, scale: s, ...extra });

gsap.set('#bg-day', { autoAlpha: 0, clipPath: 'circle(0% at 50% 50%)' });
gsap.set(['#vignette'], { autoAlpha: 1 });
gsap.set('#fade', { autoAlpha: 1 });
gsap.set($$('#texts > *'), { autoAlpha: 0 });
gsap.set($$('#texts .wi'), { yPercent: 118 });
gsap.set($$('.cap-line'), { autoAlpha: 0 });
gsap.set($$('.subline'), { autoAlpha: 0 });
gsap.set($$('.callout, #wave'), { autoAlpha: 0 });
gsap.set($$('.scr'), { autoAlpha: 0 });
gsap.set('#scr-lock', { autoAlpha: 1 });
gsap.set(['#touch', '#shutter'], { autoAlpha: 0 });
gsap.set('#sb-dark', { autoAlpha: 0 });
gsap.set('#hb-dark', { autoAlpha: 0 });
gsap.set('#ln1', { autoAlpha: 0 });
gsap.set('#ln2', { autoAlpha: 0 });
gsap.set('#ln1-more1', { height: 0, autoAlpha: 0 });
gsap.set(['#ocr-done', '#fam-dim'], { autoAlpha: 0 });
gsap.set('#fam-sheet', { yPercent: 105 });
gsap.set(['#ask-title', '#v-title'].filter((s) => $(s)), { x: -40 });
gsap.set($$('.msg'), { autoAlpha: 0 });
gsap.set('#sc-count', { autoAlpha: 0 });
gsap.set('#call-missed', { autoAlpha: 0 });
gsap.set($$('.call-av .ring'), { autoAlpha: 0 });
gsap.set('#cam-scan', { autoAlpha: 0 });
place('#phone', L.hookPhone, { autoAlpha: 0 });
for (const [name, pos] of Object.entries(L.cards)) place(`#sc-${name}`, [pos[0], pos[1]], { rotation: pos[2], autoAlpha: 0 });
// In 9:16 a callout sits where its scene's paragraph was: centred, top-aligned
// with the paragraph, which fades out as the callout arrives.
function bandPos(id, el) {
  const block = $(`#${id}`);
  const subEl = $('.sub', block);
  const top = block.offsetTop + subEl.offsetTop + 6;
  return [W / 2, top + el.offsetHeight / 2];
}
for (const [id, key] of [['co-scan', 'coScan'], ['co-family', 'coFamily'], ['co-alerts', 'coAlerts'], ['wave', 'wave']]) {
  const el = $(`#${id}`);
  place(el, typeof L[key] === 'string' ? bandPos(L[key], el) : L[key]);
}
function showCallout(sel, t) {
  const d = PORTRAIT ? { y: 30 } : { x: 36 };
  const from = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, `+=${v}`]));
  const to = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, `-=${v}`]));
  if (PORTRAIT) tl.to(`#${{ '#co-scan': 't-scan', '#co-family': 't-family', '#co-alerts': 't-alerts' }[sel]} .sub`, { autoAlpha: 0, duration: 0.3, ease: 'none' }, t - 0.1);
  tl.fromTo(sel, { autoAlpha: 0, ...from }, { autoAlpha: 1, ...to, duration: 0.7, ...IR }, t);
  cue(t + 0.05, 'pop');
}

// ─── Timeline helpers ────────────────────────────────────────────────────
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out', duration: 0.6 } });
const cues = [];
const cue = (t, type, extra = {}) => cues.push({ t: Math.round(t * 1000) / 1000, type, ...extra });
const IR = { immediateRender: false };

function reveal(container, t, { stagger = 0.055, dur = 0.95 } = {}) {
  const el = typeof container === 'string' ? $(container) : container;
  tl.set(el, { autoAlpha: 1 }, t);
  tl.fromTo($$('.wi', el), { yPercent: 118 }, { yPercent: 0, duration: dur, ease: 'power4.out', stagger, ...IR }, t);
}
function showBlock(id, t) {
  const b = $(`#${id}`);
  tl.set(b, { autoAlpha: 1, y: 0 }, t);
  const k = $('.kicker', b);
  const s = $('.sub', b);
  if (k) tl.fromTo(k, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, ...IR }, t);
  tl.fromTo($$('.h1 .wi', b), { yPercent: 118 }, { yPercent: 0, duration: 0.95, ease: 'power4.out', stagger: 0.06, ...IR }, t + 0.1);
  if (s) tl.fromTo(s, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8, ...IR }, t + 0.5);
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
  } else if (how === 'zoom') {
    tl.fromTo(b, { scale: 0.92, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: dur, ease: 'power2.out', ...IR }, t);
  } else {
    tl.fromTo(b, { autoAlpha: 0 }, { autoAlpha: 1, duration: dur, ease: 'power1.inOut', ...IR }, t);
  }
  tl.set(a, { autoAlpha: 0, xPercent: 0 }, t + dur);
}
function statusBar(t, mode, time) {
  const light = mode === 'light';
  tl.to(['#sb-light', '#hb-light'], { autoAlpha: light ? 1 : 0, duration: 0.2, ease: 'none' }, t);
  tl.to(['#sb-dark', '#hb-dark'], { autoAlpha: light ? 0 : 1, duration: 0.2, ease: 'none' }, t);
  if (time) tl.set($$('.sb-time'), { text: time }, t);
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
function popCard(sel, t) {
  tl.fromTo(sel, { autoAlpha: 0, scale: 0.82, y: '+=46' }, { autoAlpha: 1, scale: 1, y: '-=46', duration: 0.6, ease: 'back.out(1.5)', ...IR }, t);
  cue(t, 'pop');
}
function sub(id, t0, t1) {
  tl.fromTo(`#${id}`, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3, ...IR }, t0);
  tl.to(`#${id}`, { autoAlpha: 0, duration: 0.25, ease: 'none' }, t1);
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
statusBar(0, 'light', '2:14');
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
  const step = 1.85;
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
  statusBar(c0, 'light', '2:14');
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
  hide('#brand', t0 + (SHORT ? 3.0 : 3.9), { y: -40 });
  S.scan = t0 + (SHORT ? 3.5 : 4.4);
}

// ─── 5. Scan ─────────────────────────────────────────────────────────────
S.ask = S.scan;
if (!SHORT) {
  const t0 = S.scan;
  cue(t0, 'section', { name: 'day' });
  showBlock('t-scan', t0);
  tl.set('#scr-upload', { autoAlpha: 1, zIndex: ++z }, t0);
  tl.set(['#scr-call', '#scr-lock'], { autoAlpha: 0 }, t0);
  statusBar(t0, 'dark', '9:41');
  tl.fromTo('#phone', { autoAlpha: 0, x: L.dayPhone[0] + (PORTRAIT ? 0 : 260), y: L.dayPhone[1] + (PORTRAIT ? 260 : 0), scale: L.dayPhone[2], rotation: PORTRAIT ? 0 : 6 },
    { autoAlpha: 1, x: L.dayPhone[0], y: L.dayPhone[1], rotation: 0, duration: 1.0, ...IR }, t0 + 0.05);
  cue(t0 + 0.05, 'whoosh-soft');
  tap(t0 + 1.45, P.scan, { press: '#up-scan' });
  nav('scr-upload', 'scr-camera', t0 + 1.6, 'zoom', 0.4);
  statusBar(t0 + 1.6, 'light');
  tl.fromTo('#cam-guides', { scale: 1.08, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ...IR }, t0 + 1.95);
  tl.set('#cam-scan', { autoAlpha: 1 }, t0 + 2.15);
  tl.fromTo('#cam-scan', { y: 0 }, { y: 440, duration: 1.05, ease: 'power1.inOut', ...IR }, t0 + 2.15);
  tl.set('#cam-scan', { autoAlpha: 0 }, t0 + 3.2);
  cue(t0 + 2.15, 'scan', { dur: 1.05 });
  tap(t0 + 3.4, P.shutter, { press: '#cam-shutter' });
  tl.fromTo('#shutter', { autoAlpha: 0 }, { autoAlpha: 0.95, duration: 0.06, ease: 'none', ...IR }, t0 + 3.42);
  tl.to('#shutter', { autoAlpha: 0, duration: 0.35, ease: 'power1.out' }, t0 + 3.5);
  cue(t0 + 3.42, 'shutter');
  nav('scr-camera', 'scr-tag', t0 + 3.75, 'fade', 0.35);
  statusBar(t0 + 3.75, 'dark');
  tl.fromTo('#ocr-fill', { scaleX: 0 }, { scaleX: 1, duration: 1.75, ease: 'power1.inOut', ...IR }, t0 + 4.05);
  cue(t0 + 4.05, 'process', { dur: 1.75 });
  tl.to('#ocr-card', { autoAlpha: 0, duration: 0.2, ease: 'none' }, t0 + 5.85);
  fadeIn('#ocr-done', t0 + 5.85, { from: 4, duration: 0.3 });
  cue(t0 + 5.9, 'ding');
  showCallout('#co-scan', t0 + 6.05);
  tl.fromTo($$('#co-scan .co-row, #co-scan .co-foot'), { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.12, ...IR }, t0 + 6.25);
  const maxScroll = $('#tag-inner').offsetHeight - $('#tag-scroll').offsetHeight;
  const scroll1 = Math.min(maxScroll, P.whoTitle.top - P.tagTop.top - 12);
  const scroll2 = Math.min(maxScroll, P.catTitle.top - P.tagTop.top - 12);
  tl.to('#tag-inner', { y: -scroll1, duration: 0.65, ease: 'power2.inOut' }, t0 + 6.8);
  tap(t0 + 7.65, P.papa, { scroll: scroll1 });
  swap('#p-rohan-sel', '#p-papa-sel', t0 + 7.66, 0.16);
  tl.to('#tag-inner', { y: -scroll2, duration: 0.65, ease: 'power2.inOut' }, t0 + 8.1);
  tap(t0 + 8.95, P.health, { scroll: scroll2 });
  swap('#c-0-sel', '#c-6-sel', t0 + 8.96, 0.16);
  tap(t0 + 9.6, P.save, { scroll: scroll2 });
  tl.to('#save-busy', { autoAlpha: 1, duration: 0.12, ease: 'none' }, t0 + 9.62);
  tl.fromTo('#up-dialog', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.22, ease: 'none', ...IR }, t0 + 10.3);
  tl.fromTo('#up-dialog-box', { scale: 0.88 }, { scale: 1, duration: 0.4, ease: 'back.out(1.8)', ...IR }, t0 + 10.3);
  cue(t0 + 10.35, 'success');
  hide('#t-scan', t0 + 11.1);
  hide('#co-scan', t0 + 11.0, { y: '-=20' });
  S.ask = t0 + 11.55;
}

// ─── 6. Ask ──────────────────────────────────────────────────────────────
{
  const t0 = S.ask;
  showBlock('t-ask', t0);
  if (SHORT) {
    cue(t0, 'section', { name: 'day' });
    tl.set('#scr-ask', { autoAlpha: 1, zIndex: ++z }, t0);
    tl.set(['#scr-call', '#scr-lock'], { autoAlpha: 0 }, t0);
    statusBar(t0, 'dark', '9:41');
    tl.fromTo('#phone', { autoAlpha: 0, x: L.dayPhone[0] + (PORTRAIT ? 0 : 260), y: L.dayPhone[1] + (PORTRAIT ? 260 : 0), scale: L.dayPhone[2], rotation: PORTRAIT ? 0 : 6 },
      { autoAlpha: 1, x: L.dayPhone[0], y: L.dayPhone[1], rotation: 0, duration: 1.0, ...IR }, t0 + 0.05);
    cue(t0 + 0.05, 'whoosh-soft');
  } else {
    nav('scr-tag', 'scr-ask', t0, 'fade', 0.4);
  }
  const q1 = Q1;
  const q2 = Q2;
  tap(t0 + 0.75, P.askInput);
  tl.set('#ask-ph', { autoAlpha: 0 }, t0 + 0.9);
  tl.set('#ask-caret', { autoAlpha: 1 }, t0 + 0.8);
  swap('#ask-send-off', '#ask-send-on', t0 + 0.95, 0.15);
  type('#ask-typed', q1, t0 + 0.9, 1.9);
  if (OV.q1.over) tl.to('#ask-line', { x: -OV.q1.over, duration: 1.9 * (1 - OV.q1.frac), ease: 'none' }, t0 + 0.9 + 1.9 * OV.q1.frac);
  tap(t0 + 3.1, P.askSend, { press: '#ask-send-on' });
  cue(t0 + 3.12, 'send');
  tl.set('#ask-typed', { text: '' }, t0 + 3.15);
  tl.set('#ask-line', { x: 0 }, t0 + 3.15);
  tl.set('#ask-caret', { autoAlpha: 0 }, t0 + 3.15);
  tl.set('#ask-ph', { autoAlpha: 1 }, t0 + 3.15);
  swap('#ask-send-on', '#ask-send-off', t0 + 3.15, 0.1);
  tl.to('#ask-empty', { autoAlpha: 0, duration: 0.2, ease: 'none' }, t0 + 3.15);
  tl.to(['#ask-back', '#ask-new'], { autoAlpha: 1, duration: 0.2, ease: 'none' }, t0 + 3.15);
  tl.to('#ask-title', { x: 0, duration: 0.25, ease: 'power2.out' }, t0 + 3.15);
  fadeIn('#ask-q1', t0 + 3.2, { duration: 0.3 });
  fadeIn('#ask-l1', t0 + 3.35, { duration: 0.3 });
  tl.to('#ask-l1', { autoAlpha: 0, duration: 0.15, ease: 'none' }, t0 + 4.75);
  fadeIn('#ask-a1', t0 + 4.75, { from: 8, duration: 0.4 });
  cue(t0 + 4.75, 'answer');
  tl.to('#ask-hl', { backgroundSize: '100% 100%', duration: 0.6, ease: 'power2.inOut' }, t0 + 5.35);
  if (SHORT) {
    hide('#t-ask', t0 + 6.0);
    S.voice = t0 + 6.45;
  } else {

  tap(t0 + 6.35, P.askInput);
  tl.set('#ask-ph', { autoAlpha: 0 }, t0 + 6.45);
  tl.set('#ask-caret', { autoAlpha: 1 }, t0 + 6.4);
  swap('#ask-send-off', '#ask-send-on', t0 + 6.5, 0.15);
  type('#ask-typed', q2, t0 + 6.45, 1.25);
  if (OV.q2.over) tl.to('#ask-line', { x: -OV.q2.over, duration: 1.25 * (1 - OV.q2.frac), ease: 'none' }, t0 + 6.45 + 1.25 * OV.q2.frac);
  tap(t0 + 8.0, P.askSend, { press: '#ask-send-on' });
  cue(t0 + 8.02, 'send');
  tl.set('#ask-typed', { text: '' }, t0 + 8.05);
  tl.set('#ask-line', { x: 0 }, t0 + 8.05);
  tl.set('#ask-caret', { autoAlpha: 0 }, t0 + 8.05);
  tl.set('#ask-ph', { autoAlpha: 1 }, t0 + 8.05);
  swap('#ask-send-on', '#ask-send-off', t0 + 8.05, 0.1);
  fadeIn('#ask-q2', t0 + 8.1, { duration: 0.3 });
  tl.to('#ask-stack', { y: -askScroll('ask-q2'), duration: 0.45, ease: 'power2.out' }, t0 + 8.1);
  fadeIn('#ask-l2', t0 + 8.25, { duration: 0.3 });
  tl.to('#ask-stack', { y: -askScroll('ask-l2'), duration: 0.4, ease: 'power2.out' }, t0 + 8.25);
  tl.to('#ask-l2', { autoAlpha: 0, duration: 0.15, ease: 'none' }, t0 + 9.35);
  fadeIn('#ask-a2', t0 + 9.35, { from: 8, duration: 0.4 });
  tl.to('#ask-stack', { y: -askScroll('ask-a2'), duration: 0.45, ease: 'power2.out' }, t0 + 9.35);
  cue(t0 + 9.35, 'answer');
  tl.to('#ask-hl2', { backgroundSize: '100% 100%', duration: 0.6, ease: 'power2.inOut' }, t0 + 9.9);
  hide('#t-ask', t0 + 10.55);
  S.voice = t0 + 11.0;
  }
}

// ─── 7. Voice, in Hindi ──────────────────────────────────────────────────
{
  const t0 = S.voice;
  showBlock('t-voice', t0);
  nav('scr-ask', 'scr-voice', t0, 'fade', 0.4);
  const q = VQ;
  tap(t0 + 1.0, P.mic);
  cue(t0 + 1.0, 'mic-on');
  swap('#mic-idle', '#mic-listen', t0 + 1.02, 0.15);
  swap('#v-ph-idle', '#v-ph-listen', t0 + 1.02, 0.15);
  tl.to('#v-icon-on', { autoAlpha: 1, duration: 0.15 }, t0 + 1.02);
  tl.fromTo('#mic-ring', { autoAlpha: 0.9, scale: 0.85 }, { autoAlpha: 0, scale: 1.45, duration: 0.9, ease: 'power1.out', repeat: 2, ...IR }, t0 + 1.05);
  if (PORTRAIT) tl.to('#t-voice .sub', { autoAlpha: 0, duration: 0.3, ease: 'none' }, t0 + 0.9);
  tl.to('#wave', { autoAlpha: 1, duration: 0.3 }, t0 + 1.0);
  tl.to(motion, { amp: 1, duration: 0.4, ease: 'power1.out' }, t0 + 1.2);
  sub('sub-3', t0 + 1.3, t0 + 4.05);
  tl.set('#v-ph-listen', { autoAlpha: 0 }, t0 + 1.55);
  type('#v-typed', q, t0 + 1.55, 2.0, ' ');
  if (OV.vq.over) tl.to('#v-line', { x: -OV.vq.over, duration: 2.0 * (1 - OV.vq.frac), ease: 'none' }, t0 + 1.55 + 2.0 * OV.vq.frac);
  tl.to(motion, { amp: 0, duration: 0.35, ease: 'power1.in' }, t0 + 3.65);
  tl.to('#wave', { autoAlpha: 0, duration: 0.25 }, t0 + 3.8);
  tl.set('#v-typed', { text: '' }, t0 + 3.95);
  tl.set('#v-line', { x: 0 }, t0 + 3.95);
  swap('#mic-listen', '#mic-think', t0 + 3.95, 0.15);
  tl.to('#v-icon-on', { autoAlpha: 0, duration: 0.15 }, t0 + 3.95);
  tl.set('#v-ph-think', { autoAlpha: 1 }, t0 + 3.95);
  tl.to('#v-empty', { autoAlpha: 0, duration: 0.2, ease: 'none' }, t0 + 3.95);
  tl.to(['#v-back', '#v-new'], { autoAlpha: 1, duration: 0.2, ease: 'none' }, t0 + 3.95);
  tl.to('#v-title', { x: 0, duration: 0.25, ease: 'power2.out' }, t0 + 3.95);
  fadeIn('#v-q1', t0 + 4.0, { duration: 0.3 });
  fadeIn('#v-l1', t0 + 4.15, { duration: 0.3 });
  tl.to('#v-l1', { autoAlpha: 0, duration: 0.15, ease: 'none' }, t0 + 5.45);
  fadeIn('#v-a1', t0 + 5.45, { from: 8, duration: 0.4 });
  tl.to('#v-stack', { y: -vScroll('v-a1'), duration: 0.45, ease: 'power2.out' }, t0 + 5.45);
  swap('#mic-think', '#mic-speak', t0 + 5.45, 0.15);
  swap('#v-ph-think', '#v-ph-again', t0 + 5.45, 0.15);
  cue(t0 + 5.45, 'answer');
  cue(t0 + 5.6, 'speak', { dur: 3.0 });
  tl.to($$('#wave i'), { backgroundColor: '#2F7D5C', duration: 0.2, ease: 'none' }, t0 + 5.4);
  tl.to('#wave', { autoAlpha: 1, duration: 0.25 }, t0 + 5.45);
  tl.to(motion, { amp: 0.85, duration: 0.4 }, t0 + 5.6);
  sub('sub-4', t0 + 5.7, t0 + 8.75);
  tl.to('#v-hl', { backgroundSize: '100% 100%', duration: 0.6, ease: 'power2.inOut' }, t0 + 6.0);
  tl.to(motion, { amp: 0, duration: 0.4, ease: 'power1.in' }, t0 + 8.6);
  swap('#mic-speak', '#mic-idle', t0 + 8.9, 0.2);
  swap('#v-stop1', '#v-again1', t0 + 8.9, 0.2);
  tl.to('#wave', { autoAlpha: 0, duration: 0.3 }, t0 + 8.9);
  hide('#t-voice', t0 + 9.55);
  S.family = t0 + 10.0;
}

// ─── 8. Family ───────────────────────────────────────────────────────────
if (SHORT) S.res = S.family;
if (!SHORT) {
  const t0 = S.family;
  showBlock('t-family', t0);
  nav('scr-voice', 'scr-family', t0, 'push', 0.45);
  showCallout('#co-family', t0 + 0.9);
  tap(t0 + 1.35, P.famAdd, { press: '#fam-add' });
  tl.to('#fam-dim', { autoAlpha: 1, duration: 0.3, ease: 'none' }, t0 + 1.45);
  tl.to('#fam-sheet', { yPercent: 0, duration: 0.5, ease: 'power3.out' }, t0 + 1.45);
  cue(t0 + 1.45, 'whoosh-soft');
  tap(t0 + 2.15, P.email);
  tl.set('#inv-email-ph', { autoAlpha: 0 }, t0 + 2.25);
  tl.set('#inv-caret', { autoAlpha: 1 }, t0 + 2.25);
  type('#inv-email', 'neha.sharma@gmail.com', t0 + 2.3, 1.0);
  tl.set('#inv-caret', { autoAlpha: 0 }, t0 + 3.45);
  tap(t0 + 3.6, P.sister);
  tl.to('#rel-sister-sel', { autoAlpha: 1, duration: 0.15, ease: 'none' }, t0 + 3.62);
  tap(t0 + 4.15, P.alias);
  tl.set('#inv-alias-ph', { autoAlpha: 0 }, t0 + 4.25);
  tl.set('#inv-caret2', { autoAlpha: 1 }, t0 + 4.25);
  type('#inv-alias', 'Neha didi', t0 + 4.3, 0.55);
  tl.set('#inv-caret2', { autoAlpha: 0 }, t0 + 5.0);
  tap(t0 + 5.2, P.invSend, { press: '#inv-send' });
  tl.to('#fam-sheet', { yPercent: 105, duration: 0.4, ease: 'power2.in' }, t0 + 5.4);
  tl.to('#fam-dim', { autoAlpha: 0, duration: 0.3, ease: 'none' }, t0 + 5.5);
  fadeIn('#fam-pending', t0 + 5.8, { from: 14, duration: 0.45 });
  cue(t0 + 5.85, 'success');
  hide('#t-family', t0 + 6.7);
  hide('#co-family', t0 + 6.6, { y: '-=20' });
  S.alerts = t0 + 7.15;
}

// ─── 9. Reminders ────────────────────────────────────────────────────────
if (!SHORT) {
  const t0 = S.alerts;
  showBlock('t-alerts', t0);
  nav('scr-family', 'scr-home', t0, 'fade', 0.4);
  statusBar(t0, 'light');
  // Reminders arrive as in-app notifications (the app has no push): the bell's
  // unread badge is what the person sees.
  tl.fromTo('#bell-badge', { scale: 0 }, { scale: 1, duration: 0.5, ease: 'back.out(2.4)', ...IR }, t0 + 0.8);
  tl.fromTo('#home-bell', { rotation: 0 }, { rotation: 14, duration: 0.07, yoyo: true, repeat: 5, ease: 'sine.inOut', ...IR }, t0 + 0.95);
  cue(t0 + 0.8, 'notif');
  showCallout('#co-alerts', t0 + 1.25);
  tl.fromTo($$('#co-alerts .co-row'), { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.12, ...IR }, t0 + 1.45);
  tap(t0 + 3.25, P.bell, { press: '#home-bell' });
  nav('scr-home', 'scr-notifs', t0 + 3.4, 'push', 0.45);
  statusBar(t0 + 3.4, 'dark');
  tl.fromTo($$('#nt-list .nt-card'), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.08, ...IR }, t0 + 3.6);
  hide('#t-alerts', t0 + 5.55);
  hide('#co-alerts', t0 + 5.5, { y: '-=20' });
  tl.to('#phone', { autoAlpha: 0, y: `+=60`, duration: 0.55, ease: 'power2.in' }, t0 + 5.55);
  S.trust = t0 + 6.1;
}

// ─── 10. Privacy ─────────────────────────────────────────────────────────
if (!SHORT) {
  const t0 = S.trust;
  tl.set('#t-trust', { autoAlpha: 1 }, t0);
  tl.fromTo('#t-trust .kicker', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, ...IR }, t0);
  tl.fromTo($$('#t-trust .h1 .wi'), { yPercent: 118 }, { yPercent: 0, duration: 0.95, ease: 'power4.out', stagger: 0.06, ...IR }, t0 + 0.1);
  tl.fromTo(['#tc1', '#tc2', '#tc3'], { autoAlpha: 0, y: 50 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.14, ...IR }, t0 + 0.55);
  [0, 1, 2].forEach((i) => cue(t0 + 0.6 + i * 0.14, 'pop-soft'));
  hide('#t-trust', t0 + 4.3, { y: -30 });
  S.res = t0 + 4.85;
}

// ─── 11. The same night ──────────────────────────────────────────────────
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
  statusBar(t0 + 0.3, 'dark', '2:14');
  if (SHORT) phoneTo(t0, L.resPhone, 1.0);
  else {
    tl.fromTo('#phone', { autoAlpha: 0, x: L.resPhone[0], y: L.resPhone[1] + 50, scale: L.resPhone[2] },
      { autoAlpha: 1, y: L.resPhone[1], duration: 1.0, ...IR }, t0 + 0.4);
  }
  if (L.resWave) {
    tl.set('#wave', { x: L.resWave[0], y: L.resWave[1] }, t0);
    tl.set($$('#wave i'), { backgroundColor: '#2F7D5C' }, t0);
    tl.to('#wave', { autoAlpha: 1, duration: 0.4 }, t0 + 0.9);
    tl.to(motion, { amp: 0.8, duration: 0.4 }, t0 + 0.9);
    tl.to(motion, { amp: 0, duration: 0.4 }, t0 + 3.0);
    tl.to('#wave', { autoAlpha: 0, duration: 0.3 }, t0 + 3.3);
  }
  cue(t0 + 1.0, 'speak', { dur: 2.2 });
  // Rohan's phone, a minute later.
  const m = t0 + 3.5;
  nav('scr-voice', 'scr-lock2', m, 'fade', 0.5);
  statusBar(m, 'light', '2:15');
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

// ─── 12. End card ────────────────────────────────────────────────────────
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
  if ($('#end-url')) fadeIn('#end-url', t0 + 2.5, { from: 8 });
  cue(t0 + 2.15, 'pop-soft');
  S.total = t0 + 5.8;
}

// Whole-film motion: blobs drift, spinners spin, waveform breathes.
const T = S.total;
tl.to(motion, { t: T, duration: T, ease: 'none' }, 0);
tl.to($$('.spinner'), { rotation: 360 * T * 1.15, duration: T, ease: 'none' }, 0);
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
