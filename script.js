/* ============================================
   SAMYAK PYTHON RESULT PORTAL v1 — script.js
   Features: Advanced Search, Image Share,
   WhatsApp Share, Skeleton Loader, Scroll
   Animations, Security, Concurrency-safe,
   Proper PDF export, Toast notifications
============================================ */

const API_ENDPOINT = "https://script.google.com/macros/s/AKfycbxtSTHI3CRmIvfFwbrqIcDHWmhSNFuhAeiufKW7OoSfgb2Axn2udh1BPS3fsSPCiTsi/exec";

const CONFIG = {
  fetchTimeout: 30000,
  maxConcurrent: 1,   // prevent duplicate fetches
  rateLimitMs: 1500,  // min ms between searches
};

/* ===============================
   STATE / SECURITY
=============================== */
let _isFetching       = false;
let _lastFetchTime    = 0;
let _currentStudentData = null;
let _abortController  = null;

/* ===============================
   NORMALIZE STUDENT ID
=============================== */
function normalizeStudentId(value) {
  if (!value) return '';
  let v = String(value).trim().toUpperCase();
  // Pure digits
  if (/^\d+$/.test(v)) return 'SMYK/VM-' + v.padStart(3, '0');
  // VM-001
  if (/^VM-\d+$/.test(v)) return 'SMYK/' + v;
  // Partial like SMYK/VM-1
  const m = v.match(/(\d+)$/);
  if (m && /^SMYK\/?VM-?\d+$/.test(v)) return 'SMYK/VM-' + m[1].padStart(3, '0');
  return v;
}

/* ===============================
   SANITIZE (XSS prevention)
=============================== */
function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '—';
}

/* ===============================
   ADVANCED SEARCH — SUGGESTIONS
=============================== */
// Local suggestion cache (populated from search history / known patterns)
const _suggestionPatterns = [
  { label: 'SMYK/VM-001', type: 'ID' },
  { label: 'SMYK/VM-002', type: 'ID' },
  { label: 'SMYK/VM-003', type: 'ID' },
];

function handleSearchInput(val) {
  const sugBox = document.getElementById('searchSuggestions');
  if (!sugBox) return;

  const trimmed = val.trim();
  if (trimmed.length < 2) {
    sugBox.style.display = 'none';
    return;
  }

  // Generate dynamic suggestions
  const suggestions = [];
  const upper = trimmed.toUpperCase();

  // Numeric → suggest padded ID
  if (/^\d+$/.test(trimmed)) {
    const padded = trimmed.padStart(3, '0');
    suggestions.push({ label: `SMYK/VM-${padded}`, type: 'ID' });
  }

  // VM- pattern
  if (upper.startsWith('VM-') || upper.startsWith('VM')) {
    const num = upper.replace('VM-', '').replace('VM', '');
    if (num) suggestions.push({ label: `SMYK/VM-${num.padStart(3,'0')}`, type: 'ID' });
  }

  // SMYK pattern
  if (upper.startsWith('SMYK')) {
    suggestions.push({ label: normalizeStudentId(trimmed), type: 'ID' });
  }

  // Name / mobile hint
  if (trimmed.length >= 3 && !/^\d/.test(trimmed)) {
    suggestions.push({ label: trimmed, type: 'Name' });
  }
  if (/^\d{7,}$/.test(trimmed)) {
    suggestions.push({ label: trimmed, type: 'Mobile' });
  }

  // Add pattern suggestions
  _suggestionPatterns.forEach(p => {
    if (p.label.includes(upper) && !suggestions.find(s => s.label === p.label)) {
      suggestions.push(p);
    }
  });

  if (suggestions.length === 0) {
    sugBox.style.display = 'none';
    return;
  }

  sugBox.innerHTML = suggestions.slice(0, 5).map(s => `
    <div class="suggestion-item" onclick="fillSearch('${sanitize(s.label)}')">
      <span class="sug-icon">${s.type === 'ID' ? '🪪' : s.type === 'Mobile' ? '📱' : '👤'}</span>
      <span>${sanitize(s.label)}</span>
      <span class="suggestion-type">${s.type}</span>
    </div>
  `).join('');
  sugBox.style.display = 'block';
}

