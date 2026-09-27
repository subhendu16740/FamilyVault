// HTML for everything on stage. The phone screens are ports of the real
// screens in src/app/** — same copy, same layout, same Feather glyphs — filled
// with a fictional family (the Sharmas) and a fictional insurer.
import { icon } from './icons.js';

// ─── Story data (edit here to re-cast the video) ─────────────────────────
export const STORY = {
  you: 'Rohan',
  familyName: 'Sharma Family',
  policyNo: 'ASH23114589',
  insurer: 'Arogya Shield',
  papa: 'Ramesh Sharma',
  maaPassport: 'Z4829173',
  // The line under the end card. Leave url empty to show no address.
  cta: 'Start your family vault',
  url: '',
};

const CATEGORIES = [
  'Bank Statements', 'Birth Certificate', 'Death Certificate', 'Driving License',
  'Educational Certificates', 'Employment Letters', 'Health Insurance', 'Legal Documents',
  'Life Insurance', 'Marriage Certificate', 'Medical Records', 'National ID / Aadhaar',
];

// ─── Small parts ─────────────────────────────────────────────────────────

export function logoMark(color = '#fff') {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="${color}">
    <path d="M24 5.5 43 15.2c.9.5.6 1.8-.4 1.8H5.4c-1 0-1.3-1.3-.4-1.8Z"/>
    <rect x="7.5" y="19" width="33" height="3.4" rx="1.4"/>
    <rect x="10.4" y="24.4" width="4" height="13" rx="1.6"/>
    <rect x="18.2" y="24.4" width="4" height="13" rx="1.6"/>
    <rect x="25.8" y="24.4" width="4" height="13" rx="1.6"/>
    <rect x="33.6" y="24.4" width="4" height="13" rx="1.6"/>
    <rect x="5.5" y="39.4" width="37" height="4" rx="2"/></g></svg>`;
}

function spinner(color = '#2A3D66', size = 20, cls = '') {
  // ActivityIndicator: a 3/4 arc. Rotated by the timeline.
  return `<svg class="spinner ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none"
    stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="42 60"/></svg>`;
}

function signalIcon() {
  return `<svg width="17" height="13" viewBox="0 0 17 13" fill="currentColor"><rect x="0" y="9" width="3" height="4" rx="1"/><rect x="4.6" y="6" width="3" height="7" rx="1"/><rect x="9.2" y="3" width="3" height="10" rx="1"/><rect x="13.8" y="0" width="3" height="13" rx="1"/></svg>`;
}

function batteryIcon() {
  return `<svg width="26" height="13" viewBox="0 0 26 13"><rect x="0.75" y="0.75" width="21.5" height="11.5" rx="3.2" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5"/><rect x="2.6" y="2.6" width="15" height="7.8" rx="1.7" fill="currentColor"/><rect x="23.4" y="4" width="2" height="5" rx="1" fill="currentColor" fill-opacity="0.45"/></svg>`;
}

function statusBar(kind) {
  return `<div class="statusbar ${kind}" id="sb-${kind}"><span class="sb-time">2:14</span>
    <span class="sb-icons">${signalIcon()}${icon('wifi', 16, 'currentColor', 2.4)}${batteryIcon()}</span></div>`;
}

function tabBar(active) {
  const tab = (name, iconName, label) => {
    const color = active === name ? '#2A3D66' : '#9CA3AF';
    return `<div class="tab" style="color:${color}">${icon(iconName, 24, color)}<span class="tab-label">${label}</span></div>`;
  };
  return `<div class="tabbar">${tab('home', 'home', 'Home')}
    <div class="tab-search"><div class="search-btn grad">${icon('search', 28, '#fff')}</div></div>
    ${tab('upload', 'upload', 'Upload')}</div>`;
}

const words = (text) => text.split(' ').map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ');

// ─── The fictional policy document ───────────────────────────────────────
// Labels are chosen so the app's real extractor (supabase/functions/_shared/
// ingest.ts, extractMetadata) reads exactly what the "Read off the page"
// callout shows: "Policy Number" (not "Policy No.", whose full stop the regex
// rejects), "Insured name", "Sum insured", "Valid till". Nothing above the
// policy row may contain the word "policy", or the regex grabs the next word.
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

// ─── Phone screens ───────────────────────────────────────────────────────

