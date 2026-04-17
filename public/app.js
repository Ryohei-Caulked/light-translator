/* global SpeechRecognition, webkitSpeechRecognition */

const els = {
  btnStartStop: document.getElementById("btnStartStop"),
  btnFullScreen: document.getElementById("btnFullScreen"),
  btnFontDown: document.getElementById("btnFontDown"),
  btnFontUp: document.getElementById("btnFontUp"),
  statusBadge: document.getElementById("statusBadge"),
  statusDetail: document.getElementById("statusDetail"),
  tabMain: document.getElementById("tabMain"),
  tabApi: document.getElementById("tabApi"),
  panelMain: document.getElementById("panelMain"),
  panelApi: document.getElementById("panelApi"),
  apiKey: document.getElementById("apiKey"),
  btnToggleKey: document.getElementById("btnToggleKey"),
  btnSaveKey: document.getElementById("btnSaveKey"),
  btnTestKey: document.getElementById("btnTestKey"),
  speechLang: document.getElementById("speechLang"),
  translateDelay: document.getElementById("translateDelay"),
  translateDelayValue: document.getElementById("translateDelayValue"),
  fontSize: document.getElementById("fontSize"),
  fontSizeValue: document.getElementById("fontSizeValue"),
  showOriginal: document.getElementById("showOriginal"),
  highContrast: document.getElementById("highContrast"),
  reduceMotion: document.getElementById("reduceMotion"),
  btnClear: document.getElementById("btnClear"),
  subtitleOriginal: document.getElementById("subtitleOriginal"),
  subtitleTranslated: document.getElementById("subtitleTranslated"),
  subtitleHint: document.getElementById("subtitleHint"),
  historyList: document.getElementById("historyList"),
  historyCount: document.getElementById("historyCount"),
  toast: document.getElementById("toast"),
  alert: document.getElementById("alert"),
};

const STORAGE_KEY = "lt.settings.v1";

const state = {
  running: false,
  apiKey: "",
  fontSize: 44,
  showOriginal: true,
  highContrast: false,
  reduceMotion: false,
  lastFinal: "",
  lastInterim: "",
  lastDispatched: "",
  interimTimer: null,
  finalBuffer: "",
  finalFlushTimer: null,
  recognition: null,
  restartTimer: null,
  restartAttempt: 0,
  busyCount: 0,
  speechLang: "",
  lastResultAt: 0,
  translateDelayMs: 1100,
  activeTab: "main",
  queue: Promise.resolve(),
  history: [],
};

function updateTopbarHeightVar() {
  const topbar = document.querySelector(".topbar");
  const h = topbar ? topbar.getBoundingClientRect().height : 74;
  document.documentElement.style.setProperty("--topbar-height", `${Math.round(h)}px`);
}

function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function setBadge(kind, label, detail) {
  els.statusBadge.textContent = label;
  els.statusBadge.style.borderColor =
    kind === "ok" ? "rgba(125, 255, 178, 0.6)" : kind === "warn" ? "rgba(255, 209, 102, 0.6)" : "var(--panel-border)";
  els.statusDetail.textContent = detail || "";
}

let toastTimer = null;
function showToast(text) {
  if (!text) return;
  els.toast.textContent = text;
  els.toast.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.style.display = "none"), 2600);
}

let alertTimer = null;
function showAlert(text) {
  if (!text) return;
  els.alert.textContent = text;
  els.alert.style.display = "block";
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => (els.alert.style.display = "none"), 5200);
}

function saveSettings() {
  const payload = {
    apiKey: state.apiKey,
    speechLang: state.speechLang,
    translateDelayMs: state.translateDelayMs,
    activeTab: state.activeTab,
    fontSize: state.fontSize,
    showOriginal: state.showOriginal,
    highContrast: state.highContrast,
    reduceMotion: state.reduceMotion,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.apiKey === "string") state.apiKey = s.apiKey;
    if (typeof s.speechLang === "string") state.speechLang = s.speechLang;
    if (Number.isFinite(s.translateDelayMs)) state.translateDelayMs = s.translateDelayMs;
    if (s.activeTab === "main" || s.activeTab === "api") state.activeTab = s.activeTab;
    if (Number.isFinite(s.fontSize)) state.fontSize = s.fontSize;
    if (typeof s.showOriginal === "boolean") state.showOriginal = s.showOriginal;
    if (typeof s.highContrast === "boolean") state.highContrast = s.highContrast;
    if (typeof s.reduceMotion === "boolean") state.reduceMotion = s.reduceMotion;
  } catch {
    // ignore
  }
}