function fillSearch(val) {
  const inp = document.getElementById('studentId');
  if (inp) { inp.value = val; }
  const sugBox = document.getElementById('searchSuggestions');
  if (sugBox) sugBox.style.display = 'none';
  getResult();
}

// Close suggestions on outside click
document.addEventListener('click', (e) => {
  const sugBox = document.getElementById('searchSuggestions');
  if (sugBox && !e.target.closest('.search-input-wrap')) {
    sugBox.style.display = 'none';
  }
});

/* ===============================
   MAIN FETCH FUNCTION (rate-limited, concurrency-safe)
=============================== */
async function getResult() {
  // Concurrency guard
  if (_isFetching) {
    showToast('⏳ Please wait, fetching result…');
    return;
  }

  // Rate limit
  const now = Date.now();
  if (now - _lastFetchTime < CONFIG.rateLimitMs) {
    showToast('🔄 Too fast! Please wait a moment.');
    return;
  }

  const rawId     = (document.getElementById('studentId').value || '').trim();
  const studentId = normalizeStudentId(rawId);

  // Input validation
  if (!studentId) {
    showError('⚠️ Please enter a valid Student ID, Name, or Mobile number.');
    return;
  }
  if (studentId.length > 100) {
    showError('⚠️ Input too long. Please check and try again.');
    return;
  }

  // Close suggestions
  const sugBox = document.getElementById('searchSuggestions');
  if (sugBox) sugBox.style.display = 'none';

  _isFetching    = true;
  _lastFetchTime = now;

  showSkeleton(true);
  hideError();
  hideResultSection();
  hideResultBanner();

  // Abort previous request if any
  if (_abortController) _abortController.abort();
  _abortController = new AbortController();
  const signal = _abortController.signal;

  try {
    const url = `${API_ENDPOINT}?studentId=${encodeURIComponent(studentId)}&t=${now}`;

    const timeoutId = setTimeout(() => _abortController.abort(), CONFIG.fetchTimeout);

    const response = await fetch(url, {
      method:  'GET',
      cache:   'no-store',
      headers: { 'Accept': 'application/json' },
      signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('Server error: ' + response.status);

    const data = await response.json();

    if (!data || data.error) {
      showError(data?.error || '❌ Student not found. Please check your Student ID.');
      return;
    }

    // Store for sharing
    _currentStudentData = data;

    renderResultCard(data);
    renderCertificate(data);
    showResultSection();
    showResultBanner(data);
    showHeaderActions();

    if ((data.result || '').toUpperCase() === 'PASS') startConfetti();

    showToast('✅ Result loaded successfully!');

  } catch (err) {
    if (err.name === 'AbortError') {
      showError('⏱️ Request timed out. Please try again.');
    } else {
      console.error('❌ Fetch error:', err);
      showError('❌ ' + (err.message || 'Something went wrong. Please try again.'));
    }
  } finally {
    _isFetching = false;
    showSkeleton(false);
  }
}

/* ===============================
   RENDER RESULT CARD
=============================== */
function renderResultCard(data) {
  const name   = data.name || 'Student';
  const result = (data.result || '').toUpperCase();
  const isPass = result === 'PASS';

  safeText('studentName',      name);
  safeText('studentId-display', data.id);
  safeText('mobileDisplay',    data.mobile);
  safeText('emailDisplay',     data.email);
  safeText('batchDisplay',     data.batch);

  const initEl = document.getElementById('studentInitial');
  if (initEl) initEl.textContent = name.charAt(0).toUpperCase();

  // Grand total & summary
  safeText('grandTotalDisplay',  `${data.grandTotal ?? 0}/100`);
  safeText('percentageDisplay',  `${Number(data.percentage || 0).toFixed(2)}%`);
  safeText('gradeDisplay',       data.grade);

  const resultEl = document.getElementById('resultDisplay');
  if (resultEl) {
    resultEl.textContent = result || '—';
    resultEl.className   = 'result-badge ' + (isPass ? 'pass' : result ? 'fail' : '');
  }

  // Quick badge
  const badge = document.getElementById('quickBadge');
  if (badge) {
    badge.textContent = isPass ? '✅ PASS' : (result === 'FAIL' ? '❌ FAIL' : '—');
    badge.className   = 'result-quick-badge ' + (isPass ? 'pass' : result === 'FAIL' ? 'fail' : '');
  }

    const mcqScore = data.mcqScore ?? data.mcq ?? 0;
  const practicalScore = data.practicalTotal ?? 0;

  // MCQ
  safeText('mcqScoreDisplay', mcqScore);
  safeText('mcqTotalDisplay', `${mcqScore}/50`);

  // Practical
  safeText('practicalScoreDisplay', practicalScore);
  safeText('practicalTotalDisplay', `${practicalScore}/50`);

  // Animated progress bars
  requestAnimationFrame(() => {
    setBar('barMcq', mcqScore, 50);
    setBar('barPractical', practicalScore, 50);
  });
}

function setBar(id, obtained, max) {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = Math.min(100, Math.max(0, (Number(obtained) / max) * 100));
  setTimeout(() => { el.style.width = pct + '%'; }, 80);
}

/* ===============================
   RENDER CERTIFICATE
=============================== */
function renderCertificate(data) {
  const result = (data.result || '').toUpperCase();
  const isPass = result === 'PASS';

  const passBlock = document.getElementById('certPassBlock');
  const failBlock = document.getElementById('certFailBlock');
  if (passBlock) passBlock.style.display = isPass ? '' : 'none';
  if (failBlock) failBlock.style.display = isPass ? 'none' : '';

  safeText('certStudentName',     data.name);
  safeText('certStudentNameFail', data.name);
  safeText('certStudentId',       data.id);
  safeText('certGrandTotal',      `${data.grandTotal ?? 0}/100`);
  safeText('certPercentage',      `${Number(data.percentage || 0).toFixed(2)}%`);
  safeText('certGrade',           data.grade);

  const certResultEl   = document.getElementById('certResult');
  const certResultPill = document.getElementById('certResultPill');
  if (certResultEl) {
    certResultEl.textContent = result || '—';
    certResultEl.className   = 'pill-value cert-result-val ' + (isPass ? 'pass' : 'fail');
  }
  if (certResultPill) {
    certResultPill.className = 'cert-mark-pill cert-result-pill ' + (isPass ? 'pass' : 'fail');
  }

  // Date
  const today = new Date().toLocaleDateString('en-IN', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  safeText('certDate', today);

  // IDs (stable per session per student)
  const idSlug = (data.id || 'XX').replace(/\//g, '-');
  const seed   = Date.now().toString().slice(-6);
  safeText('certNumber',  `CERT-${idSlug}-${seed}`);
  safeText('certVerifNo', `VN-${idSlug}-${seed.slice(-4)}`);
}

/* ===============================
   RESULT BANNER
=============================== */
function showResultBanner(data) {
  const banner  = document.getElementById('resultBanner');
  if (!banner) return;
  const isPass  = (data.result || '').toUpperCase() === 'PASS';
  const name    = data.name || 'Student';
  const pct     = Number(data.percentage || 0).toFixed(2);
  banner.innerHTML = isPass
    ? `🎉 Congratulations <strong>${sanitize(name)}</strong>! You have <strong>PASSED</strong> with <strong>${pct}%</strong> — Grade: <strong>${sanitize(data.grade || '—')}</strong>`
    : `📋 Result for <strong>${sanitize(name)}</strong>: Unfortunately <strong>NOT PASSED</strong> this time. Score: <strong>${pct}%</strong>. Better luck next attempt!`;
  banner.className = 'result-banner ' + (isPass ? 'pass' : 'fail');
  banner.style.display = 'block';
}

function hideResultBanner() {
  const el = document.getElementById('resultBanner');
  if (el) { el.style.display = 'none'; el.className = 'result-banner'; }
}

/* ===============================
   HEADER ACTIONS
=============================== */
function showHeaderActions() {
  const el = document.getElementById('headerActions');
  if (el) el.style.display = 'flex';
}

/* ===============================
   UI HELPERS
=============================== */
function showSkeleton(show) {
  const skel = document.getElementById('skeletonLoader');
  const btn  = document.getElementById('searchBtn');
  if (skel) skel.style.display = show ? 'flex' : 'none';
  if (btn)  btn.disabled = show;
}

function showError(msg) {
  const el = document.getElementById('errorMessage');
  if (!el) return;
  el.textContent   = msg;
  el.style.display = 'block';
}

function hideError() {
  const el = document.getElementById('errorMessage');
  if (el) el.style.display = 'none';
}

function showResultSection() {
  const el = document.getElementById('resultSection');
  if (!el) return;
  el.style.display = 'block';
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}

function hideResultSection() {
  const el = document.getElementById('resultSection');
  if (el) el.style.display = 'none';
}

/* ===============================
   TOAST
=============================== */
let _toastTimer = null;
function showToast(msg, duration = 2800) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id        = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent   = msg;
  toast.style.display = 'block';
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.style.display = 'none'; }, 400);
  }, duration);
}

