/* app.js — (vanilla JS)
   - Calm home (single column, no ads, no sidebar)
   - Home: no stats row; single-column cert cards; "Continue" CTA
   - Adds breadcrumbs (site navigation) on top of pages
   - Footer handled in index.html
   - Review: 10 per page
   - Review: accordion (only one open at a time)
   - Review: bottom Prev/Next question buttons
*/

const app = document.getElementById("app");
const certBtn = document.getElementById("certBtn");
const certPanel = document.getElementById("certPanel");
const themeToggle = document.getElementById("themeToggle");

let manifest = null;
let session = null;
let timerHandle = null;

let MANIFEST_URL = null;
let DATA_BASE_URL = null;
let APP_BASE_URL = null;

const REVIEW_PAGE_SIZE = 10;
let review = { mode: "all", page: 0, openGlobalIndex: null };

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function fmtMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function route() { return (location.hash || "#/practice").slice(1); }
function isAbsUrl(p) { return /^https?:\/\//i.test(String(p || "")); }
function stripLeadingSlash(p) { return String(p || "").replace(/^\/+/, ""); }
function dedupe(arr) {
  const seen = new Set();
  return arr.filter(x => x && !seen.has(x) && (seen.add(x), true));
}

/* ===== Breadcrumbs ===== */
function renderBreadcrumbs(items) {
  if (!items || !items.length) return "";
  const html = items.map((it, idx) => {
    const isLast = idx === items.length - 1;
    const label = escapeHtml(it.label || "");
    if (!isLast && it.href) {
      return `<a class="crumbLink" href="${escapeHtml(it.href)}">${label}</a>`;
    }
    return `<span class="crumbCurrent">${label}</span>`;
  }).join(`<span class="crumbSep">/</span>`);
  return `<div class="crumbs" role="navigation" aria-label="Breadcrumb">${html}</div>`;
}

/** Optional right column: if right is empty, render as a single column */
function pageShell(left, right, crumbsItems = null) {
  const hasRight = right && String(right).trim().length > 0;
  const crumbs = crumbsItems ? renderBreadcrumbs(crumbsItems) : "";

  app.innerHTML = `
    <div class="grid ${hasRight ? "" : "oneCol"}">
      <section class="card">
        ${crumbs ? `<div class="crumbsWrap">${crumbs}</div>` : ""}
        ${left}
      </section>
      ${hasRight ? `<aside class="card">${right}</aside>` : ""}
    </div>
  `;
}

/* ===== "Continue" helper ===== */
function getLastCertId() {
  try { return localStorage.getItem("s1_last_cert") || ""; } catch { return ""; }
}
function setLastCertId(certId) {
  try { localStorage.setItem("s1_last_cert", String(certId || "")); } catch {}
}

/* ===== JSON loading ===== */
function buildJsonCandidates(path) {
  const pRaw = String(path || "").trim();
  const out = [];
  if (!pRaw) return out;

  if (isAbsUrl(pRaw)) return [pRaw];

  const pNoSlash = stripLeadingSlash(pRaw);

  if (DATA_BASE_URL) out.push(new URL(pRaw, DATA_BASE_URL).toString());
  if (APP_BASE_URL) out.push(new URL(pRaw, APP_BASE_URL).toString());

  if (pNoSlash.startsWith("data/") && DATA_BASE_URL) {
    const stripped = pNoSlash.replace(/^data\//, "");
    out.push(new URL(stripped, DATA_BASE_URL).toString());
  }

  if (pRaw.startsWith("/")) {
    if (DATA_BASE_URL) out.push(new URL(pNoSlash, DATA_BASE_URL).toString());
    if (APP_BASE_URL) out.push(new URL(pNoSlash, APP_BASE_URL).toString());
  }

  if (!pRaw.includes("/") && !pRaw.includes("\\")) {
    if (DATA_BASE_URL) out.push(new URL(pRaw, DATA_BASE_URL).toString());
    if (APP_BASE_URL) out.push(new URL(`data/${pRaw}`, APP_BASE_URL).toString());
    if (DATA_BASE_URL) out.push(new URL(`data/${pRaw}`, DATA_BASE_URL).toString());
  }

  return dedupe(out);
}

async function loadJson(path) {
  const tries = buildJsonCandidates(path);
  let lastErr = null;

  for (const url of tries) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastErr = new Error(`Failed to load ${url}: ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }

  const msg = `Failed to load JSON for "${path}". Tried:\n- ${tries.join("\n- ")}`;
  throw new Error(lastErr ? `${lastErr.message}\n\n${msg}` : msg);
}

function showFatal(err) {
  console.error(err);
  pageShell(
    `<div class="hd"><h2>Couldn’t open</h2><span class="pill">Error</span></div>
     <div class="bd">
       <div class="muted" style="white-space:pre-wrap;word-break:break-word">${escapeHtml(err?.message || String(err))}</div>
       <div class="row" style="margin-top:12px">
         <button class="primary" onclick="location.hash='#/practice'">Back</button>
       </div>
     </div>`,
    `<div class="hd"><h3>Debug</h3></div>
     <div class="bd">
       <div class="muted small">Manifest:</div>
       <div class="muted small" style="word-break:break-all">${escapeHtml(MANIFEST_URL || "")}</div>
       <div class="muted small" style="margin-top:8px">Data base:</div>
       <div class="muted small" style="word-break:break-all">${escapeHtml(String(DATA_BASE_URL || ""))}</div>
     </div>`,
    [{ label: "Practice", href: "#/practice" }, { label: "Error" }]
  );
}

function findCert(certId) {
  return manifest.certifications.find(c => c.id === certId);
}
function findTestMeta(certId, testId) {
  const cert = findCert(certId);
  if (!cert) return null;
  return cert.tests.find(t => String(t.id) === String(testId)) || null;
}

function isMulti(q) { return Array.isArray(q.answerIndex); }
function normalizeSelection(sel) {
  if (sel == null) return null;
  if (Array.isArray(sel)) return [...sel].sort((a, b) => a - b);
  return sel;
}
function equalAnswer(q, selected) {
  const a = normalizeSelection(q.answerIndex);
  const b = normalizeSelection(selected);
  if (a == null || b == null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return a === b;
}
function formatAnswerLetters(sel) {
  if (sel == null) return "—";
  if (Array.isArray(sel)) return sel.map(i => String.fromCharCode(65 + i)).join(", ");
  return String.fromCharCode(65 + sel);
}
function isAnswered(ans) {
  if (!ans) return false;
  if (ans.selected == null) return false;
  if (Array.isArray(ans.selected)) return ans.selected.length > 0;
  return true;
}
function unansweredCount() {
  if (!session) return 0;
  return Object.values(session.answers).filter(a => !isAnswered(a)).length;
}

function normalizeTestData(testData) {
  if (!testData || !Array.isArray(testData.questions)) {
    throw new Error("Invalid test JSON: missing questions[]");
  }

  testData.questions = testData.questions.map((q, i) => {
    const qq = q && typeof q === "object" ? { ...q } : { prompt: String(q) };
    if (qq.id == null || String(qq.id).trim() === "") qq.id = `q${i + 1}`;
    else qq.id = String(qq.id);
    if (!Array.isArray(qq.choices)) qq.choices = [];
    return qq;
  });

  return testData;
}

/* ===== Theme ===== */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  if (themeToggle) {
    const icon = themeToggle.querySelector(".themeIcon");
    const label = themeToggle.querySelector(".themeLabel");
    const isLight = theme === "light";
    if (icon) icon.textContent = isLight ? "☀️" : "🌙";
    if (label) label.textContent = isLight ? "Light" : "Dark";
    themeToggle.setAttribute("aria-pressed", String(isLight));
  }
}
function getPreferredTheme() {
  const saved = localStorage.getItem("s1_theme");
  if (saved === "light" || saved === "dark") return saved;
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}
function initTheme() {
  applyTheme(getPreferredTheme());
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "light" ? "dark" : "light";
      localStorage.setItem("s1_theme", next);
      applyTheme(next);
    });
  }
}

/* ===== Menu ===== */
if (certBtn && certPanel) {
  certBtn.addEventListener("click", () => {
    const open = certPanel.classList.toggle("open");
    certBtn.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (e) => {
    if (!certPanel.contains(e.target) && !certBtn.contains(e.target)) {
      certPanel.classList.remove("open");
      certBtn.setAttribute("aria-expanded", "false");
    }
  });
}
function renderCertMenu() {
  certPanel.innerHTML = manifest.certifications.map(c =>
    `<a href="#/practice/${c.id}">
      <strong>${escapeHtml(c.name)}</strong>
      <div class="muted" style="font-size:12px">${escapeHtml(c.subtitle || "")}</div>
    </a>`
  ).join("");
}

/* ===== Home (calm) ===== */
function renderPracticeHome() {
  const last = getLastCertId();
  const lastCert = last ? findCert(last) : null;
  const continueHref = lastCert ? `#/practice/${lastCert.id}` : "";
  const continueLabel = lastCert ? `Continue: ${lastCert.name}` : "";

  const first = manifest.certifications?.[0];
  const primaryHref = first ? `#/practice/${first.id}` : "#/practice";

  pageShell(
    `
    <div class="hero">
      <div class="heroBadge">Local exam-mode practice • no accounts</div>

      <h1 class="heroTitle">
        Practice cloud & DevOps certifications with a calm, exam-first flow.
      </h1>

      <div class="heroSub">
        Timers, bookmarking, and fast review — repeat until you’re consistent.
      </div>

      <div class="heroCtas">
        <a class="cta primaryCta" href="${escapeHtml(primaryHref)}">Start practicing</a>
        <a class="cta ghostCta" href="#/practice">Browse certifications</a>
        ${lastCert ? `<a class="cta ghostCta" href="${escapeHtml(continueHref)}">${escapeHtml(continueLabel)}</a>` : ""}
      </div>

      <div class="cardMini">
        <div class="muted small">How it works</div>
        <ul class="heroList">
          <li>Pick a test and run it in exam mode.</li>
          <li>Bookmark uncertain questions as you go.</li>
          <li>Submit, review, and repeat until stable.</li>
        </ul>
      </div>
    </div>

    <div class="sectionHd">
      <h2>Certifications</h2>
      <div class="muted">Choose a track and start a timed run.</div>
    </div>

    <div class="certGrid certGridOne">
      ${manifest.certifications.map(c => {
        const firstTestId = (c.tests && c.tests.length) ? c.tests[0].id : "1";
        return `
          <div class="certCard">
            <div class="certTop">
              <div>
                <div class="certName">${escapeHtml(c.name)}</div>
                <div class="muted">${escapeHtml(c.subtitle || "")}</div>
              </div>
              <span class="pill">${(c.tests?.length || 0)} tests</span>
            </div>

            <div class="certActions">
              <a class="cta ghostCta" href="#/practice/${c.id}">Continue</a>
              <a class="cta primaryCta" href="#/exam/${c.id}/test/${escapeHtml(firstTestId)}">Start first test</a>
            </div>
          </div>
        `;
      }).join("")}
    </div>
    `,
    "",
    [{ label: "Practice", href: "#/practice" }]
  );
}

/* ===== Certification page ===== */
function renderCertification(certId) {
  const cert = findCert(certId);
  if (!cert) return render404();

  setLastCertId(certId);

  const tests = (cert.tests && cert.tests.length)
    ? cert.tests.map(t => `
        <div class="item">
          <div>
            <strong>${escapeHtml(t.title)}</strong>
            <div class="muted">suggested ${t.minutesSuggested} min</div>
            <div class="muted small">path: ${escapeHtml(t.path)}</div>
          </div>
          <a class="pill" href="#/exam/${cert.id}/test/${t.id}">Start</a>
        </div>
      `).join("")
    : `<div class="muted">No tests yet.</div>`;

  pageShell(
    `<div class="hd"><h2>${escapeHtml(cert.name)}</h2><span class="pill">${escapeHtml(cert.subtitle || "")}</span></div>
     <div class="bd">
       <div class="muted">${(cert.intro || []).map(escapeHtml).join(" ")}</div>
       <h3 style="margin:14px 0 8px">Tests</h3>
       <div class="list">${tests}</div>
     </div>`,
    `<div class="hd"><h3>Quick</h3></div>
     <div class="bd">
       <button class="primary" onclick="location.hash='#/practice'">Back</button>
     </div>`,
    [{ label: "Practice", href: "#/practice" }, { label: cert.name }]
  );
}

async function startOrResumeSession(certId, testId) {
  const meta = findTestMeta(certId, testId);
  if (!meta) throw new Error("Test not found in manifest");

  setLastCertId(certId);

  const raw = await loadJson(meta.path);
  const testData = normalizeTestData(raw);

  const now = Date.now();
  session = {
    certId, testId,
    testMeta: meta,
    testData,
    startedAt: now,
    qIndex: 0,
    submitted: false,
    submittedAt: null,
    score: null,
    answers: {}
  };

  testData.questions.forEach(q => {
    session.answers[q.id] = { selected: null, startedAt: null, timeMs: 0, starred: false };
  });

  review = { mode: "all", page: 0, openGlobalIndex: null };
}

function attachTimers() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    if (!session || session.submitted) return;
    const now = Date.now();
    const totalMs = now - session.startedAt;
    const q = session.testData.questions[session.qIndex];
    const a = session.answers[q.id];
    const qMs = a.startedAt ? (now - a.startedAt) : 0;
    const elT = document.getElementById("tTotal");
    const elQ = document.getElementById("tQ");
    if (elT) elT.textContent = `Total: ${fmtMs(totalMs)}`;
    if (elQ) elQ.textContent = `This Q: ${fmtMs(qMs)}`;
  }, 250);
}

