// HTML for everything on stage. The phone screens are ports of the real
// screens in src/app/** — same copy, same layout, same Feather glyphs, sized
// by src/constants/design.ts — filled with a fictional family (the Sharmas)
// and a fictional insurer. The phone is the installed web app on Android, so
// the status bar takes the page's theme-color (#2A3D66, src/app/_layout.tsx).
import { icon } from './icons.js';

// ─── Story data (edit here to re-cast the video) ─────────────────────────
export const STORY = {
  you: 'Rohan',
  youFull: 'Rohan Sharma',
  email: 'rohan.sharma@gmail.com',
  familyName: 'Sharma Family',
  policyNo: 'ASH23114589',
  insurer: 'Arogya Shield',
  papa: 'Ramesh Sharma',
  maa: 'Sunita Sharma',
  dadi: 'Kamala Sharma',
  // A camera scan is saved as scan_<Date.now()>.jpg (upload.tsx): this one was
  // taken at 9:41 on Sunday 1 November 2026.
  scanFile: 'scan_1793506263481.jpg',
  // The end card. Leave ctaNote or url empty to show nothing there.
  cta: 'Start your family vault',
  ctaNote: 'Free to start · ★ Family Plus ₹100 a month',
  url: '',
};

// Upload offers the first twelve categories, alphabetically (upload.tsx).
const CATEGORIES = [
  'Bank Statements', 'Birth Certificate', 'Death Certificate', 'Driving License',
  'Educational Certificates', 'Employment Letters', 'Health Insurance', 'Legal Documents',
  'Life Insurance', 'Marriage Certificate', 'Medical Records', 'National ID / Aadhaar',
];

// ─── Small parts ─────────────────────────────────────────────────────────

export function logoMark(color = '#fff') {
  // The app's own mark (public/icon-512.png), traced at its 512px geometry:
  // pediment, architrave, four columns, base.
  return `<svg viewBox="0 0 512 512" aria-hidden="true"><g fill="${color}">
    <path d="M256 100 412 185H100Z"/>
    <rect x="116" y="197" width="280" height="24" rx="6"/>
    <rect x="138" y="232" width="38" height="139" rx="8"/>
    <rect x="204" y="232" width="38" height="139" rx="8"/>
    <rect x="270" y="232" width="38" height="139" rx="8"/>
    <rect x="336" y="232" width="38" height="139" rx="8"/>
    <rect x="104" y="382" width="304" height="27" rx="6"/></g></svg>`;
}

function spinner(color = '#2A3D66', size = 20, cls = '') {
  // ActivityIndicator on the web: a faint track and a short arc. Spun by the timeline.
  return `<svg class="spinner ${cls}" width="${size}" height="${size}" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="4" opacity="0.2"/>
    <circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="80" stroke-dashoffset="60"/></svg>`;
}

function signalIcon() {
  return `<svg width="17" height="13" viewBox="0 0 17 13" fill="currentColor"><rect x="0" y="9" width="3" height="4" rx="1"/><rect x="4.6" y="6" width="3" height="7" rx="1"/><rect x="9.2" y="3" width="3" height="10" rx="1"/><rect x="13.8" y="0" width="3" height="13" rx="1"/></svg>`;
}

function batteryIcon() {
  return `<svg width="26" height="13" viewBox="0 0 26 13"><rect x="0.75" y="0.75" width="21.5" height="11.5" rx="3.2" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5"/><rect x="2.6" y="2.6" width="15" height="7.8" rx="1.7" fill="currentColor"/><rect x="23.4" y="4" width="2" height="5" rx="1" fill="currentColor" fill-opacity="0.45"/></svg>`;
}

function statusBar() {
  return `<div class="statusbar" id="sb"><span class="sb-time">2:14</span>
    <span class="sb-icons">${signalIcon()}${icon('wifi', 16, 'currentColor', 2.4)}${batteryIcon()}</span></div>`;
}

const sbFill = '<div class="sb-fill"></div>';
const plusTag = () => '<span class="plus-tag"><span class="st">★</span><span class="pl">Family Plus</span></span>';

/** ScreenHeader: the back arrow, the title (and subtitle), at most a little on the right. */
function header(title, { sub = '', right = '', id = '' } = {}) {
  return `<div class="v4-bar"${id ? ` id="${id}"` : ''}>
    <span class="v4-back">${icon('arrow-left', 24, '#2A3D66')}</span>
    <div class="v4-titles"><div class="v4-title">${title}</div>${sub ? `<div class="v4-sub">${sub}</div>` : ''}</div>
    ${right}</div>`;
}

function tabBar(active, prefix) {
  const tab = (name, iconName, label) => {
    const c = active === name ? '#2A3D66' : '#9CA3AF';
    return `<div class="tab" id="${prefix}-tab-${name}" style="color:${c}">${icon(iconName, 22, c)}<span class="tab-label">${label}</span></div>`;
  };
  return `<div class="tabbar">${tab('home', 'home', 'Home')}
    <div class="tab-search"><div class="search-btn grad">${icon('search', 24, '#fff')}</div></div>
    ${tab('upload', 'upload', 'Upload')}</div>`;
}