/* ===============================
   SCROLL ANIMATIONS (Intersection Observer)
=============================== */
function initScrollReveal() {
  if (!('IntersectionObserver' in window)) {
    // Fallback: just make everything visible
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

/* ===============================
   KEYBOARD & DOM READY
=============================== */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('studentId');
  if (input) {
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') getResult(); });
    input.focus();
  }
  initScrollReveal();
});

/* ===============================
   PDF HELPERS — PROPER FULL-PAGE EXPORT
   (clones element, removes action buttons,
    fits to page without cut-off)
=============================== */
function _pdfClone(sourceId, hideSelectors = []) {
  const source = document.getElementById(sourceId);
  if (!source) return null;
  const clone = source.cloneNode(true);
  // Remove buttons inside clone
  hideSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  });
  clone.style.cssText = 'position:relative;width:100%;margin:0;padding:0;';
  return clone;
}

/* ===============================
   PDF — REPORT CARD (portrait A4, no cut-off)
=============================== */
function downloadReportCardPDF() {
  const name = (document.getElementById('studentName')?.textContent || 'student').replace(/\s+/g,'_');
  const el   = document.getElementById('reportCardSection');
  if (!el) { showToast('⚠️ Report card not available.'); return; }

  showToast('📄 Generating PDF…');

  const clone = _pdfClone('reportCardSection', ['.action-buttons', '.btn-secondary']);
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'background:#ffffff;padding:24px;font-family:Segoe UI,system-ui,sans-serif;';
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  wrapper.style.position = 'absolute';
  wrapper.style.left     = '-9999px';
  wrapper.style.top      = '0';
  wrapper.style.width    = '794px'; // A4 width at 96dpi

  const opt = {
    margin:      [10, 10, 10, 10],
    filename:    `ReportCard_${name}.pdf`,
    image:       { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: 794,
    },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak:   { mode: ['avoid-all', 'css', 'legacy'] },
  };

  html2pdf().set(opt).from(wrapper).save()
    .then(() => {
      document.body.removeChild(wrapper);
      showToast('✅ Report Card PDF downloaded!');
    })
    .catch(() => {
      document.body.removeChild(wrapper);
      showToast('❌ PDF generation failed. Please retry.');
    });
}

