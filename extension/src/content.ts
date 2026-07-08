import { getSettings, onSettingsChanged, Api, type Settings } from './api.js';
import { type Cue } from './captions.js';

let currentVideoId: string | null = null;
let currentTitle = '';
let cues: Cue[] = [];
let settings: Settings;
let activeIndex = -1;
let syncTimer: number | null = null;
const selected = new Set<number>(); // indices selected for cross-segment saving

// ---------- inject page-context script ----------
function injectPageScript() {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
}

function requestScan() {
  window.postMessage({ source: 'ytlingo-content', type: 'REQUEST' }, '*');
}

// ---------- DOM helpers ----------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- panel ----------
let panel: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let toolbarEl: HTMLElement | null = null;
let toolbarCountEl: HTMLElement | null = null;
let selBtn: HTMLElement | null = null; // floating "save selected text" button

function ensurePanel() {
  if (panel && document.body.contains(panel)) return;
  panel = el('div', 'ytlingo-panel');

  const header = el('div', 'ytlingo-header');
  header.appendChild(el('span', 'ytlingo-title', 'YT Lingo'));
  const collapseBtn = el('button', 'ytlingo-collapse', '—');
  collapseBtn.title = 'Collapse';
  collapseBtn.onclick = () => panel!.classList.toggle('ytlingo-collapsed');
  header.appendChild(collapseBtn);
  panel.appendChild(header);

  statusEl = el('div', 'ytlingo-status');
  panel.appendChild(statusEl);

  // Selection toolbar (shown when 1+ cues are checked).
  toolbarEl = el('div', 'ytlingo-toolbar');
  toolbarCountEl = el('span', 'ytlingo-tb-count', '');
  const saveSelBtn = el('button', 'ytlingo-mini ytlingo-save', '★ 收藏选中');
  saveSelBtn.onclick = () => void saveSelectedCues();
  const clearBtn = el('button', 'ytlingo-mini', '清除');
  clearBtn.onclick = clearSelection;
  toolbarEl.appendChild(toolbarCountEl);
  toolbarEl.appendChild(saveSelBtn);
  toolbarEl.appendChild(clearBtn);
  panel.appendChild(toolbarEl);

  listEl = el('div', 'ytlingo-list');
  panel.appendChild(listEl);

  // Partial selection: when the user highlights text inside the list, offer to
  // save just that phrase/word.
  listEl.addEventListener('mouseup', onTextSelected);

  // Floating button for saving the highlighted phrase.
  selBtn = el('button', 'ytlingo-selbtn', '★ 收藏所选');
  selBtn.style.display = 'none';
  panel.appendChild(selBtn);

  document.body.appendChild(panel);
  updateToolbar();
}

function getVideoEl(): HTMLVideoElement | null {
  return document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
}

function setStatus(msg: string, kind: 'info' | 'err' | 'ok' = 'info') {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = `ytlingo-status ytlingo-${kind}`;
}

// ---------- render cues ----------
function makeCueRow(cue: Cue, i: number): HTMLElement {
  const row = el('div', 'ytlingo-cue');
  row.dataset.index = String(i);

  const top = el('div', 'ytlingo-cue-top');

  // Checkbox for cross-segment (multi-line) selection.
  const check = el('input', 'ytlingo-check') as HTMLInputElement;
  check.type = 'checkbox';
  check.checked = selected.has(i);
  check.onclick = (e) => {
    e.stopPropagation();
    if (check.checked) selected.add(i);
    else selected.delete(i);
    updateToolbar();
  };
  top.appendChild(check);

  const textEl = el('div', 'ytlingo-cue-text', cue.text);
  top.appendChild(textEl);
  row.appendChild(top);

  const actions = el('div', 'ytlingo-actions');
  const jumpBtn = el('button', 'ytlingo-mini', '▶ Play');
  jumpBtn.onclick = (e) => {
    e.stopPropagation();
    const v = getVideoEl();
    if (v) {
      v.currentTime = cue.start;
      v.play().catch(() => {});
    }
  };
  const saveBtn = el('button', 'ytlingo-mini ytlingo-save', '★ Save');
  saveBtn.onclick = (e) => {
    e.stopPropagation();
    void saveCue(cue.text, cue.start, saveBtn, actions);
  };
  actions.appendChild(jumpBtn);
  actions.appendChild(saveBtn);
  row.appendChild(actions);

  // Clicking the text area (not the checkbox) expands the row.
  textEl.onclick = () => row.classList.toggle('ytlingo-expanded');
  return row;
}

function renderCues() {
  if (!listEl) return;
  listEl.innerHTML = '';
  cues.forEach((cue, i) => listEl!.appendChild(makeCueRow(cue, i)));
}

// ---------- core save ----------
async function postVocab(text: string, startTime: number): Promise<string> {
  const { item } = await Api.addVocab({
    text,
    targetLang: settings.targetLang,
    videoId: currentVideoId || undefined,
    videoTitle: currentTitle || undefined,
    startTime,
  });
  return item.translation || '';
}