function finalizeTime() {
  if (!session) return;
  const now = Date.now();
  const q = session.testData.questions[session.qIndex];
  const a = session.answers[q.id];
  if (a.startedAt != null) {
    a.timeMs += (now - a.startedAt);
    a.startedAt = now;
  }
}

/* ===== Jump panel (during exam only) ===== */
function jumpBtnClass(i) {
  const qq = session.testData.questions[i];
  const a = session.answers[qq.id];
  if (a.starred) return "qbtn qbtn-star";
  if (isAnswered(a)) return "qbtn qbtn-answered";
  return "qbtn";
}
function jumpBtnInner(i) {
  const qq = session.testData.questions[i];
  const a = session.answers[qq.id];
  const star = a?.starred ? `<span class="qstar" aria-hidden="true">★</span>` : "";
  return `${i + 1}${star}`;
}
function renderJumpPanelExam() {
  const test = session.testData;
  const answered = Object.values(session.answers).filter(isAnswered).length;
  return `
    <div class="hd"><h3>Jump</h3><span class="pill">${answered}/${test.questions.length}</span></div>
    <div class="bd">
      <div class="legend">
        <span class="legendItem"><span class="dot answered"></span> Answered</span>
        <span class="legendItem"><span class="dot star"></span> Bookmarked</span>
      </div>
      <div class="jumpGrid">
        ${test.questions.map((qq, i) => `
          <button class="${jumpBtnClass(i)}" onclick="jumpQ(${i})" aria-label="Jump to question ${i + 1}">
            ${jumpBtnInner(i)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

/* ===== Review (accordion + 10/page) ===== */
function reviewAllItems() {
  const qs = session.testData.questions;
  return qs.map((q, i) => {
    const a = session.answers[q.id];
    const ok = equalAnswer(q, a.selected);
    return { i, ok, starred: !!a.starred, timeMs: a.timeMs || 0 };
  });
}
function reviewFilteredItems() {
  const all = reviewAllItems();
  if (review.mode === "incorrect") return all.filter(x => !x.ok);
  if (review.mode === "bookmarked") return all.filter(x => x.starred);
  return all;
}
function reviewPageCount(items) {
  return Math.max(1, Math.ceil(items.length / REVIEW_PAGE_SIZE));
}
function clampReviewPage(items) {
  const pc = reviewPageCount(items);
  if (review.page < 0) review.page = 0;
  if (review.page > pc - 1) review.page = pc - 1;
}

window.setReviewMode = (m) => {
  review.mode = m;
  review.page = 0;
  review.openGlobalIndex = null;
  renderReview();
};
window.reviewPrevPage = () => { review.page -= 1; review.openGlobalIndex = null; renderReview(); };
window.reviewNextPage = () => { review.page += 1; review.openGlobalIndex = null; renderReview(); };

window.reviewPrevQ = () => {
  const items = reviewFilteredItems();
  if (!items.length) return;

  if (review.openGlobalIndex == null) {
    const start = review.page * REVIEW_PAGE_SIZE;
    review.openGlobalIndex = items[Math.min(start, items.length - 1)].i;
    renderReview();
    return;
  }

  const pos = items.findIndex(x => x.i === review.openGlobalIndex);
  if (pos <= 0) return;

  review.openGlobalIndex = items[pos - 1].i;
  const newPos = pos - 1;
  review.page = Math.floor(newPos / REVIEW_PAGE_SIZE);
  renderReview();
};

window.reviewNextQ = () => {
  const items = reviewFilteredItems();
  if (!items.length) return;

  if (review.openGlobalIndex == null) {
    const start = review.page * REVIEW_PAGE_SIZE;
    review.openGlobalIndex = items[Math.min(start, items.length - 1)].i;
    renderReview();
    return;
  }

  const pos = items.findIndex(x => x.i === review.openGlobalIndex);
  if (pos < 0 || pos >= items.length - 1) return;

  review.openGlobalIndex = items[pos + 1].i;
  const newPos = pos + 1;
  review.page = Math.floor(newPos / REVIEW_PAGE_SIZE);
  renderReview();
};

window.setOpenReview = (globalIndex) => {
  review.openGlobalIndex = globalIndex;
  renderReview();
};

function renderReviewSidebar() {
  const items = reviewFilteredItems();
  clampReviewPage(items);
  const pc = reviewPageCount(items);

  const allCount = session.testData.questions.length;
  const incorrectCount = reviewAllItems().filter(x => !x.ok).length;
  const bookmarkedCount = reviewAllItems().filter(x => x.starred).length;

  const activeAll = review.mode === "all" ? "segOn" : "";
  const activeInc = review.mode === "incorrect" ? "segOn" : "";
  const activeBm = review.mode === "bookmarked" ? "segOn" : "";

  const start = review.page * REVIEW_PAGE_SIZE;
  const end = Math.min(items.length, start + REVIEW_PAGE_SIZE);
  const pageItems = items.slice(start, end);

  const listHtml = pageItems.length
    ? pageItems.map(x => {
        const star = x.starred ? `<span class="rStar">★</span>` : "";
        const pill = x.ok ? `<span class="rPill ok">Correct</span>` : `<span class="rPill bad">Wrong</span>`;
        const on = review.openGlobalIndex === x.i ? "rRowOn" : "";
        return `
          <button class="rRow ${on}" onclick="setOpenReview(${x.i})">
            <div class="rLeft">
              <div class="rTitle">Question ${x.i + 1} ${star}</div>
              <div class="rSub">${fmtMs(x.timeMs)}</div>
            </div>
            <div class="rRight">${pill}</div>
          </button>
        `;
      }).join("")
    : `<div class="muted small">No questions in this filter.</div>`;

  return `
    <div class="hd"><h3>Review</h3><span class="pill">${items.length}/${allCount}</span></div>
    <div class="bd">
      <div class="seg">
        <button class="segBtn ${activeAll}" onclick="setReviewMode('all')">All (${allCount})</button>
        <button class="segBtn ${activeInc}" onclick="setReviewMode('incorrect')">Incorrect (${incorrectCount})</button>
        <button class="segBtn ${activeBm}" onclick="setReviewMode('bookmarked')">Bookmarked (${bookmarkedCount})</button>
      </div>

      <div class="pager">
        <button onclick="reviewPrevPage()" ${review.page === 0 ? "disabled" : ""}>Prev</button>
        <div class="muted small">Page ${review.page + 1} / ${pc}</div>
        <button onclick="reviewNextPage()" ${review.page >= pc - 1 ? "disabled" : ""}>Next</button>
      </div>

      <div class="rList">${listHtml}</div>
    </div>
  `;
}

function renderReviewPageBlocks() {
  const items = reviewFilteredItems();
  clampReviewPage(items);

  const start = review.page * REVIEW_PAGE_SIZE;
  const end = Math.min(items.length, start + REVIEW_PAGE_SIZE);
  const pageItems = items.slice(start, end);

  if (!pageItems.length) return `<div class="muted">No questions to display for this filter.</div>`;

  if (review.openGlobalIndex == null) {
    review.openGlobalIndex = pageItems[0].i;
  }

  return pageItems.map((it) => {
    const q = session.testData.questions[it.i];
    const a = session.answers[q.id];
    const ok = equalAnswer(q, a.selected);

    const correctIdx = q.answerIndex;
    const correctSet = Array.isArray(correctIdx) ? new Set(correctIdx) : new Set([correctIdx]);
    const selected = a.selected;
    const selectedSet = selected == null ? new Set() : (Array.isArray(selected) ? new Set(selected) : new Set([selected]));

    const star = a.starred ? `<span class="inlineStar">★</span>` : "";
    const statusPill = ok ? `<span class="pill pillOk">Correct</span>` : `<span class="pill pillBad">Incorrect</span>`;

    const perChoice = q.choices.map((txt, idx) => {
      const isCorrect = correctSet.has(idx);
      const isSelected = selectedSet.has(idx);

      let badge = "";
      if (isCorrect) badge = `<span class="badge good">Correct</span>`;
      else if (isSelected && !isCorrect) badge = `<span class="badge bad">Your pick</span>`;

      const explainArr = Array.isArray(q.choiceExplanations) ? q.choiceExplanations : null;
      const explainText = explainArr && explainArr[idx] ? explainArr[idx] : "";

      return `
        <div class="opt ${isCorrect ? "opt-correct" : ""} ${isSelected && !isCorrect ? "opt-wrong" : ""}">
          <div class="optHead">
            <div class="optLabel"><strong>${String.fromCharCode(65 + idx)}.</strong> ${escapeHtml(txt)}</div>
            ${badge}
          </div>
          ${explainText ? `<div class="optExplain">${escapeHtml(explainText)}</div>` : ""}
        </div>
      `;
    }).join("");

    const openAttr = (review.openGlobalIndex === it.i) ? "open" : "";

    return `
      <details class="reviewCard" ${openAttr} data-q="${it.i}">
        <summary class="reviewSum">
          <div class="reviewSumLeft">
            <div class="reviewSumTitle">
              Question ${it.i + 1} ${star}
            </div>
            <div class="muted small">
              Your: ${escapeHtml(formatAnswerLetters(a.selected))} • Correct: ${escapeHtml(formatAnswerLetters(q.answerIndex))} • Time: ${fmtMs(a.timeMs)}
            </div>
          </div>
          <div class="reviewSumRight">
            ${statusPill}
          </div>
        </summary>

        <div class="reviewBody">
          <div class="prompt">${escapeHtml(q.prompt)}</div>

          ${q.image ? `<div class="muted small" style="margin-top:10px;">Image:</div>
            <img alt="diagram" src="${escapeHtml(q.image)}" class="qimg">` : ""}

          <div class="optList">${perChoice}</div>

          ${q.explanation ? `<div class="explain"><strong>Summary:</strong> ${escapeHtml(q.explanation)}</div>` : ""}

          <div class="refs">
            ${(q.references || []).map(r => `<span class="ref">${escapeHtml(r)}</span>`).join("")}
          </div>
        </div>
      </details>
    `;
  }).join("");
}

function attachReviewAccordion() {
  const root = document.querySelector(".reviewBlocks");
  if (!root) return;

  root.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement)) return;
    if (!d.open) return;

    root.querySelectorAll("details.reviewCard").forEach(x => {
      if (x !== d) x.open = false;
    });

    const idx = Number(d.getAttribute("data-q"));
    if (!Number.isNaN(idx)) review.openGlobalIndex = idx;
  }, true);
}