function lockScreen(id, time, notif) {
  return `<section class="scr scr-lock" id="${id}">
    <div class="lock-wall"></div>
    <div class="lock-clock"><div class="lock-time" id="${id}-time">${time}</div><div class="lock-date">Tuesday, 10 November</div></div>
    ${notif}
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

function uploadScreen() {
  return `<section class="scr" id="scr-upload">
    <div class="app-header up-header"><div class="hdr-row"><span class="back-btn">${icon('arrow-left', 24, '#4B5563')}</span><span class="up-title">Upload Document</span></div></div>
    <div class="up-body">
      <div class="up-sec">Choose source</div>
      <div class="up-primary">
        <div class="up-btn scan grad" id="up-scan">${icon('camera', 44, '#fff')}<span>Scan</span></div>
        <div class="up-btn browse">${icon('folder', 44, '#2A3D66')}<span>Browse Files</span></div>
      </div>
      <div class="up-secondary"><div class="up-sbtn">${icon('image', 28, '#4B5563')}<span>Gallery</span></div></div>
      <div class="hint">${icon('info', 16, '#6B7280')}<span>Supports PDF, PNG, JPG, JPEG</span></div>
    </div>
    ${tabBar('upload')}
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

// Selected person chips gain a check mark, category chips do not (upload.tsx).
// The ghost keeps a person chip the width it has once the mark appears.
function chip(id, label, selected, check) {
  return `<div class="chip" id="${id}">${check ? '<i class="ghost"></i>' : ''}${label}
    <div class="sel" id="${id}-sel" style="opacity:${selected ? 1 : 0}">${check ? icon('check', 14, '#fff') : ''}<span>${label}</span></div></div>`;
}

function tagScreen() {
  const people = [['p-rohan', STORY.you], ['p-papa', 'Papa (Father)'], ['p-maa', 'Maa (Mother)'], ['p-priya', 'Priya (Spouse)']];
  return `<section class="scr" id="scr-tag">
    <div class="app-header up-header"><div class="hdr-row"><span class="back-btn">${icon('arrow-left', 24, '#4B5563')}</span><span class="up-title">Upload Document</span></div></div>
    <div class="tag-scroll" id="tag-scroll"><div class="tag-inner" id="tag-inner">
      <div class="preview"><div style="transform:scale(0.5);transform-origin:50% 50%">${policyPaper()}</div></div>
      <div class="file-row">${icon('image', 16, '#6B7280')}<span class="n">Papa_Health_Policy.jpg</span><span class="s">1.4 MB</span></div>
      <div class="ocr-slot">
        <div class="ocr-card" id="ocr-card"><div class="ocr-head">${spinner('#2A3D66', 18, 'ocr-spin')}<span>Reading English text from image...</span></div>
          <div class="ocr-bar"><div class="ocr-fill" id="ocr-fill"></div></div></div>
        <div class="ocr-done" id="ocr-done">${icon('check-circle', 16, '#16A34A')}<span>Text extracted (1,284 characters)</span></div>
      </div>
      <div class="change-file">${icon('refresh-cw', 14, '#2A3D66')}<span>Choose different file</span></div>
      <div class="up-sec">Who does this belong to?</div>
      <div class="chips">${people.map(([id, l], i) => chip(id, l, i === 0, true)).join('')}</div>
      <div class="up-sec" style="margin-top:24px">Category</div>
      <div class="chips">${CATEGORIES.map((c, i) => chip(`c-${i}`, c, i === 0, false)).join('')}</div>
      <div class="save-btn grad-h" id="save-btn"><span>Save to Vault</span>
        <div class="busy" id="save-busy" style="opacity:0">${spinner('#fff', 20, 'save-spin')}<span>Uploading...</span></div></div>
    </div></div>
    <div class="overlay" id="up-dialog" style="opacity:0">
      <div class="dialog" id="up-dialog-box">${icon('check-circle', 40, '#22C55E')}
        <div class="t">Uploaded!</div><div class="m">Document saved to your vault.</div>
        <div class="btns"><div class="b o">View</div><div class="b f">Done</div></div></div>
    </div>
    ${tabBar('upload')}
  </section>`;
}

function askMessages(prefix, turns, voice) {
  // Each turn: a user bubble, a loading bubble and the answer bubble. They are
  // absolutely positioned by the timeline (see layoutChat in main.js).
  return turns.map((t, i) => `
    <div class="msg user" id="${prefix}-q${i + 1}"><div class="bubble">${t.q}</div></div>
    <div class="msg ai" id="${prefix}-l${i + 1}"><div class="ai-avatar">${icon('cpu', 14, '#2A3D66')}</div>
      <div class="bubble"><div class="typing">${spinner('#2A3D66', 18, `${prefix}-spin`)}<span>${t.loading}</span></div></div></div>
    <div class="msg ai" id="${prefix}-a${i + 1}"><div class="ai-avatar">${icon('cpu', 14, '#2A3D66')}</div>
      <div class="bubble"><div>${t.a}</div>
        ${voice ? `<div class="voice-tools"><div class="vt-btn" id="${prefix}-stop${i + 1}">${icon('square', 14, '#2A3D66')}<span>${t.stop}</span></div>
          <div class="vt-btn" id="${prefix}-again${i + 1}" style="opacity:0">${icon('volume-2', 14, '#2A3D66')}<span>${t.again}</span></div></div>` : ''}
        <div class="sources"><div class="src-chip">${icon('file-text', 12, '#2A3D66')}<span>${t.src}</span></div></div>
      </div></div>`).join('');
}

function askScreen() {
  const turns = [
    {
      q: "What is Papa's health insurance policy number?", loading: 'Searching documents...',
      a: `Papa's health insurance policy number is <mark class="hl" id="ask-hl">${STORY.policyNo}</mark>, with ${STORY.insurer}. It's valid till 14 March 2027, with a sum insured of ₹10,00,000.`,
      src: 'Papa_Health_Policy.jpg',
    },
    {
      q: "When does Maa's passport expire?", loading: 'Searching documents...',
      a: `Maa's passport (${STORY.maaPassport}) expires on <mark class="hl" id="ask-hl2">12 August 2029</mark>.`,
      src: 'Maa_Passport.pdf',
    },
  ];
  return `<section class="scr" id="scr-ask">
    <div class="app-header ask-header"><div class="hdr-row" style="height:36px">
      <span class="back-btn" id="ask-back" style="opacity:0">${icon('arrow-left', 24, '#4B5563')}</span>
      <span class="ask-title" id="ask-title">Ask FamilyVault</span>
      <span class="ask-newchat" id="ask-new" style="opacity:0">${icon('plus', 18, '#2A3D66')}</span></div></div>
    <div class="ask-area" id="ask-area" style="top:97px;bottom:153px">
      <div class="ask-empty" id="ask-empty">
        <div class="ask-hero"><div class="ic grad">${icon('cpu', 32, '#fff')}</div>
          <div class="t">Ask anything about your documents</div>
          <div class="s">I can find information across all your family's uploaded documents.</div></div>
        <div class="ask-cats">${CATEGORIES.slice(0, 8).map((c) => `<span class="ask-cat">${c}</span>`).join('')}</div>
      </div>
      <div class="chat-stack" id="ask-stack">${askMessages('ask', turns, false)}</div>
    </div>
    <div class="ask-inputbar"><div class="ask-inputbox">
      ${icon('message-circle', 18, '#9CA3AF')}
      <div class="ask-input"><span class="ask-ph" id="ask-ph">Ask about your documents...</span><span class="ask-line" id="ask-line"><span id="ask-typed"></span><span class="caret" id="ask-caret" style="opacity:0"></span></span></div>
      <div class="send-wrap"><div class="send-btn off" id="ask-send-off">${icon('send', 18, '#fff')}</div>
        <div class="send-btn grad" id="ask-send-on" style="opacity:0">${icon('send', 18, '#fff')}</div></div>
    </div></div>
    ${tabBar('search')}
  </section>`;
}

function voiceScreen() {
  const turns = [{
    q: 'पापा की हेल्थ इंश्योरेंस का पॉलिसी नंबर क्या है?',
    loading: 'आपके दस्तावेज़ों में देख रहा हूँ…',
    a: `पापा की हेल्थ इंश्योरेंस पॉलिसी का नंबर <mark class="hl" id="v-hl">${STORY.policyNo}</mark> है। यह पॉलिसी 14 मार्च 2027 तक वैध है।`,
    src: 'Papa_Health_Policy.jpg', stop: 'रोकें', again: 'फिर से सुनें',
  }];
  const ph = (id, text, shown) => `<span class="ask-ph" id="${id}" style="opacity:${shown ? 1 : 0}">${text}</span>`;
  return `<section class="scr voice" id="scr-voice">
    <div class="app-header ask-header"><div class="hdr-row" style="height:36px">
      <span class="back-btn" id="v-back" style="opacity:0">${icon('arrow-left', 24, '#4B5563')}</span>
      <span class="ask-title" id="v-title">Ask FamilyVault</span>
      <span class="ask-newchat" id="v-new" style="opacity:0">${icon('plus', 18, '#2A3D66')}</span></div></div>
    <div class="ask-area" id="v-area" style="top:97px;bottom:161px">
      <div class="ask-empty" id="v-empty">
        <div class="ask-hero"><div class="ic grad">${icon('mic', 32, '#fff')}</div>
          <div class="t">माइक दबाएँ और अपने दस्तावेज़ों के बारे में पूछें</div>
          <div class="s">जैसे: मेरा पासपोर्ट कब खत्म हो रहा है?</div></div>
        <div class="ask-cats">${CATEGORIES.slice(0, 8).map((c) => `<span class="ask-cat">${c}</span>`).join('')}</div>
      </div>
      <div class="chat-stack" id="v-stack">${askMessages('v', turns, true)}</div>
    </div>
    <div class="ask-inputbar"><div class="ask-inputbox">
      <span style="position:relative;width:18px;height:18px;display:inline-block">
        <span style="position:absolute;inset:0">${icon('mic', 18, '#9CA3AF')}</span>
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
    ${tabBar('search')}
  </section>`;
}

function familyScreen() {
  const member = (initial, name, rel, you, admin) => `<div class="m-card">
      <div class="m-av ${you ? 'you' : 'grad'}">${initial}</div>
      <div class="m-info"><div class="m-name-row"><span class="m-name">${name}</span>${you ? '<span class="badge you">You</span>' : ''}${admin ? '<span class="badge admin">Admin</span>' : ''}</div>
        <div class="m-rel">${rel}</div></div>
      <div class="joined">${icon('check-circle', 14, '#22C55E')}<span>Joined</span></div></div>`;
  return `<section class="scr" id="scr-family">
    <div class="app-header fam-header">
      <div class="hdr-row"><span class="back-btn">${icon('arrow-left', 24, '#4B5563')}</span>
        <div><div class="fam-title">${STORY.familyName}</div><div class="fam-sub">4 members</div></div></div>
      <div class="add-btn grad-h" id="fam-add">+ Add Member</div>
    </div>
    <div class="fam-section"><div class="sec-label">Members</div><div class="m-list">
      ${member('R', STORY.you, 'admin', true, true)}
      ${member('P', 'Papa', 'Father')}
      ${member('M', 'Maa', 'Mother')}
      ${member('P', 'Priya', 'Spouse')}
    </div></div>
    <div class="fam-section" id="fam-pending" style="opacity:0"><div class="sec-label">Pending Invitations</div><div class="m-list">
      <div class="m-card" style="opacity:0.85"><div class="m-av pending">N</div>
        <div class="m-info"><div class="m-name">neha.sharma@gmail.com</div><div class="m-rel">Invited as viewer</div></div>
        <div class="invited">${icon('clock', 14, '#F59E0B')}<span>Invited</span></div></div>
    </div></div>
    <div class="sheet-dim" id="fam-dim" style="opacity:0"></div>
    <div class="sheet" id="fam-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><span class="sheet-title">Invite Family Member</span><span class="sheet-x">${icon('x', 20, '#4B5563')}</span></div>
      <div class="field"><div class="field-l">Email Address</div>
        <div class="field-i"><span class="ph" id="inv-email-ph">Enter email address</span><span id="inv-email"></span><span class="caret" id="inv-caret" style="opacity:0"></span></div></div>
      <div class="field"><div class="field-l">Relationship</div><div class="rel-grid">
        ${['Father', 'Mother', 'Spouse', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'].map((r) =>
          `<div class="rel" id="rel-${r.toLowerCase()}">${r}${r === 'Sister' ? `<div class="sel" id="rel-sister-sel" style="opacity:0">${r}</div>` : ''}</div>`).join('')}
      </div></div>
      <div class="field"><div class="field-l">Also called <span>(optional)</span></div>
        <div class="field-i"><span class="ph" id="inv-alias-ph">e.g. Papa, Daddy, Baba</span><span id="inv-alias"></span><span class="caret" id="inv-caret2" style="opacity:0"></span></div>
        <div class="field-hint">Powers the smart search — "Papa's passport"</div></div>
      <div class="send-inv grad-h" id="inv-send">Send Invitation</div>
    </div>
  </section>`;
}

function homeScreen() {
  const doc = (name, ic, cat, color, owner, when) => `<div class="doc-card">
      <div class="doc-icon grad">${icon(ic, 22, '#fff')}</div>
      <div class="doc-info"><div class="doc-title">${name}</div>
        <div class="doc-meta"><span class="cat-badge" style="background:${color}">${cat}</span><span>${owner}</span><span>·</span><span>${when}</span></div></div></div>`;
  return `<section class="scr" id="scr-home">
    <div class="home-header grad">
      <div class="home-top"><div class="home-left"><div class="profile-btn">R</div>
        <div><div class="greeting">Good evening</div><div class="header-title">${STORY.you}</div></div></div>
        <div class="bell-btn" id="home-bell">${icon('bell', 20, '#fff')}<div class="bell-badge" id="bell-badge">3</div></div></div>
      <div class="home-search">${icon('search', 20, 'rgba(255,255,255,0.8)')}<span class="ph">Search documents...</span>${icon('mic', 20, 'rgba(255,255,255,0.8)')}</div>
    </div>
    <div class="section"><div class="stats-bar"><span>24 Documents</span><span class="div">|</span><span>4 Members</span><span class="div">|</span><span>11 Categories</span></div></div>
    <div class="section"><div class="section-title">Recent Documents</div><div class="doc-list">
      ${doc('Papa_Health_Policy.jpg', 'image', 'Health Insurance', '#22C55E', 'Father · Papa', 'Today')}
      ${doc('Car_Insurance.pdf', 'file-text', 'Vehicle Insurance', '#6B7280', 'Rohan', 'Yesterday')}
      ${doc('Maa_Passport.pdf', 'file-text', 'Passport', '#3B82F6', 'Mother · Maa', '3 days ago')}
      ${doc('Home_Loan_Statement.pdf', 'file-text', 'Bank Statements', '#6B7280', 'Spouse · Priya', '1 week ago')}
    </div></div>
    ${tabBar('home')}
  </section>`;
}

function notificationsScreen() {
  const card = (type, title, msg, time, unread) => {
    const cfg = {
      expiry: ['clock', '#FEF2F2', '#DC2626'], upload: ['upload', '#EFF6FF', '#2563EB'],
      invite: ['user-plus', '#F0FDF4', '#16A34A'],
    }[type];
    return `<div class="nt-card ${unread ? 'unread' : ''}"><div class="nt-ic" style="background:${cfg[1]}">${icon(cfg[0], 20, cfg[2])}</div>
      <div class="nt-c"><div class="nt-t">${title}</div><div class="nt-m">${msg}</div><div class="nt-time">${time}</div></div>
      ${unread ? '<div class="nt-dot"></div>' : ''}</div>`;
  };
  return `<section class="scr" id="scr-notifs">
    <div class="app-header nt-header"><span class="back-btn">${icon('arrow-left', 24, '#4B5563')}</span><span class="nt-title">Notifications</span><span style="width:32px"></span></div>
    <div class="nt-list" id="nt-list">
      ${card('expiry', 'Car insurance expires in 7 days', 'Car_Insurance.pdf is valid till 17 Nov 2026. Renew it before then.', 'Just now', true)}
      ${card('expiry', "Papa's health policy: renewal coming up", 'Papa_Health_Policy.jpg is valid till 14 Mar 2027.', '2h ago', true)}
      ${card('upload', 'Maa uploaded a document', 'Maa_Pension_Certificate.jpg was added to the vault.', '5h ago', true)}
      ${card('upload', 'Priya uploaded a document', 'Home_Loan_Statement.pdf was added to the vault.', '1d ago', false)}
    </div>
  </section>`;
}

export function phone() {
  return `<div class="phone" id="phone"><div class="shell">
      <i class="side-btn vol"></i><i class="side-btn power"></i>
      <div class="screen" id="screen">
        ${lockScreen('scr-lock', '2:14', lockNotif('ln1', [
          'Beta, Papa ko hospital laaye hain 🙏',
          'Insurance ka policy number maang rahe hain. Kahan rakha hai??',
        ]))}
        ${callScreen()}
        ${uploadScreen()}
        ${cameraScreen()}
        ${tagScreen()}
        ${askScreen()}
        ${voiceScreen()}
        ${familyScreen()}
        ${homeScreen()}
        ${notificationsScreen()}
        ${lockScreen('scr-lock2', '2:15', lockNotif('ln2', ['Mil gaya beta 🙏 Cashless approve ho gaya. Tum so jao ❤️']))}
        ${statusBar('dark')}${statusBar('light')}
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
    <div class="sc-top">${icon('inbox', 18, '#6B7280')}<b>rohan.sharma@gmail.com</b></div>
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
  const block = (id, kicker, kIcon, h1, sub, extra = '') => `<div class="tblock ${extra}" id="${id}">
      <div class="kicker">${icon(kIcon, 22, 'currentColor', 2.4)}<span>${kicker}</span></div>
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
  ${block('t-scan', 'Scan', 'camera', words('Photograph it once.'), 'FamilyVault reads the page and pulls out policy numbers, names and expiry dates.')}
  ${block('t-ask', 'Ask', 'message-circle', words('Then just ask.'), "Type a question the way you'd ask a person. The answer comes from your own documents, with the source attached.")}
  ${block('t-voice', 'Voice', 'mic', `${words('Parents can ask out loud.')} <span class="w"><span class="wi em">In Hindi.</span></span>`, 'One big button. The answer is shown and read aloud, in Hindi and other Indian languages.')}
  ${block('t-family', 'Family', 'users', words('One vault for the whole family.'), "Invite parents, siblings and your spouse, so anyone can find what they need, even when you can't answer.")}
  ${block('t-alerts', 'Reminders', 'bell', words('Know before it lapses.'), "Expiry dates are picked up from your documents, and you're reminded before renewals are due.")}
  <div id="t-trust">
    <div class="trust-head"><div class="kicker">${icon('shield', 22, 'currentColor', 2.4)}<span>Privacy</span></div><div class="h1">${words('Private to your family.')}</div></div>
    <div class="trust-row">
      <div class="trust-card" id="tc1"><div class="trust-ic">${icon('lock', 30, '#2A3D66')}</div><div class="trust-t">Invite-only</div><div class="trust-b">Only the people you invite can open your vault.</div></div>
      <div class="trust-card" id="tc2"><div class="trust-ic">${icon('layers', 30, '#2A3D66')}</div><div class="trust-t">Isolated by design</div><div class="trust-b">Every family's documents live in their own separate space.</div></div>
      <div class="trust-card" id="tc3"><div class="trust-ic">${icon('shield', 30, '#2A3D66')}</div><div class="trust-t">Encrypted</div><div class="trust-b">Protected in transit and at rest.</div></div>
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
    ${STORY.url ? `<div class="cta-url" id="end-url">${STORY.url}</div>` : ''}
  </div>`;
}

export function callouts() {
  return `
  <div class="callout" id="co-scan" style="width:370px">
    <div class="co-label">${icon('zap', 14, '#D4807B', 2.6)}<span>Read off the page</span></div>
    <div class="co-row"><span class="co-k">Policy no.</span><span class="co-v">${STORY.policyNo}</span></div>
    <div class="co-row"><span class="co-k">Insured</span><span class="co-v">Ramesh Sharma</span></div>
    <div class="co-row"><span class="co-k">Valid till</span><span class="co-v">14 Mar 2027</span></div>
    <div class="co-row"><span class="co-k">Sum insured</span><span class="co-v">₹10,00,000</span></div>
    <div class="co-foot">${icon('bell', 14, '#16A34A', 2.6)}<span>Expiry reminder added</span></div>
  </div>
  <div class="callout" id="co-family" style="width:360px">
    <div class="co-label">${icon('users', 14, '#D4807B', 2.6)}<span>Names your family uses</span></div>
    <div class="co-quote">Ask for <span class="nick">Papa</span>, <span class="nick">Maa</span> or <span class="nick">Neha didi</span>. Search knows who you mean.</div>
  </div>
  <div class="callout" id="co-alerts" style="width:360px">
    <div class="co-label">${icon('clock', 14, '#D4807B', 2.6)}<span>Coming up</span></div>
    <div class="co-row"><span class="co-k">Car insurance</span><span class="co-v">17 Nov 2026</span></div>
    <div class="co-row"><span class="co-k">Papa's health policy</span><span class="co-v">14 Mar 2027</span></div>
    <div class="co-row"><span class="co-k">Maa's passport</span><span class="co-v">12 Aug 2029</span></div>
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