/* ===============================
   PDF — CERTIFICATE (landscape A4, no cut-off)
=============================== */
function downloadCertificatePDF() {
  const name = (document.getElementById('certStudentName')?.textContent || 'student').replace(/\s+/g,'_');
  const el   = document.getElementById('certificateEl');
  if (!el) { showToast('⚠️ Certificate not available.'); return; }

  showToast('🎓 Generating Certificate PDF…');

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'background:#fffef9;position:absolute;left:-9999px;top:0;width:1122px;';
  const clone = el.cloneNode(true);
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  const opt = {
    margin:      [8, 8, 8, 8],
    filename:    `Certificate_${name}.pdf`,
    image:       { type: 'jpeg', quality: 0.99 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#fffef9',
      scrollX: 0,
      scrollY: 0,
      windowWidth: 1122,
    },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'landscape' },
    pagebreak:   { mode: ['avoid-all'] },
  };

  html2pdf().set(opt).from(wrapper).save()
    .then(() => {
      document.body.removeChild(wrapper);
      showToast('✅ Certificate PDF downloaded!');
    })
    .catch(() => {
      document.body.removeChild(wrapper);
      showToast('❌ PDF generation failed. Please retry.');
    });
}

/* ===============================
   IMAGE CAPTURE HELPER
   Returns a Promise<dataURL>
=============================== */
function _captureImage(elementId, bgColor = '#ffffff', scaleW = null) {
  const el = document.getElementById(elementId);
  if (!el) return Promise.reject('Element not found: ' + elementId);

  // Temporarily clone off-screen for clean capture
  const clone = el.cloneNode(true);
  clone.style.cssText = `position:absolute;left:-9999px;top:0;background:${bgColor};`;
  if (scaleW) clone.style.width = scaleW + 'px';
  document.body.appendChild(clone);

  return html2canvas(clone, {
    scale: 2.5,
    useCORS: true,
    allowTaint: true,
    backgroundColor: bgColor,
    scrollX: 0,
    scrollY: 0,
    logging: false,
  }).then(canvas => {
    document.body.removeChild(clone);
    return canvas.toDataURL('image/png', 1.0);
  }).catch(err => {
    document.body.removeChild(clone);
    throw err;
  });
}