/** Avatar from family-tree-view.tsx: initials on a gradient, a green phone for an account. */
function avatar(name, size, { me = false, onApp = false } = {}) {
  const parts = name.trim().split(/\s+/);
  const initials = (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  const b = Math.min(22, Math.max(16, Math.round(size * 0.5)));
  const badge = onApp && size >= 28
    ? `<i class="av-badge" style="width:${b}px;height:${b}px;right:${-0.2 * b}px;bottom:${-0.15 * b}px">${icon('smartphone', Math.round(b * 0.58), '#fff', 2.4)}</i>`
    : '';
  return `<div class="av ${me ? 'me' : ''}" style="width:${size}px;height:${size}px;font-size:${size >= 48 ? 18 : 13}px">${initials}${badge}</div>`;
}

const words = (text) => text.split(' ').map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ');

// ─── The fictional policy document ───────────────────────────────────────
// Labels are chosen so the app's real extractor (supabase/functions/_shared/
// metadata.ts, extractMetadata) reads exactly what the "Read off the page"
// callout shows: "Policy Number" (not "Policy No.", whose full stop the regex
// rejects), "Sum insured", "Valid till". Nothing above the policy row may
// contain the word "policy", or the regex grabs the next word. The callout
// leaves out the name: the name pattern runs on into the next line's first
// word ("Ramesh Sharma Members"), so it would not read cleanly.
export function policyPaper(id = '') {
  return `<div class="paper" ${id ? `id="${id}"` : ''}>
    <div class="pp-head">
      <div class="pp-brand"><div class="pp-mark">${icon('shield', 14, '#fff', 2.4)}</div>
        <div class="pp-name">AROGYA SHIELD<small>HEALTH INSURANCE CO. LTD.</small></div></div>
      <div class="pp-kind">SCHEDULE OF<br>INSURANCE</div>
    </div>
    <div class="pp-title">FAMILY FLOATER HEALTH PLAN</div>
    <div class="pp-row"><span class="pp-k">Policy Number</span><b>${STORY.policyNo}</b></div>
    <div class="pp-row"><span class="pp-k">Insured name</span><b>${STORY.papa}</b></div>
    <div class="pp-row"><span class="pp-k">Members covered</span><span>Ramesh Sharma, Sunita Sharma</span></div>
    <div class="pp-row"><span class="pp-k">Sum insured</span><b>₹10,00,000</b></div>
    <div class="pp-row"><span class="pp-k">Policy period</span><span>15/03/2026 to 14/03/2027</span></div>
    <div class="pp-row"><span class="pp-k">Valid till</span><b>14/03/2027</b></div>
    <div class="pp-row"><span class="pp-k">Premium paid</span><span>₹24,318 (incl. GST)</span></div>
    <div class="pp-lines"><i style="width:94%"></i><i style="width:81%"></i><i style="width:88%"></i><i style="width:60%"></i></div>
    <div class="pp-foot"><span>Computer-generated schedule.<br>Keep it safe for claims.</span><span class="pp-sign">R. Iyer</span></div>
    <div class="pp-spec">SPECIMEN</div>
  </div>`;
}

// ─── Phone screens: the system's own ─────────────────────────────────────

function lockScreen(id, time, date, notifs) {
  return `<section class="scr scr-lock" id="${id}">
    <div class="lock-wall"></div>
    <div class="lock-clock"><div class="lock-time" id="${id}-time">${time}</div><div class="lock-date">${date}</div></div>
    ${notifs}
    <div class="lock-bottom"><span>${icon('zap', 20, '#fff')}</span><span>${icon('camera', 20, '#fff')}</span></div>
  </section>`;
}

function lockNotif(id, lines) {
  const [first, ...rest] = lines;
  return `<div class="lnotif" id="${id}">
    <div class="ln-head"><span class="ln-app">${icon('message-circle', 13, '#fff', 2.6)}</span><span>Messages</span><span>•</span><span>now</span></div>
    <div class="ln-body"><div class="ln-avatar">M</div><div>
      <div class="ln-title">Maa</div>
      <div class="ln-text">${first}</div>
      ${rest.map((l, i) => `<div class="ln-more" id="${id}-more${i + 1}"><div class="ln-text">${l}</div></div>`).join('')}
    </div></div>
  </div>`;
}

// A FamilyVault notification as public/sw.js shows it: the title and body the
// server wrote (034, 035), the app's icon, the app's name from the manifest.
function pushNotif(id, title, body) {
  return `<div class="lnotif push" id="${id}">
    <div class="ln-head"><span class="ln-app fv">${logoMark()}</span><span>FamilyVault</span><span>•</span><span>now</span></div>
    <div class="ln-title">${title}</div><div class="ln-text">${body}</div>
  </div>`;
}

function callScreen() {
  return `<section class="scr scr-call" id="scr-call">
    <div class="call-top"><div class="call-label" id="call-label">Incoming call</div><div class="call-name">Maa</div><div class="call-sub">Mobile · Lucknow</div></div>
    <div class="call-av"><div class="ring" id="ring1"></div><div class="ring" id="ring2"></div><div class="ring" id="ring3"></div><div class="av">M</div></div>
    <div class="call-missed" id="call-missed">${icon('phone-missed', 20, '#FF8A8A')}<span>Missed call</span></div>
    <div class="call-actions" id="call-actions">
      <div class="call-btn decline">${icon('phone-off', 30, '#fff')}</div>
      <div class="call-btn accept">${icon('phone', 30, '#fff')}</div>
    </div>
  </section>`;
}

function cameraScreen() {
  return `<section class="scr scr-camera" id="scr-camera">
    <div class="cam-top">${icon('x', 26, '#fff')}${icon('zap', 22, '#fff')}</div>
    <div class="cam-view">
      <div class="grain"></div>
      <div class="cam-doc" id="cam-doc">${policyPaper()}</div>
      <div id="cam-guides"><i class="cam-corner tl"></i><i class="cam-corner tr"></i><i class="cam-corner bl"></i><i class="cam-corner br"></i></div>
      <div class="cam-scanline" id="cam-scan"></div>
    </div>
    <div class="cam-modes"><span>VIDEO</span><b>PHOTO</b><span>DOCUMENT</span></div>
    <div class="cam-bottom"><div class="cam-thumb"></div><div class="cam-shutter" id="cam-shutter"><i></i></div><div class="cam-flip">${icon('refresh-cw', 22, '#fff')}</div></div>
  </section>`;
}

// ─── Upload (src/app/(tabs)/upload.tsx) ──────────────────────────────────

function uploadScreen() {
  return `<section class="scr" id="scr-upload">${sbFill}
    ${header('Upload Document')}
    <div class="up-body">
      <div class="up-h">Choose source</div>
      <div class="up-primary">
        <div class="up-scan" id="up-scan">${icon('camera', 28, '#fff')}<span>Scan</span></div>
        <div class="up-browse">${icon('folder', 28, '#2A3D66')}<span>Browse Files</span></div>
      </div>
      <div class="up-secondary">
        <div class="up-sbtn">${icon('image', 22, '#2A3D66')}<span>Gallery</span></div>
        <div class="up-sbtn" id="up-gmail">${icon('mail', 22, '#2A3D66')}<span>From Gmail</span>${plusTag()}</div>
      </div>
      <div class="up-hint">${icon('info', 16, '#6B7280')}<span>Supports PDF, PNG, JPG, JPEG</span></div>
    </div>
    ${tabBar('upload', 'up')}
  </section>`;
}

// Person chips gain a check mark when selected and category chips do not.
function chip(id, label, selected, check) {
  return `<div class="chip${check ? ' person' : ''}" id="${id}">${label}
    <div class="sel" id="${id}-sel" style="opacity:${selected ? 1 : 0}">${check ? icon('check', 14, '#fff') : ''}<span>${label}</span></div></div>`;
}

function tagScreen() {
  // Everyone in the family tree, you first ("(Me)"), then in the order they
  // were added, each with "English · Hindi" kinship (upload.tsx).
  const people = [
    ['p-me', `${STORY.youFull} (Me)`], ['p-papa', `${STORY.papa} (Father · Papa)`], ['p-maa', `${STORY.maa} (Mother · Maa)`],
    ['p-priya', 'Priya Sharma (Wife · Patni)'], ['p-dadi', `${STORY.dadi} (Grandmother · Dadi)`],
    ['p-neha', 'Neha Kapoor (Sister · Didi)'], ['p-aarav', 'Aarav Sharma (Son · Beta)'],
  ];
  return `<section class="scr" id="scr-tag">${sbFill}
    ${header('Upload Document')}
    <div class="tag-scroll" id="tag-scroll"><div class="tag-inner" id="tag-inner">
      <div class="preview"><div class="preview-photo"><div class="grain"></div><div class="preview-doc">${policyPaper()}</div></div></div>
      <div class="file-row">${icon('image', 16, '#6B7280')}<span class="n">${STORY.scanFile}</span><span class="s">1.4 MB</span></div>
      <div class="ocr-slot">
        <div class="ocr-card" id="ocr-card"><div class="ocr-head">${spinner('#2A3D66', 20, 'ocr-spin')}<span>Reading English text from image...</span></div>
          <div class="ocr-bar"><div class="ocr-fill" id="ocr-fill"></div></div></div>
        <div class="ocr-done" id="ocr-done">${icon('check-circle', 16, '#16A34A')}<span>Text extracted (1284 characters)</span></div>
      </div>
      <div class="change-file">${icon('refresh-cw', 16, '#2A3D66')}<span>Choose different file</span></div>
      <div class="up-h">Who does this belong to?</div>
      <div class="chips">${people.map(([id, l], i) => chip(id, l, i === 0, true)).join('')}</div>
      <div class="up-h" style="margin-top:24px">Category</div>
      <div class="chips">${CATEGORIES.map((c, i) => chip(`c-${i}`, c, i === 0, false)).join('')}</div>
      <div class="save-btn" id="save-btn"><span>Save to Vault</span>
        <div class="busy" id="save-busy" style="opacity:0">${spinner('#fff', 20, 'save-spin')}<span>Uploading...</span></div></div>
    </div></div>
    <div class="overlay" id="up-dialog" style="opacity:0">
      <div class="dialog" id="up-dialog-box">${icon('check-circle', 32, '#22C55E')}
        <div class="t">Uploaded!</div><div class="m">Document saved to your vault.</div>
        <div class="btns"><div class="b o">View</div><div class="b f">Done</div></div></div>
    </div>
    ${tabBar('upload', 'tag')}
  </section>`;
}

// ─── Import from Gmail (src/app/gmail-import.tsx) ────────────────────────
// The rows are what supabase/functions/_shared/gmail-rules.ts makes of these
// emails: run classifyAttachment on them and you get these reasons and
// categories. The senders are generic on purpose; no real company appears.
const GMAIL_SUGGESTED = [
  ['gm-r1', 'Statement_Oct_2026.pdf', false, 'Card Statements · 31 Oct 2026 · 186 KB', 'Your credit card statement for October 2026', 'file name says statement', 'Bank Statements'],
  ['gm-r2', 'ETicket_PNR_4521896307.pdf', false, 'Rail Bookings · 14 Oct 2026 · 96 KB', 'Booking confirmation, PNR 4521896307', 'file name says travel', 'Visa / Travel Docs'],
  ['gm-r3', 'Form16_FY2025-26.pdf', false, 'Payroll Team · 12 Jun 2026 · 238 KB', 'Form 16 for FY 2025-26', 'file name says tax', 'Tax Returns'],
  ['gm-r4', 'PAN_Card_Rohan.pdf', false, 'Rohan Sharma · 3 Mar 2026 · 1.2 MB', 'PAN card copy', 'file name says PAN', 'PAN Card'],
  ['gm-r5', 'Car Insurance.pdf', false, 'Policy Services · 10 Nov 2025 · 386 KB', 'Your motor policy is renewed', 'file name says vehicle insurance', 'Vehicle Insurance'],
];
const GMAIL_MAYBE = [
  ['gm-m1', 'IMG_20261012_183245.jpg', true, 'Priya Sharma · 12 Oct 2026 · 1.8 MB', 'Aadhaar card photo', 'email is about Aadhaar', 'National ID / Aadhaar'],
  ['gm-m2', 'scan0042.pdf', false, 'Sunita Sharma · 18 Aug 2026 · 640 KB', 'papers', 'a PDF attachment', 'Other'],
];

function gmailRow([id, file, isImg, meta, subject, reason, cat], ticked) {
  return `<div class="gm-row" id="${id}">
    <div class="gm-check"><span class="gm-off">${icon('square', 22, '#9CA3AF')}</span>
      <span class="gm-on" style="opacity:${ticked ? 1 : 0}">${icon('check-square', 22, '#2A3D66')}</span>
      <span class="gm-ok" style="opacity:0">${icon('check-circle', 22, '#16A34A')}</span></div>
    <div class="gm-body">
      <div class="gm-name">${icon(isImg ? 'image' : 'file-text', 14, '#6B7280')}<span>${file}</span></div>
      <div class="gm-meta">${meta}</div>
      <div class="gm-subj">${subject}</div>
      <div class="gm-foot"><div class="gm-why"><span class="gm-reason">${reason}</span><span class="gm-pill"><span>${cat}</span>${icon('chevron-down', 12, '#2A3D66')}</span></div>
        <div class="gm-imported" style="opacity:0"><span>Imported</span><b>View</b></div></div>
    </div></div>`;
}

function gmailScreen() {
  const owners = [['go-me', STORY.youFull, true], ['go-papa', 'Papa'], ['go-maa', 'Maa'], ['go-priya', 'Priya']];
  return `<section class="scr" id="scr-gmail">${sbFill}
    ${header('Import from Gmail', { right: plusTag() })}
    <div class="gm-scroll"><div class="gm-inner" id="gm-inner">
      <div class="gm-account">${icon('mail', 18, '#2A3D66')}<span class="e">${STORY.email}</span><b>Disconnect</b></div>
      <div class="gm-card">
        <div class="gm-state" id="gm-idle"><div class="gm-text">Look through your Gmail for documents.</div>
          <div class="gm-btn" id="gm-find">${icon('search', 16, '#fff')}<span>Find documents</span></div></div>
        <div class="gm-state" id="gm-scanning" style="opacity:0"><div class="gm-scan">${spinner('#2A3D66', 20, 'gm-spin')}<span>Looking through your email… <span id="gm-count">0 checked, 0 found</span></span></div>
          <div class="gm-pause">Pause</div></div>
        <div class="gm-state" id="gm-done" style="opacity:0"><div class="gm-text">Checked 412 emails with attachments · 10 possible documents</div>
          <div class="gm-btn">${icon('search', 16, '#fff')}<span>Check for new emails</span></div></div>
      </div>
      <div id="gm-list" style="opacity:0">
        <div class="up-h">Who do these belong to?</div>
        <div class="chips gm-owners">${owners.map(([id, l, on]) => `<div class="chip${on ? ' on' : ''}" id="${id}">${l}</div>`).join('')}</div>
        <div class="gm-group"><div class="gm-gh">Suggested (5)</div><div class="gm-hint">These look like documents worth keeping.</div>
          ${GMAIL_SUGGESTED.map((r) => gmailRow(r, true)).join('')}</div>
        <div class="gm-group"><div class="gm-gh">Maybe (2)</div><div class="gm-hint">Could be documents. Worth a look.</div>
          ${GMAIL_MAYBE.map((r) => gmailRow(r, false)).join('')}</div>
      </div>
    </div></div>
    <div class="gm-footer" id="gm-footer" style="opacity:0">
      <div class="gm-import" id="gm-import"><span id="gm-import-label">Import 5 documents (≈2.1 MB)</span>
        <div class="busy" id="gm-busy" style="opacity:0">${spinner('#fff', 20, 'gm-spin2')}<span id="gm-busy-label">Importing 1 of 5…</span></div></div>
      <div class="gm-into">Into ${STORY.familyName}</div>
    </div>
  </section>`;
}

// ─── Ask FamilyVault (src/app/(tabs)/search.tsx) ─────────────────────────

function askMessages(prefix, turns, voice) {
  // Each turn: a user bubble, a loading bubble and the answer bubble. They are
  // absolutely positioned by the timeline (see layoutChat in main.js).
  return turns.map((t, i) => `
    <div class="msg user" id="${prefix}-q${i + 1}"><div class="bubble">${t.q}</div></div>
    <div class="msg ai" id="${prefix}-l${i + 1}"><div class="ai-avatar">${icon('cpu', 14, '#2A3D66')}</div>
      <div class="bubble"><div class="typing">${spinner('#2A3D66', 20, `${prefix}-spin`)}<span>${t.loading}</span></div></div></div>
    <div class="msg ai" id="${prefix}-a${i + 1}"><div class="ai-avatar">${icon('cpu', 14, '#2A3D66')}</div>
      <div class="bubble"><div>${t.a}</div>
        ${voice ? `<div class="voice-tools"><div class="vt-btn" id="${prefix}-stop${i + 1}">${icon('square', 14, '#2A3D66')}<span>${t.stop}</span></div>
          <div class="vt-btn" id="${prefix}-again${i + 1}" style="opacity:0">${icon('volume-2', 14, '#2A3D66')}<span>${t.again}</span></div></div>` : ''}
        <div class="sources"><div class="src-chip">${icon('file-text', 12, '#2A3D66')}<span>${t.src}</span></div></div>
      </div></div>`).join('');
}

function askHeader(prefix) {
  // New question appears once there are messages; the Saved chats clock never moves.
  return header('Ask FamilyVault', { right: `<div class="v4-actions">
    <span class="v4-iconbtn" id="${prefix}-new" style="opacity:0">${icon('plus', 24, '#2A3D66')}</span>
    <span class="v4-iconbtn" id="${prefix}-clock">${icon('clock', 24, '#2A3D66')}</span></div>` });
}

function saveBar(prefix) {
  return `<div class="savebar" id="${prefix}-savebar" style="opacity:0">
    <div class="save-pill" id="${prefix}-save">${icon('bookmark', 16, '#2A3D66')}<span>Save chat</span>
      <div class="saved" id="${prefix}-saved" style="opacity:0">${icon('check-circle', 16, '#2F7D5C')}<span>Saved</span></div></div>
    <div class="save-note" id="${prefix}-savenote" style="opacity:0">Saved. Find it again with the clock at the top.</div>
  </div>`;
}

function askScreen() {
  const turns = [{
    q: "What is Papa's health insurance policy number?", loading: 'Searching documents...',
    a: `Papa's health insurance policy number is <mark class="hl" id="ask-hl">${STORY.policyNo}</mark>, with ${STORY.insurer}. It's valid till 14 March 2027, with a sum insured of ₹10,00,000.`,
    src: STORY.scanFile,
  }];
  return `<section class="scr" id="scr-ask">${sbFill}
    ${askHeader('ask')}
    <div class="ask-area" id="ask-area">
      <div class="ask-empty" id="ask-empty">
        <div class="ask-hero"><div class="ic grad">${icon('cpu', 32, '#fff')}</div>
          <div class="t">Ask anything about your documents</div>
          <div class="s">I can find information across all your family's uploaded documents.</div></div>
        <div class="ask-cats">${CATEGORIES.slice(0, 8).map((c) => `<span class="ask-cat">${c}</span>`).join('')}</div>
      </div>
      <div class="chat-stack" id="ask-stack">${askMessages('ask', turns, false)}</div>
    </div>
    <div class="ask-bottom">${saveBar('ask')}
      <div class="ask-inputbar"><div class="ask-inputbox">
        <span class="ask-lead">${icon('message-circle', 18, '#9CA3AF')}</span>
        <div class="ask-input"><span class="ask-ph" id="ask-ph">Ask about your documents...</span><span class="ask-line" id="ask-line"><span id="ask-typed"></span><span class="caret" id="ask-caret" style="opacity:0"></span></span></div>
        <div class="send-wrap"><div class="send-btn off" id="ask-send-off">${icon('send', 18, '#fff')}</div>
          <div class="send-btn grad" id="ask-send-on" style="opacity:0">${icon('send', 18, '#fff')}</div></div>
      </div></div>
    </div>
    ${tabBar('search', 'ask')}
  </section>`;
}

function voiceScreen() {
  const turns = [{
    q: 'पापा की हेल्थ इंश्योरेंस का पॉलिसी नंबर क्या है?',
    loading: 'आपके दस्तावेज़ों में देख रहा हूँ…',
    a: `पापा की हेल्थ इंश्योरेंस पॉलिसी का नंबर <mark class="hl" id="v-hl">${STORY.policyNo}</mark> है। यह पॉलिसी 14 मार्च 2027 तक वैध है।`,
    src: STORY.scanFile, stop: 'रोकें', again: 'फिर से सुनें',
  }];
  const ph = (id, text, shown) => `<span class="ask-ph" id="${id}" style="opacity:${shown ? 1 : 0}">${text}</span>`;
  return `<section class="scr voice" id="scr-voice">${sbFill}
    ${askHeader('v')}
    <div class="ask-area" id="v-area">
      <div class="ask-empty" id="v-empty">
        <div class="ask-hero"><div class="ic grad">${icon('mic', 32, '#fff')}</div>
          <div class="t">माइक दबाएँ और अपने दस्तावेज़ों के बारे में पूछें</div>
          <div class="s">जैसे: मेरा पासपोर्ट कब खत्म हो रहा है?</div></div>
        <div class="ask-cats">${CATEGORIES.slice(0, 8).map((c) => `<span class="ask-cat">${c}</span>`).join('')}</div>
      </div>
      <div class="chat-stack" id="v-stack">${askMessages('v', turns, true)}</div>
    </div>
    <div class="ask-bottom">${saveBar('v')}
      <div class="ask-inputbar"><div class="ask-inputbox">
        <span class="ask-lead"><span style="position:absolute;inset:0">${icon('mic', 18, '#9CA3AF')}</span>
          <span style="position:absolute;inset:0;opacity:0" id="v-icon-on">${icon('mic', 18, '#D4807B')}</span></span>
        <div class="ask-input">${ph('v-ph-idle', 'माइक दबाएँ और पूछें', true)}${ph('v-ph-listen', 'सुन रहा हूँ…')}${ph('v-ph-think', 'आपके दस्तावेज़ों में देख रहा हूँ…')}${ph('v-ph-again', 'दूसरा सवाल पूछने के लिए दबाएँ')}<span class="ask-line" id="v-line"><span id="v-typed"></span></span></div>
        <div class="mic-wrap" id="v-mic">
          <div class="mic-ring" id="mic-ring" style="opacity:0"></div>
          <div class="mic-c grad" id="mic-idle">${icon('mic', 26, '#fff')}</div>
          <div class="mic-c listening" id="mic-listen" style="opacity:0">${icon('mic', 26, '#fff')}</div>
          <div class="mic-c thinking" id="mic-think" style="opacity:0">${spinner('#6B7280', 20, 'mic-spin')}</div>
          <div class="mic-c speaking" id="mic-speak" style="opacity:0">${icon('volume-2', 26, '#fff')}</div>
        </div>
      </div></div>
    </div>
    ${tabBar('search', 'v')}
  </section>`;
}

// ─── Home and the drawer ─────────────────────────────────────────────────

function homeScreen() {
  // Category colours from home.tsx; anything it does not map is grey.
  const doc = (name, ic, cat, color, owner) => `<div class="doc-card">
      <div class="doc-icon grad">${icon(ic, 18, '#fff')}</div>
      <div class="doc-info"><div class="doc-title">${name}</div>
        <div class="doc-meta"><span class="cat-badge" style="background:${color}">${cat}</span><span>${owner}</span><span>·</span><span>Today</span></div></div></div>`;
  return `<section class="scr" id="scr-home">${sbFill}
    <div class="home-header">
      <div class="home-top"><div class="home-left"><div class="profile-btn" id="home-avatar">R</div>
        <div><div class="greeting">Good morning</div><div class="header-title">${STORY.youFull}</div></div></div>
        <div class="bell-btn" id="home-bell">${icon('bell', 20, '#fff')}</div></div>
      <div class="home-search">${icon('search', 18, 'rgba(255,255,255,0.8)')}<span class="ph">Search documents...</span>${icon('mic', 18, 'rgba(255,255,255,0.8)')}</div>
    </div>
    <div class="section"><div class="stats-bar"><span>31 Documents</span><span class="div">|</span><span>4 Members</span><span class="div">|</span><span>11 Categories</span></div></div>
    <div class="section"><div class="section-title">Recent Documents</div><div class="doc-list">
      ${doc(STORY.scanFile, 'image', 'Health Insurance', '#22C55E', `Father · ${STORY.papa}`)}
      ${doc('Car Insurance.pdf', 'file-text', 'Vehicle Insurance', '#6B7280', STORY.youFull)}
      ${doc('PAN_Card_Rohan.pdf', 'file-text', 'PAN Card', '#6B7280', STORY.youFull)}
      ${doc('Form16_FY2025-26.pdf', 'file-text', 'Tax Returns', '#6B7280', STORY.youFull)}
      ${doc('ETicket_PNR_4521896307.pdf', 'file-text', 'Visa / Travel Docs', '#6B7280', STORY.youFull)}
    </div></div>
    ${tabBar('home', 'home')}
    <div class="drawer" id="drawer">
      <div class="drawer-dim" id="drawer-dim"></div>
      <div class="drawer-panel" id="drawer-panel">
        <div class="dr-head">
          <div class="dr-top"><div class="dr-av">R</div><span class="dr-x">${icon('x', 24, '#fff')}</span></div>
          <div class="dr-name">${STORY.youFull}</div><div class="dr-line">${STORY.email}</div><div class="dr-line">${STORY.familyName} · Admin</div>
        </div>
        <div class="dr-menu">
          ${[['dr-home', 'home', 'Home'], ['dr-tree', 'git-branch', 'Family tree'], ['dr-emerg', 'plus-square', 'Emergency cards'],
            ['dr-manage', 'users', 'Manage Family'], ['dr-rem', 'clock', 'Reminders', true], ['dr-set', 'settings', 'Settings']]
            .map(([id, ic, label, plus]) => `<div class="dr-row" id="${id}"><span class="dr-ic">${icon(ic, 16, '#2A3D66')}</span><span class="dr-l">${label}</span>
              ${plus ? plusTag() : icon('chevron-right', 16, '#9CA3AF')}</div>`).join('')}
        </div>
        <div class="dr-foot"><div class="dr-out">${icon('log-out', 16, '#DC2626')}<span>Sign Out</span></div><div class="dr-ver">FamilyVault 1.0.0</div></div>
      </div>
    </div>
  </section>`;
}

// ─── Family tree (src/app/family-tree.tsx, components/family-tree-view.tsx)

// One person's card. Relations are what _shared/kinship.ts calls them, seen
// from Rohan; expiry badges are documents with 90 days or fewer left.
function treeCard(id, name, rel, { me = false, onApp = false, badge = '' } = {}) {
  return `<div class="tcard${me ? ' me' : ''}" id="${id}">${avatar(name, 36, { me, onApp })}
    <div class="tc-name">${name}</div><div class="tc-rel">${me ? 'You' : rel}</div>
    ${badge ? `<div class="tc-exp">${badge}</div>` : ''}</div>`;
}

function treeScreen() {
  // The layout is family-tree-view.tsx's, in the same flex boxes: a unit is a
  // person and their spouse, a branch is a unit with its children below.
  const kid = (pos, inner) => `<div class="kid"><div class="bar"><i class="${pos === 'first' || pos === 'only' ? '' : 'on'}"></i><i class="${pos === 'last' || pos === 'only' ? '' : 'on'}"></i></div><div class="vl"></div>${inner}</div>`;
  const tree = `<div class="branch" data-g="0">
      <div class="unit">${treeCard('tc-dadi', STORY.dadi, 'Grandmother (Dadi)')}</div><div class="vl"></div>
      <div class="kids">${kid('only', `<div class="branch">
        <div class="unit">${treeCard('tc-papa', STORY.papa, 'Father (Papa)', { onApp: true })}<i class="ml"></i>${treeCard('tc-maa', STORY.maa, 'Mother (Maa)', { onApp: true })}</div>
        <div class="vl"></div>
        <div class="kids">
          ${kid('first', `<div class="branch"><div class="unit">${treeCard('tc-neha', 'Neha Kapoor', 'Sister (Didi)')}</div></div>`)}
          ${kid('last', `<div class="branch">
            <div class="unit">${treeCard('tc-me', STORY.youFull, '', { me: true, onApp: true, badge: '8 days left' })}<i class="ml"></i>${treeCard('tc-priya', 'Priya Sharma', 'Wife (Patni)', { onApp: true })}</div>
            <div class="vl"></div>
            <div class="kids">${kid('only', `<div class="branch"><div class="unit">${treeCard('tc-aarav', 'Aarav Sharma', 'Son (Beta)')}</div></div>`)}</div>
          </div>`)}
        </div></div>`)}</div></div>`;
  const row = (name, sub, opts) => `<div class="ev-row">${avatar(name, 32, opts)}<div class="ev-t"><div class="ev-n">${name}</div><div class="ev-s">${sub}</div></div>${icon('chevron-right', 16, '#9CA3AF')}</div>`;
  return `<section class="scr" id="scr-tree">${sbFill}
    ${header('Family tree', { sub: STORY.familyName, right: `<div class="v4-hbtn">${icon('user-plus', 16, '#fff')}<span>Add</span></div>` })}
    <div class="tree-body">
      <div class="onapp-key"><i class="dot">${icon('smartphone', 9, '#fff', 2.4)}</i><span>On FamilyVault (has an account)</span></div>
      <div class="tree-canvas" id="tree-canvas"><div class="tree-content" id="tree-content">${tree}</div></div>
      <div class="overline" style="margin-top:8px">Everyone</div>
      <div class="ev-list">
        ${row(STORY.youFull, 'You', { me: true, onApp: true })}
        ${row(STORY.papa, 'Father (Papa) · On FamilyVault', { onApp: true })}
        ${row(STORY.maa, 'Mother (Maa) · On FamilyVault', { onApp: true })}
      </div>
    </div>
  </section>`;
}

// ─── A person, and their emergency card (person/[id].tsx, emergency/[id].tsx)

const cardTitle = (ic, title) => `<div class="card-title"><span class="ct-ic">${icon(ic, 16, '#2A3D66')}</span><span>${title}</span></div>`;
const bloodPill = (g) => `<span class="blood-pill">${icon('droplet', 12, '#B91C1C', 2.4)}<b>${g}</b></span>`;

function personScreen() {
  const chipP = (name, me) => `<div class="pchip">${avatar(name, 24, { me })}<span>${me ? 'You' : name}</span></div>`;
  return `<section class="scr" id="scr-person">${sbFill}
    ${header(STORY.papa, { right: `<div class="v4-actions"><span class="v4-iconbtn">${icon('edit-2', 24, '#2A3D66')}</span></div>` })}
    <div class="p-body">
      <div class="card hero">${avatar(STORY.papa, 56, { onApp: true })}
        <div class="hero-n">${STORY.papa}</div><div class="hero-r">Your father (Papa)</div>
        <div class="muted">Born 14 March 1966 · 60 years</div>
        <div class="acct-pill">${icon('smartphone', 12, '#2A3D66')}<span>On FamilyVault (has an account)</span></div></div>
      <div class="card">${cardTitle('plus-square', 'Emergency card')}
        <div class="ec-row">${bloodPill('B+')}<span class="muted">2 people to call</span></div>
        <div class="ec-allergy">Allergies: Penicillin</div>
        <div class="btn-primary" id="pp-open">${icon('maximize-2', 16, '#fff')}<span>Open emergency card</span></div></div>
      <div class="card">${cardTitle('users', 'Close family')}
        <div class="overline">Parents</div><div class="pchips">${chipP(STORY.dadi)}</div>
        <div class="overline">Wife</div><div class="pchips">${chipP(STORY.maa)}</div>
        <div class="overline">Children</div><div class="pchips">${chipP('Neha Kapoor')}${chipP(STORY.youFull, true)}</div></div>
    </div>
  </section>`;
}

function emergencyScreen() {
  const call = (n) => `<div class="call-btn-g">${icon('phone', 18, '#fff')}<span>${n}</span></div>`;
  const sec = (label, value) => `<div class="em-sec"><div class="em-l">${label}</div><div class="em-v">${value}</div></div>`;
  return `<section class="scr" id="scr-emerg">${sbFill}
    ${header('Emergency card', { right: `<div class="v4-actions"><span class="v4-iconbtn">${icon('edit-2', 24, '#2A3D66')}</span></div>` })}
    <div class="em-scroll"><div class="em-inner" id="em-inner">
      <div class="em-banner"><div class="em-tag">Emergency</div><div class="em-name">${STORY.papa}</div><div class="em-about">Your father (Papa) · 60 years</div></div>
      <div class="card em-card">
        <div class="em-sec"><div class="em-l">Blood group</div><div class="em-blood">B+</div></div>
        <div class="em-allergy"><div class="em-l red">${icon('alert-triangle', 18, '#B91C1C')}<span>Allergies</span></div><div class="em-v">Penicillin</div></div>
        ${sec('Health conditions', 'Type 2 diabetes, high blood pressure')}
        ${sec('Medicines', 'Metformin 500 mg, morning and night')}
        <div class="em-sec"><div class="em-l">Doctor</div><div class="em-v">Dr Anil Mehta</div>${call('+91 98765 43210')}</div>
        <div class="em-sec" id="em-ins"><div class="em-l">Health insurance</div><div class="em-v">${STORY.insurer}<br>Policy <mark class="hl" id="em-hl">${STORY.policyNo}</mark></div></div>
        <div class="em-sec"><div class="em-l">People to call</div>
          <div class="em-person"><div class="em-v">${STORY.maa}<span class="em-m">  ·  Wife</span></div>${call('+91 98765 12345')}</div>
          <div class="em-person"><div class="em-v">${STORY.youFull}<span class="em-m">  ·  Son</span></div>${call('+91 91234 56789')}</div></div>
        <div class="muted em-upd">Updated 3 October 2026 by you</div>
      </div>
    </div></div>
  </section>`;
}

// ─── Notifications (src/app/notifications.tsx) ───────────────────────────

function notificationsScreen() {
  const card = (type, title, msg, time, unread) => {
    const [ic, bg, fg] = {
      expiry: ['clock', '#FEF2F2', '#DC2626'], birthday: ['gift', '#FDF2F8', '#DB2777'],
      plan: ['star', '#FEF3C7', '#B45309'], member: ['user-plus', '#F0FDF4', '#16A34A'],
    }[type];
    return `<div class="nt-card ${unread ? 'unread' : ''}"><div class="nt-ic" style="background:${bg}">${icon(ic, 16, fg)}</div>
      <div class="nt-c"><div class="nt-t">${title}</div><div class="nt-m">${msg}</div><div class="nt-time">${time}</div></div>
      ${unread ? '<div class="nt-dot"></div>' : ''}</div>`;
  };
  return `<section class="scr" id="scr-notifs">${sbFill}
    ${header('Notifications')}
    <div class="nt-list" id="nt-list">
      ${card('expiry', 'Car Insurance expires in 7 days', `Expires on 9 Nov 2026 · ${STORY.youFull}. Renew it soon.`, 'Just now', true)}
      ${card('birthday', `Today is ${STORY.dadi}'s 78th birthday`, 'Wish her a happy birthday.', 'Just now', true)}
      ${card('plan', `${STORY.familyName} has Family Plus`, 'Room for 10 GB of documents, until 1 Nov 2027.', '1d ago', false)}
      ${card('member', `Priya Sharma joined ${STORY.familyName}`, `Priya Sharma accepted the invitation and can now see ${STORY.familyName}'s documents, as a viewer.`, 'Oct 3', false)}
    </div>
  </section>`;
}

export function phone() {
  return `<div class="phone" id="phone"><div class="shell">
      <i class="side-btn vol"></i><i class="side-btn power"></i>
      <div class="screen" id="screen">
        ${lockScreen('scr-lock', '2:14', 'Tuesday, 10 November', lockNotif('ln1', [
          'Beta, Papa ko hospital laaye hain 🙏',
          'Insurance ka policy number maang rahe hain. Kahan rakha hai??',
        ]))}
        ${callScreen()}
        ${uploadScreen()}
        ${gmailScreen()}
        ${cameraScreen()}
        ${tagScreen()}
        ${askScreen()}
        ${voiceScreen()}
        ${homeScreen()}
        ${treeScreen()}
        ${personScreen()}
        ${emergencyScreen()}
        ${lockScreen('scr-lockday', '9:05', 'Monday, 2 November', `<div class="lstack">
          ${pushNotif('pn1', 'Car Insurance expires in 7 days', `Expires on 9 Nov 2026 · ${STORY.youFull}. Renew it soon.`)}
          ${pushNotif('pn2', `Today is ${STORY.dadi}'s 78th birthday`, 'Wish her a happy birthday.')}</div>`)}
        ${notificationsScreen()}
        ${lockScreen('scr-lock2', '2:15', 'Tuesday, 10 November', lockNotif('ln2', ['Mil gaya beta 🙏 Cashless approve ho gaya. Tum so jao ❤️']))}
        ${statusBar()}
        <i class="homebar dark" id="hb-dark"></i><i class="homebar light" id="hb-light"></i>
        <div id="shutter"></div>
        <div id="touch"></div>
        <div class="glare"></div>
        <div class="punch"></div>
      </div>
    </div></div>`;
}

// ─── Film layers ─────────────────────────────────────────────────────────

export function scrambleCards() {
  return `
  <div class="sc" id="sc-mail" style="width:470px">
    <div class="sc-top">${icon('inbox', 18, '#6B7280')}<b>${STORY.email}</b></div>
    <div class="sc-search">${icon('search', 18, '#6B7280')}<span class="sc-q" id="sc-q"></span><span class="caret" id="sc-caret"></span></div>
    <div class="sc-count" id="sc-count">2,847 results</div>
    <div class="sc-row"><span><b>Your policy documents</b> · Please find attached your…</span><span>Mar 2023</span></div>
    <div class="sc-row"><span><b>Consolidated Account Statement</b> · Mutual fund…</span><span>Jan 2025</span></div>
    <div class="sc-row"><span><b>Premium receipt</b> · Thank you for your payment…</span><span>Apr 2024</span></div>
  </div>
  <div class="sc" id="sc-work" style="width:430px">
    <div class="sc-top">${icon('mail', 18, '#6B7280')}<b>rohan@previous-employer.com</b></div>
    <div class="sc-alert">${icon('lock', 22, '#B91C1C')}<div><b>This account has been disabled.</b><br>Group health cover documents are no longer available. Contact your IT administrator.</div></div>
  </div>
  <div class="sc sc-center" id="sc-pdf" style="width:400px">
    <div class="sc-file">${icon('file-text', 18, '#DC2626')}<span>Policy_Schedule_FINAL(2).pdf</span></div>
    <div class="sc-lock">${icon('lock', 24, '#374151')}</div>
    <div class="sc-h">This document is password protected</div>
    <div class="sc-p">Password: date of birth (DDMMYYYY)</div>
    <div class="sc-field" id="sc-pwd">••••••••</div>
    <div class="sc-err">Incorrect password. 2 attempts left.</div>
  </div>
  <div class="sc sc-center" id="sc-otp" style="width:420px">
    <div class="sc-h">Verify it's you</div>
    <div class="sc-p">Enter the OTP sent to <b>+91 98•••••210</b><br>(Papa's number)</div>
    <div class="sc-otp"><i class="on"></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="sc-p">Resend OTP in 0:29</div>
  </div>
  <div class="sc sc-note" id="sc-note" style="width:350px"><i class="tape"></i>
    Papa's policy papers:<br><u>blue file</u>, almirah,<br>2nd shelf (Lucknow)
  </div>`;
}

export function textBlocks() {
  const block = (id, kicker, kIcon, h1, sub, { extra = '', plus = false } = {}) => `<div class="tblock ${extra}" id="${id}">
      <div class="kicker">${icon(kIcon, 22, 'currentColor', 2.4)}<span>${kicker}</span>${plus ? '<span class="k-plus">★ Family Plus</span>' : ''}</div>
      <div class="h1">${h1}</div><div class="sub">${sub}</div></div>`;
  return `
  <div class="tblock on-dark" id="t-hook">
    <div class="clock-big"><span class="t">2:14</span><span class="ampm">AM</span></div>
    <div class="where">Maa and Papa are in <b>Lucknow</b>.<br>You're in <b>Bengaluru</b>.</div>
  </div>
  <div class="time-chip" id="time-chip">${icon('clock', 24, '#D4807B', 2.4)}<span id="chip-time">2:16 AM</span></div>
  <div class="cap-top" id="caps">
    <div class="cap-line" id="cap1">${words('Somewhere in 2,847 emails…')}</div>
    <div class="cap-line" id="cap2">${words('…or the old office email?')}</div>
    <div class="cap-line" id="cap3">${words('The PDF wants a password.')}</div>
    <div class="cap-line" id="cap4">${words("The OTP goes to Papa's phone.")}</div>
    <div class="cap-line" id="cap5">${words('The original is in the almirah back home.')}</div>
  </div>
  <div class="center-block on-dark" id="t-insight">
    <div class="big" id="ins-1">${words("You'll find it. Eventually.")}</div>
    <div class="big-em" id="ins-2">${words("Your family won't.")}</div>
  </div>
  <div class="center-block on-dark" id="t-stat">
    <div class="stat-num" id="stat-num"><span class="rs">₹</span><span id="stat-val">1.84</span> lakh crore</div>
    <div class="stat-line" id="stat-line">of Indians' money lies unclaimed. <b>“In many cases, families are simply unaware that such assets exist.”</b></div>
    <div class="stat-src" id="stat-src">Ministry of Finance, 2025</div>
  </div>
  <div class="q-block on-dark" id="t-question"><div class="big">${words("Now imagine you're the one who can't pick up.")}</div></div>
  <div class="brand" id="brand">
    <div class="logo-tile" id="logo">${logoMark()}</div>
    <div class="wordmark" id="wordmark">FamilyVault</div>
    <div class="tagline" id="tagline">Every family document. One question away.</div>
  </div>
  ${block('t-gmail', 'Import', 'mail', words('Start with your inbox.'), 'FamilyVault finds the policies, statements and tickets in your Gmail. Nothing comes in until you tick it.', { plus: true })}
  ${block('t-scan', 'Scan', 'camera', words('Photograph the paper ones.'), 'FamilyVault reads the page and pulls out policy numbers, names and expiry dates.')}
  ${block('t-ask', 'Ask', 'message-circle', words('Then just ask.'), "Type a question the way you'd ask a person. The answer comes from your own documents, with the source attached.")}
  ${block('t-voice', 'Voice', 'mic', `${words('Parents can ask out loud.')} <span class="w"><span class="wi em">In Hindi.</span></span>`, 'One big button. The answer is shown and read aloud, in Hindi and other Indian languages.')}
  ${block('t-tree', 'Family', 'users', words('The whole family, in one picture.'), 'Add Dadi and the kids, with or without an account. Ask about anyone by relation.')}
  ${block('t-emerg', 'Emergency', 'plus-square', words('What the doctor asks first.'), 'Blood group, allergies, medicines and the policy number, on one card. Every number is one tap from the dialler.')}
  ${block('t-alerts', 'Reminders', 'bell', words('Know before it lapses.'), 'The whole family is reminded 90, 30 and 7 days before a policy or passport runs out, on their phones too.')}
  <div id="t-trust">
    <div class="trust-head"><div class="kicker">${icon('shield', 22, 'currentColor', 2.4)}<span>Privacy</span></div><div class="h1">${words('Private to your family.')}</div></div>
    <div class="trust-row">
      <div class="trust-card" id="tc1"><div class="trust-ic">${icon('lock', 30, '#2A3D66')}</div><div class="trust-t">Invite-only</div><div class="trust-b">Nobody joins unless an admin asks and they say yes.</div></div>
      <div class="trust-card" id="tc2"><div class="trust-ic">${icon('layers', 30, '#2A3D66')}</div><div class="trust-t">Isolated by design</div><div class="trust-b">Every family's documents live in their own separate space.</div></div>
      <div class="trust-card" id="tc3"><div class="trust-ic">${icon('link', 30, '#2A3D66')}</div><div class="trust-t">Links that expire</div><div class="trust-b">Share one document for 1, 7 or 30 days. Turn it off any time.</div></div>
      <div class="trust-card" id="tc4"><div class="trust-ic">${icon('shield', 30, '#2A3D66')}</div><div class="trust-t">Encrypted</div><div class="trust-b">Protected in transit and at rest.</div></div>
    </div>
  </div>
  <div class="tblock on-dark res-block" id="t-res">
    <div class="kicker">${icon('heart', 22, 'currentColor', 2.4)}<span>The same night, with FamilyVault</span></div>
    <div class="clock-big"><span class="t" id="res-time">2:14</span><span class="ampm">AM</span></div>
    <div class="res-lines"><div class="h1" id="res-h1a">${words('Maa asks FamilyVault.')}</div>
      <div class="h1" id="res-h1b">${words('Sorted in a minute.')}</div></div>
    <div class="sub" id="res-sub">No calls. No passwords. No digging through inboxes.</div>
  </div>
  <div class="brand" id="endcard">
    <div class="logo-tile" id="end-logo">${logoMark()}</div>
    <div class="wordmark" id="end-word">FamilyVault</div>
    <div class="tagline" id="end-tag">Every family document. One question away.</div>
    <div class="cta" id="end-cta"><span>${STORY.cta}</span>${icon('chevron-right', 26, '#fff', 2.6)}</div>
    ${STORY.ctaNote ? `<div class="cta-note" id="end-note">${STORY.ctaNote}</div>` : ''}
    ${STORY.url ? `<div class="cta-url" id="end-url">${STORY.url}</div>` : ''}
  </div>`;
}

export function callouts() {
  const check = (t) => `<div class="co-check">${icon('check', 16, '#16A34A', 2.6)}<span>${t}</span></div>`;
  const ask = (q, who) => `<div class="co-ask"><span class="q">“${q}”</span>${icon('chevron-right', 16, '#9CA3AF', 2.4)}<span class="who">${who}</span></div>`;
  return `
  <div class="callout" id="co-gmail" style="width:380px">
    <div class="co-label">${icon('mail', 14, '#D4807B', 2.6)}<span>Your inbox, your tick</span></div>
    ${check('Looks only at emails with a PDF or photo attached')}
    ${check('Only you see what it finds, not your family')}
    ${check('Nothing is imported until you choose it')}
  </div>
  <div class="callout" id="co-scan" style="width:370px">
    <div class="co-label">${icon('zap', 14, '#D4807B', 2.6)}<span>Read off the page</span></div>
    <div class="co-row"><span class="co-k">Policy no.</span><span class="co-v">${STORY.policyNo}</span></div>
    <div class="co-row"><span class="co-k">Valid till</span><span class="co-v">14 Mar 2027</span></div>
    <div class="co-row"><span class="co-k">Sum insured</span><span class="co-v">₹10,00,000</span></div>
    <div class="co-foot">${icon('bell', 14, '#16A34A', 2.6)}<span>Expiry reminder added</span></div>
  </div>
  <div class="callout" id="co-tree" style="width:390px">
    <div class="co-label">${icon('users', 14, '#D4807B', 2.6)}<span>Ask by relation</span></div>
    ${ask("Papa's health policy", STORY.papa)}
    ${ask('Dadi ki pension', STORY.dadi)}
    ${ask('दादी की पेंशन', STORY.dadi)}
    <div class="co-quiet">Worked out from the family tree.</div>
  </div>
  <div class="callout" id="co-alerts" style="width:400px">
    <div class="co-label">${icon('bell', 14, '#D4807B', 2.6)}<span>Before it expires</span></div>
    <div class="co-steps"><i class="track"></i>
      ${[['90', 'days'], ['30', 'days'], ['7', 'days'], ['On the', 'day']].map(([a, b]) => `<div class="co-step"><i class="dot"></i><b>${a}</b><span>${b}</span></div>`).join('')}</div>
    <div class="co-foot">${icon('gift', 14, '#16A34A', 2.6)}<span>Birthdays too, on the morning</span></div>
  </div>
  <div class="wave" id="wave">${Array.from({ length: 26 }, () => '<i></i>').join('')}</div>`;
}

export function subtitles() {
  return `
    <div class="subline" id="sub-1">Son, we've brought Papa to the hospital.</div>
    <div class="subline" id="sub-2">They're asking for the insurance policy number. Where is it?</div>
    <div class="subline on-light" id="sub-3">“What is Papa's health insurance policy number?”</div>
    <div class="subline on-light" id="sub-4">“It's ${STORY.policyNo}. The policy is valid till 14 March 2027.”</div>
    <div class="subline" id="sub-5">“Found it, son. Cashless is approved. Go back to sleep.”</div>`;
}