async function saveCue(text: string, startTime: number, btn: HTMLButtonElement, actions: HTMLElement) {
  if (!settings.token) {
    setStatus('请先在扩展弹窗里登录', 'err');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const translation = await postVocab(text, startTime);
    btn.textContent = '✓ Saved';
    btn.classList.add('ytlingo-saved');
    if (translation) {
      let tr = actions.parentElement!.querySelector('.ytlingo-translation') as HTMLElement | null;
      if (!tr) {
        tr = el('div', 'ytlingo-translation');
        actions.parentElement!.insertBefore(tr, actions);
      }
      tr.textContent = translation;
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '★ Save';
    setStatus((err as Error).message || 'Save failed', 'err');
  }
}

// ---------- cross-segment (multi-line) selection ----------
function updateToolbar() {
  if (!toolbarEl || !toolbarCountEl) return;
  const n = selected.size;
  toolbarEl.classList.toggle('ytlingo-show', n > 0);
  toolbarCountEl.textContent = `已选 ${n} 句`;
}

function clearSelection() {
  selected.clear();
  if (listEl) {
    listEl.querySelectorAll('input.ytlingo-check').forEach((c) => {
      (c as HTMLInputElement).checked = false;
    });
  }
  updateToolbar();
}

async function saveSelectedCues() {
  if (!settings.token) {
    setStatus('请先在扩展弹窗里登录', 'err');
    return;
  }
  if (!selected.size) return;
  const idxs = Array.from(selected).sort((a, b) => a - b);
  const text = idxs.map((i) => cues[i]?.text || '').join(' ').replace(/\s+/g, ' ').trim();
  const startTime = cues[idxs[0]]?.start ?? 0;
  setStatus('收藏中...', 'info');
  try {
    await postVocab(text, startTime);
    setStatus(`已收藏合并的 ${idxs.length} 句 ✓`, 'ok');
    clearSelection();
  } catch (err) {
    setStatus((err as Error).message || '收藏失败', 'err');
  }
}

// ---------- partial selection (save a phrase / word) ----------
function hideSelBtn() {
  if (selBtn) selBtn.style.display = 'none';
}

function onTextSelected() {
  if (!selBtn || !panel) return;
  const sel = window.getSelection();
  const text = (sel?.toString() || '').replace(/\s+/g, ' ').trim();
  if (!text || !sel || sel.rangeCount === 0) {
    hideSelBtn();
    return;
  }
  // Find which cue the selection belongs to (for the timestamp).
  let node: Node | null = sel.anchorNode;
  let rowEl: HTMLElement | null = null;
  while (node && node !== listEl) {
    if (node instanceof HTMLElement && node.classList?.contains('ytlingo-cue')) {
      rowEl = node;
      break;
    }
    node = node.parentNode;
  }
  const idx = rowEl ? Number(rowEl.dataset.index) : -1;
  const startTime = idx >= 0 && cues[idx] ? cues[idx].start : getVideoEl()?.currentTime || 0;

  // Position the floating button near the selection.
  const range = sel.getRangeAt(0).getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  selBtn.textContent = `★ 收藏所选：${text.length > 18 ? text.slice(0, 18) + '…' : text}`;
  selBtn.style.display = 'block';
  selBtn.style.top = `${range.bottom - panelRect.top + 6}px`;
  selBtn.style.left = `${Math.max(8, Math.min(range.left - panelRect.left, panelRect.width - 160))}px`;
  selBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!settings.token) {
      setStatus('请先在扩展弹窗里登录', 'err');
      return;
    }
    hideSelBtn();
    setStatus('收藏中...', 'info');
    try {
      await postVocab(text, startTime);
      setStatus(`已收藏片段「${text.length > 20 ? text.slice(0, 20) + '…' : text}」✓`, 'ok');
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      setStatus((err as Error).message || '收藏失败', 'err');
    }
  };
}

// Hide the floating button when clicking elsewhere.
document.addEventListener('mousedown', (e) => {
  if (selBtn && e.target !== selBtn) hideSelBtn();
});