/* ===============================
   DOWNLOAD IMAGE — REPORT CARD
=============================== */
function downloadReportCardImage() {
  showToast('🖼️ Capturing report card…');
  _captureImage('reportCardSection', '#ffffff', 800)
    .then(dataUrl => {
      const name = (document.getElementById('studentName')?.textContent || 'student').replace(/\s+/g,'_');
      const link = document.createElement('a');
      link.download = `ReportCard_${name}.png`;
      link.href     = dataUrl;
      link.click();
      showToast('✅ Report Card image saved!');
    })
    .catch(() => showToast('❌ Image capture failed. Please retry.'));
}

/* ===============================
   DOWNLOAD IMAGE — CERTIFICATE
=============================== */
function downloadCertificateImage() {
  showToast('🏅 Capturing certificate…');
  _captureImage('certificateEl', '#fffef9', 1100)
    .then(dataUrl => {
      const name = (document.getElementById('certStudentName')?.textContent || 'student').replace(/\s+/g,'_');
      const link = document.createElement('a');
      link.download = `Certificate_${name}.png`;
      link.href     = dataUrl;
      link.click();
      showToast('✅ Certificate image saved!');
    })
    .catch(() => showToast('❌ Image capture failed. Please retry.'));
}

/* ===============================
   WHATSAPP SHARE — REPORT CARD IMAGE
   Captures → downloads PNG → prompts user
   to attach the saved image on WhatsApp
=============================== */
function shareReportWhatsApp() {
  if (!_currentStudentData) { showToast('⚠️ No result loaded.'); return; }
  showToast('📸 Preparing Report Card image…');

  _captureImage('reportCardSection', '#ffffff', 800)
    .then(dataUrl => {
      const name  = (_currentStudentData.name || 'student').replace(/\s+/g,'_');
      const link  = document.createElement('a');
      link.download = `ReportCard_${name}.png`;
      link.href     = dataUrl;
      link.click();

      // Short delay then open WhatsApp
      setTimeout(() => {
        const msg = encodeURIComponent(
          `📋 *Python Programming Exam 2026 — Report Card*\n` +
          `👤 Student: ${_currentStudentData.name || '—'}\n` +
          `🪪 ID: ${_currentStudentData.id || '—'}\n` +
          `📊 Score: ${_currentStudentData.grandTotal ?? '—'}/100  |  ${Number(_currentStudentData.percentage||0).toFixed(2)}%\n` +
          `🏅 Grade: ${_currentStudentData.grade || '—'}  |  Result: ${(_currentStudentData.result||'').toUpperCase()}\n\n` +
          `📎 Please attach the downloaded image (ReportCard_${name}.png) to this chat.\n` +
          `— SAMYAK Computer Classes, Osian Enterprise`
        );
        window.open(`https://wa.me/?text=${msg}`, '_blank');
        showToast('✅ Image saved! Attach it on WhatsApp.');
      }, 1200);
    })
    .catch(() => showToast('❌ Image capture failed. Please retry.'));
}