/* ===== Exam render ===== */
function renderExam() {
  const cert = findCert(session.certId);
  const test = session.testData;
  const q = test.questions[session.qIndex];
  const a = session.answers[q.id];
  if (a.startedAt == null) a.startedAt = Date.now();

  const totalQ = test.questions.length;
  const answered = Object.values(session.answers).filter(isAnswered).length;
  const progress = Math.round(((session.qIndex + 1) / totalQ) * 100);
  const multi = isMulti(q);

  const starLabel = a.starred ? "★ Bookmarked" : "☆ Bookmark";
  const starBtnClass = a.starred ? "warn" : "";

  const choicesHtml = q.choices.map((c, idx) => {
    const isSel = multi
      ? Array.isArray(a.selected) && a.selected.includes(idx)
      : a.selected === idx;
    return `
      <div class="choice ${isSel ? "selected" : ""}" data-idx="${idx}">
        <strong>${String.fromCharCode(65 + idx)}.</strong>
        ${escapeHtml(String(c).replace(/^[A-Z]\./, "").trim())}
      </div>
    `;
  }).join("");

  const remaining = unansweredCount();
  const submitLabel = remaining > 0 ? `Submit (${remaining} unanswered)` : "Submit";

  const crumbs = [
    { label: "Practice", href: "#/practice" },
    { label: cert.name, href: `#/practice/${session.certId}` },
    { label: session.testMeta.title, href: `#/practice/${session.certId}` },
    { label: `Question ${session.qIndex + 1} / ${totalQ}` }
  ];

  pageShell(
    `<div class="examTop">
      <div class="examTopLeft">
        <div class="muted small">${escapeHtml(cert.name)} • ${escapeHtml(session.testMeta.title)}</div>
        <div class="qtitle">Question <strong>${session.qIndex + 1}</strong> of ${totalQ}</div>
        <div class="topNavRow">
          <button class="btnSm" onclick="backToCert()">← Back</button>
          <button class="btnSm" onclick="exitToHome()">Exit</button>
        </div>
      </div>

      <div class="examTopRight">
        <div class="stat" id="tTotal">Total: 0:00</div>
        <div class="stat" id="tQ">This Q: 0:00</div>
        <button class="chip ${starBtnClass}" onclick="toggleStar()">${starLabel}</button>
      </div>

      <div style="width:100%;">
        <div class="progress"><div class="bar" style="width:${progress}%;"></div></div>
      </div>
    </div>

    <div class="qwrap">
      <div class="prompt">${escapeHtml(q.prompt)}</div>
      <div class="muted small" style="margin-top:6px;">
        ${multi ? "Multi-select question." : "Single-select question."}
      </div>
      <div class="choices" id="choices">${choicesHtml}</div>
    </div>

    <div class="footerRow">
      <div class="muted">Answered: ${answered}/${totalQ} • Bookmarked: ${Object.values(session.answers).filter(x => x.starred).length}</div>
      <div class="footerBtns">
        <button onclick="prevQ()" ${session.qIndex === 0 ? "disabled" : ""}>Previous</button>
        <button onclick="clearQ()">Clear</button>
        ${session.qIndex < totalQ - 1
          ? `<button class="primary" onclick="nextQ()">Next</button>`
          : `<button class="primary" onclick="submitExam()">${escapeHtml(submitLabel)}</button>`
        }
      </div>
    </div>`,
    renderJumpPanelExam(),
    crumbs
  );

  document.getElementById("choices").addEventListener("click", (e) => {
    const el = e.target.closest(".choice");
    if (!el) return;
    const idx = Number(el.dataset.idx);
    const ans = session.answers[q.id];

    if (isMulti(q)) {
      const cur = Array.isArray(ans.selected) ? [...ans.selected] : [];
      const pos = cur.indexOf(idx);
      if (pos >= 0) cur.splice(pos, 1); else cur.push(idx);
      ans.selected = cur.sort((x, y) => x - y);
    } else {
      ans.selected = idx;
    }
    renderExam();
  });

  attachTimers();
}