// ---------- highlight sync ----------
function startSync() {
  stopSync();
  syncTimer = window.setInterval(() => {
    const v = getVideoEl();
    if (!v || !cues.length || !listEl) return;
    const t = v.currentTime;
    let idx = -1;
    for (let i = 0; i < cues.length; i++) {
      if (t >= cues[i].start && t < cues[i].end) {
        idx = i;
        break;
      }
      if (cues[i].start > t) break;
    }
    if (idx !== activeIndex) {
      const prev = listEl.querySelector('.ytlingo-active');
      if (prev) prev.classList.remove('ytlingo-active');
      if (idx >= 0) {
        const node = listEl.querySelector(`[data-index="${idx}"]`) as HTMLElement | null;
        if (node) {
          node.classList.add('ytlingo-active');
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
      activeIndex = idx;
    }
  }, 300);
}

function stopSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

// ---------- real-time caption capture (fallback when transcript API is blocked) ----------
let captionObserver: MutationObserver | null = null;
let observerAttachTimer: number | null = null;
let lastCaptured = '';

function stopLiveCapture() {
  if (captionObserver) {
    captionObserver.disconnect();
    captionObserver = null;
  }
  if (observerAttachTimer) {
    clearInterval(observerAttachTimer);
    observerAttachTimer = null;
  }
}

function readRenderedCaption(): string {
  const segs = document.querySelectorAll('.ytp-caption-segment');
  return Array.from(segs)
    .map((s) => s.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function captureTick() {
  const text = readRenderedCaption();
  if (!text || text === lastCaptured) return;
  // Skip if the new text is just a growing prefix/suffix of the last (same line updating).
  if (lastCaptured && (text.startsWith(lastCaptured) || lastCaptured.startsWith(text))) {
    // update the last cue's text instead of adding a new one
    if (cues.length) {
      cues[cues.length - 1].text = text;
      const lastRow = listEl?.lastElementChild?.querySelector('.ytlingo-cue-text');
      if (lastRow) lastRow.textContent = text;
      lastCaptured = text;
      return;
    }
  }
  lastCaptured = text;
  const v = getVideoEl();
  const start = v ? v.currentTime : 0;
  if (cues.length) cues[cues.length - 1].end = start;
  const cue: Cue = { start, end: start + 5, text };
  cues.push(cue);
  if (listEl) {
    listEl.appendChild(makeCueRow(cue, cues.length - 1));
    listEl.scrollTop = listEl.scrollHeight;
  }
}

function startLiveCapture() {
  ensurePanel();
  stopSync();
  stopLiveCapture();
  cues = [];
  lastCaptured = '';
  selected.clear();
  updateToolbar();
  if (listEl) listEl.innerHTML = '';
  setStatus('实时模式：播放视频，字幕会逐句出现在这里 ▶', 'ok');

  const attach = () => {
    const container =
      (document.querySelector('.ytp-caption-window-container') as HTMLElement | null) ||
      (document.querySelector('#movie_player') as HTMLElement | null);
    if (!container) return false;
    captionObserver = new MutationObserver(() => captureTick());
    captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
    return true;
  };

  if (!attach()) {
    // Player/caption container not ready yet — retry briefly.
    observerAttachTimer = window.setInterval(() => {
      if (attach()) {
        clearInterval(observerAttachTimer!);
        observerAttachTimer = null;
      }
    }, 700);
  }
}

// ---------- load cues delivered directly from the transcript API ----------
function loadCuesDirect(newCues: Cue[]) {
  ensurePanel();
  stopLiveCapture();
  cues = newCues;
  activeIndex = -1;
  selected.clear();
  renderCues();
  updateToolbar();
  if (!cues.length) {
    setStatus('Caption track is empty for this video.', 'err');
    return;
  }
  if (!settings.token) {
    setStatus(`${cues.length} lines · log in via the popup to save`, 'info');
  } else {
    setStatus(`${cues.length} lines · saving to ${settings.targetLang}`, 'ok');
  }
  startSync();
}

// ---------- message from page context ----------
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'ytlingo-inject') return;

  if (data.type === 'CUES') {
    if (data.videoId && data.videoId !== currentVideoId) {
      currentVideoId = data.videoId;
      currentTitle = data.title || '';
      loadCuesDirect(data.cues || []);
    }
  } else if (data.type === 'LIVE') {
    if (data.videoId && data.videoId !== currentVideoId) {
      currentVideoId = data.videoId;
      currentTitle = data.title || '';
      startLiveCapture();
    }
  } else if (data.type === 'NO_CAPTIONS') {
    currentVideoId = data.videoId;
    currentTitle = data.title || '';
    ensurePanel();
    stopLiveCapture();
    setStatus('This video has no captions/subtitles.', 'err');
  }
});

// ---------- watch-page detection (handles SPA navigation) ----------
function isWatchPage(): boolean {
  return location.pathname === '/watch' && new URLSearchParams(location.search).has('v');
}

let lastUrl = '';
function onLocationMaybeChanged() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  if (isWatchPage()) {
    ensurePanel();
    setStatus('Detecting captions...');
    requestScan();
  } else {
    // Not a watch page: remove the panel.
    if (panel) {
      panel.remove();
      panel = null;
      listEl = null;
      statusEl = null;
    }
    currentVideoId = null;
    stopSync();
    stopLiveCapture();
  }
}

// ---------- boot ----------
async function boot() {
  settings = await getSettings();
  onSettingsChanged((s) => {
    settings = s;
  });
  injectPageScript();

  // React to YouTube's SPA navigation + as a fallback, poll the URL.
  window.addEventListener('yt-navigate-finish', () => setTimeout(onLocationMaybeChanged, 200));
  setInterval(onLocationMaybeChanged, 1000);
  onLocationMaybeChanged();
}

void boot();