function applySettingsToUI() {
  els.apiKey.value = state.apiKey;
  if (els.speechLang) els.speechLang.value = state.speechLang || "";
  if (els.translateDelay) els.translateDelay.value = String(state.translateDelayMs);
  if (els.translateDelayValue) els.translateDelayValue.textContent = `${state.translateDelayMs}ms`;
  els.fontSize.value = String(state.fontSize);
  els.fontSizeValue.textContent = `${state.fontSize}px`;
  document.documentElement.style.setProperty("--subtitle-size", `${state.fontSize}px`);
  els.showOriginal.checked = state.showOriginal;
  els.highContrast.checked = state.highContrast;
  els.reduceMotion.checked = state.reduceMotion;
  document.body.classList.toggle("high-contrast", state.highContrast);
  document.body.classList.toggle("reduce-motion", state.reduceMotion);
  els.subtitleOriginal.style.display = state.showOriginal ? "block" : "none";
  document.querySelector(".subtitles")?.setAttribute("data-contrast", state.highContrast ? "high" : "normal");
  applyTabToUI();
}

function applyTabToUI() {
  if (!els.tabMain || !els.tabApi || !els.panelMain || !els.panelApi) return;
  const isMain = state.activeTab !== "api";
  els.tabMain.setAttribute("aria-selected", isMain ? "true" : "false");
  els.tabApi.setAttribute("aria-selected", isMain ? "false" : "true");
  els.panelMain.hidden = !isMain;
  els.panelApi.hidden = isMain;
}

function setActiveTab(tab) {
  state.activeTab = tab === "api" ? "api" : "main";
  applyTabToUI();
  saveSettings();
}

function supportsSpeechRecognition() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function createRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  // Defaulting to the browser/OS language can make English recognition poor on Japanese machines.
  // Allow user to pin the recognition language for better capture quality.
  if (state.speechLang === "ja-JP" || state.speechLang === "en-US") {
    r.lang = state.speechLang;
  }
  return r;
}

function hasJapaneseChars(text) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

function looksEnglish(text) {
  // Simple heuristic: mostly Latin letters/numbers/punctuation/spaces.
  const t = text.trim();
  if (!t) return false;
  if (hasJapaneseChars(t)) return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const total = t.replace(/\s+/g, "").length;
  if (total === 0) return false;
  return letters / total > 0.55;
}

async function apiPost(path, payload) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

async function detectLanguage(text) {
  // 1) Fast heuristic first (lower cost, lower latency)
  if (hasJapaneseChars(text)) return { language: "ja", via: "heuristic" };
  if (looksEnglish(text)) return { language: "en", via: "heuristic" };

  // 2) Fallback to Google detection (more robust)
  const data = await apiPost("/api/detect", { apiKey: state.apiKey, text });
  const lang = data.language;
  if (lang === "ja" || lang === "en") return { language: lang, confidence: data.confidence, via: "google" };

  // Requirement: always classify as ja or en.
  return { language: hasJapaneseChars(text) ? "ja" : "en", confidence: data.confidence, via: "fallback" };
}

async function translate(text, target) {
  const data = await apiPost("/api/translate", { apiKey: state.apiKey, text, target });
  return { translatedText: data.translatedText, detectedSourceLanguage: data.detectedSourceLanguage };
}

function setSubtitles({ original, translated, hint }) {
  els.subtitleOriginal.textContent = original || "";
  els.subtitleTranslated.textContent = translated || "";
  els.subtitleHint.textContent = hint || "";
}

function cancelInterimTimer() {
  if (!state.interimTimer) return;
  window.clearTimeout(state.interimTimer);
  state.interimTimer = null;
}

function cancelFinalFlushTimer() {
  if (!state.finalFlushTimer) return;
  window.clearTimeout(state.finalFlushTimer);
  state.finalFlushTimer = null;
}

function endsWithSentencePunctuation(text) {
  return /[.!?。！？]$/.test((text || "").trim());
}

function scheduleFinalFlush() {
  cancelFinalFlushTimer();
  const delay = endsWithSentencePunctuation(state.finalBuffer) ? 300 : state.translateDelayMs;
  state.finalFlushTimer = window.setTimeout(() => {
    state.finalFlushTimer = null;
    if (!state.running) return;
    const toSend = (state.finalBuffer || "").trim();
    state.finalBuffer = "";
    if (!toSend) return;
    enqueueTranslateSegment(toSend, { via: "buffer" });
  }, delay);
}