/* navigation funcs */
window.nextQ = () => { finalizeTime(); session.qIndex = Math.min(session.qIndex + 1, session.testData.questions.length - 1); renderExam(); };
window.prevQ = () => { finalizeTime(); session.qIndex = Math.max(session.qIndex - 1, 0); renderExam(); };
window.jumpQ = (i) => { finalizeTime(); session.qIndex = i; renderExam(); };

window.clearQ = () => {
  const q = session.testData.questions[session.qIndex];
  session.answers[q.id].selected = null;
  renderExam();
};

window.toggleStar = () => {
  const q = session.testData.questions[session.qIndex];
  session.answers[q.id].starred = !session.answers[q.id].starred;
  renderExam();
};

window.backToCert = () => {
  if (!session) return;
  const ok = confirm("Leave the test? Your progress will be lost (no autosave).");
  if (!ok) return;
  if (timerHandle) clearInterval(timerHandle);
  const certId = session.certId;
  session = null;
  location.hash = `#/practice/${certId}`;
};

window.exitToHome = () => {
  const ok = confirm("Exit to home? Your progress will be lost (no autosave).");
  if (!ok) return;
  if (timerHandle) clearInterval(timerHandle);
  session = null;
  location.hash = "#/practice";
};

window.submitExam = () => {
  finalizeTime();

  const remaining = unansweredCount();
  if (remaining > 0) {
    const ok = confirm(`You still have ${remaining} unanswered question(s). Submit anyway?`);
    if (!ok) return;
  }

  const test = session.testData;
  let correct = 0;
  test.questions.forEach(q => {
    const sel = session.answers[q.id].selected;
    if (equalAnswer(q, sel)) correct++;
  });

  session.submitted = true;
  session.submittedAt = Date.now();
  session.score = { correct, total: test.questions.length };
  if (timerHandle) clearInterval(timerHandle);

  review = { mode: "all", page: 0, openGlobalIndex: null };
  renderReview();
};