/* ===============================
   WHATSAPP SHARE — CERTIFICATE IMAGE
=============================== */
function shareCertificateWhatsApp() {
  if (!_currentStudentData) { showToast('⚠️ No result loaded.'); return; }
  showToast('📸 Preparing Certificate image…');

  _captureImage('certificateEl', '#fffef9', 1100)
    .then(dataUrl => {
      const name  = (_currentStudentData.name || 'student').replace(/\s+/g,'_');
      const link  = document.createElement('a');
      link.download = `Certificate_${name}.png`;
      link.href     = dataUrl;
      link.click();

      setTimeout(() => {
        const result = (_currentStudentData.result || '').toUpperCase();
        const msg = encodeURIComponent(
          `🎓 *Python Programming Exam 2026 — ${result === 'PASS' ? 'Certificate of Achievement' : 'Result Card'}*\n` +
          `👤 Student: ${_currentStudentData.name || '—'}\n` +
          `🪪 ID: ${_currentStudentData.id || '—'}\n` +
          `📊 Score: ${_currentStudentData.grandTotal ?? '—'}/100  |  ${Number(_currentStudentData.percentage||0).toFixed(2)}%\n` +
          `🏅 Grade: ${_currentStudentData.grade || '—'}  |  ${result === 'PASS' ? '✅ PASSED' : '❌ NOT PASSED'}\n\n` +
          `📎 Please attach the downloaded image (Certificate_${name}.png) to this chat.\n` +
          `— SAMYAK Computer Classes, Osian Enterprise`
        );
        window.open(`https://wa.me/?text=${msg}`, '_blank');
        showToast('✅ Image saved! Attach it on WhatsApp.');
      }, 1200);
    })
    .catch(() => showToast('❌ Image capture failed. Please retry.'));
}

/* ===============================
   WHATSAPP SHARE — GENERAL RESULT (text)
   (used by header "Share" button)
=============================== */
function shareResultWhatsApp() {
  if (!_currentStudentData) { showToast('⚠️ No result loaded.'); return; }
  const d      = _currentStudentData;
  const result = (d.result || '').toUpperCase();
  const msg    = encodeURIComponent(
    `📢 *Python Programming Exam 2026 — Result*\n` +
    `👤 Name: ${d.name || '—'}\n` +
    `🪪 ID: ${d.id || '—'}\n` +
    `📊 Total: ${d.grandTotal ?? '—'}/100  |  ${Number(d.percentage||0).toFixed(2)}%\n` +
    `🏅 Grade: ${d.grade || '—'}  |  Result: ${result || '—'}\n` +
    `📅 Exam Year: 2026\n` +
    `🏫 SAMYAK Computer Classes — Osian Enterprise, Vadodara`
  );
  window.open(`https://wa.me/?text=${msg}`, '_blank');
  showToast('📲 Opening WhatsApp…');
}

/* ===============================
   CONFETTI ANIMATION (PASS only)
=============================== */
function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#5c35c8','#f5820a','#0e8a4a','#c8931a','#e040fb','#00bcd4','#ff4081'];
  const pieces = Array.from({ length: 160 }, () => ({
    x:        Math.random() * canvas.width,
    y:        Math.random() * canvas.height - canvas.height,
    w:        6  + Math.random() * 10,
    h:        4  + Math.random() * 6,
    color:    colors[Math.floor(Math.random() * colors.length)],
    rot:      Math.random() * 360,
    rotSpeed: (Math.random() - 0.5) * 5,
    speed:    2  + Math.random() * 3.5,
    drift:    (Math.random() - 0.5) * 1.8
  }));

  let frame = 0;
  const maxFrames = 220;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle   = p.color;
      ctx.globalAlpha = frame > 170 ? 1 - (frame - 170) / 50 : 0.88;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      p.y   += p.speed;
      p.x   += p.drift;
      p.rot += p.rotSpeed;
      if (p.y > canvas.height) { p.y = -20; p.x = Math.random() * canvas.width; }
    });
    frame++;
    if (frame < maxFrames) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }
  draw();
}

/* ===============================
   WINDOW RESIZE — fix confetti canvas
=============================== */
let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const canvas = document.getElementById('confetti-canvas');
    if (canvas && canvas.style.display !== 'none') {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
  }, 200);
});