function computeIncrementalFinal(prevFinal, nextFinal) {
  const prev = (prevFinal || "").trim();
  const next = (nextFinal || "").trim();
  if (!next) return "";
  if (!prev) return next;
  if (next === prev) return "";
  if (next.startsWith(prev)) {
    const rest = next.slice(prev.length).trim();
    return rest || "";
  }
  return next;
}

function enqueueTranslateSegment(sourceText, { via }) {
  const cleaned = (sourceText || "").trim();
  if (!cleaned) return;
  if (cleaned === state.lastDispatched) return;
  state.lastDispatched = cleaned;

  state.queue = state.queue
    .then(async () => {
      requireApiKey();
      setBusy(true);

      setSubtitles({ original: cleaned, translated: "", hint: "言語判定中…" });
      const det = await detectLanguage(cleaned);
      const lang = det.language;
      const target = lang === "ja" ? "en" : "ja";

      setSubtitles({ original: cleaned, translated: "", hint: `翻訳中…（${lang} → ${target}）` });
      const tr = await translate(cleaned, target);

      const translated = tr.translatedText;
      setSubtitles({ original: cleaned, translated, hint: "聞き取り中…" });
      pushHistory({
        time: nowTime(),
        from: lang,
        to: target,
        original: cleaned,
        translated,
      });
      if (state.running) setListeningUI();
    })
    .catch((err) => {
      showAlert(err?.message || "処理に失敗しました。");
      setSubtitles({ original: cleaned, translated: "", hint: "エラー" });
      if (state.running) setListeningUI();
    })
    .finally(() => {
      setBusy(false);
    });
}

function scheduleInterimTranslation(interimText) {
  // Translate when speech pauses (debounce). Helps when Web Speech API never marks isFinal for later phrases.
  cancelInterimTimer();
  const cleaned = (interimText || "").trim();
  if (!cleaned) return;
  state.interimTimer = window.setTimeout(() => {
    state.interimTimer = null;
    if (!state.running) return;
    if ((state.finalBuffer || "").trim()) return; // final buffer is pending; prefer that
    // Use the latest interim snapshot.
    const latest = (state.lastInterim || "").trim();
    if (!latest) return;
    // Mark as "seen" to reduce duplicates when a similar final arrives later.
    state.lastFinal = latest;
    enqueueTranslateSegment(latest, { via: "interim" });
  }, state.translateDelayMs);
}

function pushHistory(item) {
  state.history.unshift(item);
  state.history = state.history.slice(0, 50);
  renderHistory();
}