function renderReview() {
  const cert = findCert(session.certId);

  const totalMs = session.submittedAt - session.startedAt;
  const percent = Math.round((session.score.correct / session.score.total) * 100);

  const items = reviewFilteredItems();
  clampReviewPage(items);
  const pc = reviewPageCount(items);

  const startN = items.length ? (review.page * REVIEW_PAGE_SIZE + 1) : 0;
  const endN = Math.min(items.length, review.page * REVIEW_PAGE_SIZE + REVIEW_PAGE_SIZE);

  const crumbs = [
    { label: "Practice", href: "#/practice" },
    { label: cert.name, href: `#/practice/${session.certId}` },
    { label: session.testMeta.title, href: `#/practice/${session.certId}` },
    { label: "Results" }
  ];

  pageShell(
    `<div class="hd">
      <h2>Results</h2>
      <span class="pill">${escapeHtml(cert.name)} • ${escapeHtml(session.testMeta.title)}</span>
    </div>
    <div class="bd">
      <div class="summaryCard">
        <div>
          <div class="muted small">Score</div>
          <div class="summaryMain">${session.score.correct}/${session.score.total}</div>
          <div class="muted small">${percent}% • ${fmtMs(totalMs)}</div>
        </div>
        <div class="summaryRight">
          <span class="pill">${percent}%</span>
        </div>
      </div>

      <div class="pager pagerMain">
        <button onclick="reviewPrevPage()" ${review.page === 0 ? "disabled" : ""}>Prev page</button>
        <div class="muted small">
          Showing ${startN}-${endN} of ${items.length} • Page ${review.page + 1}/${pc}
        </div>
        <button onclick="reviewNextPage()" ${review.page >= pc - 1 ? "disabled" : ""}>Next page</button>
      </div>

      <div class="reviewBlocks">
        ${renderReviewPageBlocks()}
      </div>

      <div class="reviewBottomNav">
        <button onclick="reviewPrevQ()">Previous question</button>
        <button class="primary" onclick="reviewNextQ()">Next question</button>
        <button onclick="location.hash='#/practice/${session.certId}'">Back to tests</button>
        <button class="danger" onclick="restartExam()">Restart</button>
      </div>
    </div>`,
    renderReviewSidebar(),
    crumbs
  );

  attachReviewAccordion();
}

window.restartExam = async () => {
  await startOrResumeSession(session.certId, session.testId);
  renderExam();
};

function render404() {
  pageShell(
    `<div class="hd"><h2>Not found</h2><span class="pill">404</span></div>
     <div class="bd"><a class="pill" href="#/practice">Go home</a></div>`,
    `<div class="hd"><h3>Status</h3></div><div class="bd"><div class="muted">No info.</div></div>`,
    [{ label: "Practice", href: "#/practice" }, { label: "Not found" }]
  );
}

async function render() {
  const r = route();
  const parts = r.split("/").filter(Boolean);

  if (parts.length === 1 && parts[0] === "practice") return renderPracticeHome();
  if (parts[0] === "practice" && parts[1]) return renderCertification(parts[1]);

  if (parts[0] === "exam" && parts[2] === "test" && parts[1] && parts[3]) {
    await startOrResumeSession(parts[1], parts[3]);
    return renderExam();
  }

  render404();
}

async function safeRender() {
  try { await render(); }
  catch (e) { showFatal(e); }
}

async function loadManifest() {
  APP_BASE_URL = new URL(document.baseURI);
  const candidates = ["data/manifest.json", "./data/manifest.json"];

  let lastErr = null;
  for (const c of candidates) {
    try {
      const url = new URL(c, APP_BASE_URL).toString();
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastErr = new Error(`Failed to load ${url}: ${res.status}`);
        continue;
      }
      manifest = await res.json();
      MANIFEST_URL = url;
      DATA_BASE_URL = new URL("./", url);
      return;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Failed to load data/manifest.json");
}

async function boot() {
  initTheme();
  await loadManifest();

  if (!manifest || !manifest.certifications) {
    throw new Error("Invalid manifest.json (missing certifications)");
  }

  renderCertMenu();
  window.addEventListener("hashchange", safeRender);
  await safeRender();
}

boot().catch(showFatal);