function renderHistory() {
  els.historyList.innerHTML = "";
  for (const item of state.history) {
    const li = document.createElement("li");
    li.className = "history-item";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${item.time} ・ ${item.from.toUpperCase()} → ${item.to.toUpperCase()}`;
    const orig = document.createElement("div");
    orig.className = "orig";
    orig.textContent = item.original;
    const tr = document.createElement("div");
    tr.className = "tr";
    tr.textContent = item.translated;
    li.append(meta, orig, tr);
    els.historyList.appendChild(li);
  }
  els.historyCount.textContent = `${state.history.length} 件`;
}

function clearHistory() {
  state.history = [];
  renderHistory();
  showToast("履歴をクリアしました。");
}

function requireApiKey() {
  const k = state.apiKey?.trim();
  if (!k) throw new Error("API キーが未設定です。左側の設定から保存してください。");
  return k;
}

function setRunningUI(isRunning) {
  state.running = isRunning;
  els.btnStartStop.textContent = isRunning ? "Stop" : "Start";
  els.btnStartStop.classList.toggle("btn-primary", !isRunning);
  els.btnStartStop.classList.toggle("btn-secondary", isRunning);
  document.body.classList.toggle("running", isRunning);
  if (!isRunning) {
    state.busyCount = 0;
    document.body.classList.remove("busy");
  }
}

function setListeningUI() {
  setBadge("ok", "聞き取り中", "話すと字幕が更新されます。");
  if (!els.subtitleHint.textContent) els.subtitleHint.textContent = "聞き取り中…";
}

function setBusy(isBusy) {
  if (isBusy) state.busyCount += 1;
  else state.busyCount = Math.max(0, state.busyCount - 1);
  document.body.classList.toggle("busy", state.busyCount > 0);
}

function scheduleRecognitionRestart(reason) {
  if (!state.running) return;
  if (state.restartTimer) return;
  state.restartAttempt += 1;

  const delay = Math.min(1200, 200 + state.restartAttempt * 150);
  setBadge("warn", "再接続中", `音声認識を再開します…（${reason}）`);
  state.restartTimer = window.setTimeout(() => {
    state.restartTimer = null;
    if (!state.running) return;
    try {
      stopRecognition();
    } catch {
      // ignore
    }
    try {
      startRecognition();
    } catch (e) {
      showAlert(e?.message || "音声認識の再開に失敗しました。");
      scheduleRecognitionRestart("retry");
    }
  }, delay);
}

function startRecognition() {
  if (!supportsSpeechRecognition()) throw new Error("このブラウザは Web Speech API（音声認識）に対応していません。");
  if (state.recognition) return;
  state.recognition = createRecognition();

  state.recognition.onstart = () => {
    state.restartAttempt = 0;
    state.lastFinal = "";
    state.lastInterim = "";
    state.lastDispatched = "";
    cancelInterimTimer();
    cancelFinalFlushTimer();
    state.finalBuffer = "";
    state.lastResultAt = 0;
    setListeningUI();
    setSubtitles({ original: "", translated: "", hint: "聞き取り中…" });
  };

  state.recognition.onerror = (e) => {
    const msg = e?.error ? `音声認識エラー: ${e.error}` : "音声認識エラー";
    showAlert(msg);
    setBadge("warn", "エラー", "マイク権限、入力デバイス、ブラウザ設定を確認してください。");
    // Many errors are transient in continuous mode; keep trying while running.
    scheduleRecognitionRestart(e?.error || "error");
  };

  state.recognition.onend = () => {
    // In continuous mode, browsers can stop unexpectedly. Attempt auto-restart while running.
    if (state.running) {
      scheduleRecognitionRestart("ended");
    } else {
      setBadge("idle", "停止中", "開始を押すと聞き取りを開始します。");
      setSubtitles({ original: "", translated: "", hint: "停止中" });
    }
  };

  state.recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const t = (r[0] && r[0].transcript) || "";
      if (r.isFinal) finalText += t;
      else interim += t;
    }
    state.lastResultAt = Date.now();

    const shownOriginal = (finalText || interim).trim();
    if (shownOriginal) els.subtitleOriginal.textContent = shownOriginal;

    const cleanedFinal = finalText.trim();
    const cleanedInterim = interim.trim();

    // If we got a new finalized chunk, translate it immediately.
    if (cleanedFinal) {
      const segment = computeIncrementalFinal(state.lastFinal, cleanedFinal);
      state.lastFinal = cleanedFinal;
      state.lastInterim = "";
      cancelInterimTimer();
      if (segment) {
        const sep = state.finalBuffer && !/\s$/.test(state.finalBuffer) ? " " : "";
        state.finalBuffer = `${state.finalBuffer || ""}${sep}${segment}`.trim();
        scheduleFinalFlush();
      }
      return;
    }

    // No final chunk: keep listening, and translate when the interim text stops changing (pause).
    if (cleanedInterim) {
      if (cleanedInterim !== state.lastInterim) {
        state.lastInterim = cleanedInterim;
        scheduleInterimTranslation(cleanedInterim);
      }
    } else {
      state.lastInterim = "";
      cancelInterimTimer();
    }
  };

  try {
    state.recognition.start();
  } catch (e) {
    state.recognition = null;
    throw e;
  }
}

function stopRecognition() {
  if (state.restartTimer) {
    window.clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
  cancelInterimTimer();
  cancelFinalFlushTimer();
  state.finalBuffer = "";
  if (!state.recognition) return;
  try {
    state.recognition.onend = null;
    state.recognition.onerror = null;
    state.recognition.onresult = null;
    state.recognition.stop();
  } catch {
    // ignore
  } finally {
    state.recognition = null;
  }
}

async function toggleStartStop() {
  try {
    if (!state.running) {
      requireApiKey();
      setRunningUI(true);
      startRecognition();
      showToast("開始しました。");
      return;
    }
    setRunningUI(false);
    stopRecognition();
    setBadge("idle", "停止中", "開始を押すと聞き取りを開始します。");
    setSubtitles({ original: "", translated: "", hint: "停止中" });
    showToast("停止しました。");
  } catch (e) {
    setRunningUI(false);
    showAlert(e?.message || "開始できませんでした。");
  }
}

async function testApiKey() {
  try {
    const k = (els.apiKey.value || "").trim();
    if (!k) throw new Error("API キーを入力してください。");
    els.btnTestKey.disabled = true;
    const data = await apiPost("/api/ping", { apiKey: k });
    showToast(`接続 OK（languages: ${data.languages}）`);
  } catch (e) {
    showAlert(e?.message || "接続テストに失敗しました。");
  } finally {
    els.btnTestKey.disabled = false;
  }
}

function saveApiKeyFromInput() {
  const k = (els.apiKey.value || "").trim();
  state.apiKey = k;
  saveSettings();
  showToast("API キーを保存しました。");
  if (!k) setBadge("warn", "未設定", "API キーを設定してください。");
  else setBadge("idle", "停止中", "準備完了。開始を押すと聞き取りを開始します。");
}

async function toggleFullscreen() {
  try {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
      await elem.requestFullscreen?.();
      showToast("Full にしました。");
    } else {
      await document.exitFullscreen?.();
      showToast("Normal に戻しました。");
    }
  } catch {
    showAlert("全画面表示に失敗しました。");
  }
}

function updateFullscreenModeClass() {
  const isFs = Boolean(document.fullscreenElement);
  document.body.classList.toggle("fullscreen-mode", isFs);
  if (els.btnFullScreen) els.btnFullScreen.textContent = isFs ? "Normal" : "Full";
}

function initEvents() {
  els.btnStartStop.addEventListener("click", toggleStartStop);
  els.btnFullScreen.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenModeClass);
  window.addEventListener("resize", updateTopbarHeightVar);

  els.tabMain?.addEventListener("click", () => setActiveTab("main"));
  els.tabApi?.addEventListener("click", () => setActiveTab("api"));

  els.btnToggleKey.addEventListener("click", () => {
    const isPassword = els.apiKey.type === "password";
    els.apiKey.type = isPassword ? "text" : "password";
    els.btnToggleKey.textContent = isPassword ? "非表示" : "表示";
    els.btnToggleKey.setAttribute("aria-pressed", isPassword ? "true" : "false");
  });

  els.btnSaveKey.addEventListener("click", saveApiKeyFromInput);
  els.btnTestKey.addEventListener("click", testApiKey);

  if (els.speechLang) {
    els.speechLang.addEventListener("change", () => {
      state.speechLang = els.speechLang.value || "";
      saveSettings();
      showToast("音声入力言語を更新しました。");
      if (state.running) {
        scheduleRecognitionRestart("lang changed");
      }
    });
  }

  if (els.translateDelay) {
    els.translateDelay.addEventListener("input", () => {
      state.translateDelayMs = Number(els.translateDelay.value);
      if (els.translateDelayValue) els.translateDelayValue.textContent = `${state.translateDelayMs}ms`;
      saveSettings();
    });
  }

  function adjustFont(deltaPx) {
    const min = Number(els.fontSize?.min || 24);
    const max = Number(els.fontSize?.max || 72);
    const step = Number(els.fontSize?.step || 2);
    const next = Math.min(max, Math.max(min, state.fontSize + deltaPx));
    state.fontSize = Math.round(next / step) * step;
    applySettingsToUI();
    saveSettings();
  }

  els.btnFontDown?.addEventListener("click", () => adjustFont(-2));
  els.btnFontUp?.addEventListener("click", () => adjustFont(+2));

  els.fontSize.addEventListener("input", () => {
    state.fontSize = Number(els.fontSize.value);
    applySettingsToUI();
    saveSettings();
  });
  els.showOriginal.addEventListener("change", () => {
    state.showOriginal = els.showOriginal.checked;
    applySettingsToUI();
    saveSettings();
  });
  els.highContrast.addEventListener("change", () => {
    state.highContrast = els.highContrast.checked;
    applySettingsToUI();
    saveSettings();
  });
  els.reduceMotion.addEventListener("change", () => {
    state.reduceMotion = els.reduceMotion.checked;
    applySettingsToUI();
    saveSettings();
  });

  els.btnClear.addEventListener("click", clearHistory);

  // Keyboard shortcut: Space to start/stop when not focused on input.
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const active = document.activeElement;
    const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (isTyping) return;
    e.preventDefault();
    toggleStartStop();
  });
}

function init() {
  loadSettings();
  applySettingsToUI();
  initEvents();
  renderHistory();
  updateFullscreenModeClass();
  updateTopbarHeightVar();

  if (!supportsSpeechRecognition()) {
    setBadge("warn", "非対応", "Web Speech API に対応したブラウザ（Chrome/Edge）で開いてください。");
    setSubtitles({ original: "", translated: "", hint: "ブラウザ非対応" });
  } else if (!state.apiKey?.trim()) {
    setBadge("warn", "未設定", "API キーを設定してから開始してください。");
    setSubtitles({ original: "", translated: "", hint: "API キー未設定" });
  } else {
    setBadge("idle", "停止中", "準備完了。開始を押すと聞き取りを開始します。");
    setSubtitles({ original: "", translated: "", hint: "準備完了" });
  }
}

init();
