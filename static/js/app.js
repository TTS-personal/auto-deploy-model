/**
 * app.js - all UI logic: state, rendering, event handling.
 *
 * Talks to the backend ONLY through ApiService (api-service.js) - never
 * calls fetch() directly here.
 */

const STORAGE_KEYS = {
  settings: "autoreply.settings",
  transcript: "autoreply.transcript",
};

const DAY_NAMES_BY_JS_INDEX = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const AUTOCOMPLETE_DEBOUNCE_MS = 400;

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
function currentDayAndTime() {
  const now = new Date();
  return {
    day: DAY_NAMES_BY_JS_INDEX[now.getDay()],
    time: now.toTimeString().slice(0, 5),
  };
}

function loadSettings() {
  const saved = localStorage.getItem(STORAGE_KEYS.settings);
  if (saved) return JSON.parse(saved);
  const { day, time } = currentDayAndTime();
  return { useNow: true, day, time, temperature: 0.7, repetitionPenalty: 2.0 };
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function loadTranscript() {
  const saved = localStorage.getItem(STORAGE_KEYS.transcript);
  return saved ? JSON.parse(saved) : [];
}

function saveTranscript(transcript) {
  localStorage.setItem(STORAGE_KEYS.transcript, JSON.stringify(transcript));
}

let state = {
  settings: loadSettings(),
  transcript: loadTranscript(),
  currentSuggestions: [],
};

function effectiveDayTime() {
  if (state.settings.useNow) return currentDayAndTime();
  return { day: state.settings.day, time: state.settings.time };
}

function apiSettings() {
  const { day, time } = effectiveDayTime();
  return {
    day,
    time,
    temperature: state.settings.temperature,
    repetitionPenalty: state.settings.repetitionPenalty,
  };
}

// ---------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------
const el = {
  transcript: document.getElementById("transcript"),
  chipsRow: document.getElementById("chips-row"),
  partnerForm: document.getElementById("partner-form"),
  partnerInput: document.getElementById("partner-input"),
  composeForm: document.getElementById("compose-form"),
  composeInput: document.getElementById("compose-input"),
  ghostText: document.getElementById("ghost-text"),
  settingsButton: document.getElementById("settings-button"),
  settingsBackdrop: document.getElementById("settings-backdrop"),
  settingsClose: document.getElementById("settings-close"),
  settingsSave: document.getElementById("settings-save"),
  clearChat: document.getElementById("clear-chat"),
  useNowToggle: document.getElementById("use-now-toggle"),
  daySelect: document.getElementById("day-select"),
  timeInput: document.getElementById("time-input"),
  temperatureInput: document.getElementById("temperature-input"),
  temperatureValue: document.getElementById("temperature-value"),
  penaltyInput: document.getElementById("penalty-input"),
  penaltyValue: document.getElementById("penalty-value"),
  topbarSubtitle: document.getElementById("topbar-subtitle"),
  accessKeyBackdrop: document.getElementById("access-key-backdrop"),
  accessKeyInput: document.getElementById("access-key-input"),
  accessKeySubmit: document.getElementById("access-key-submit"),
  accessKeyError: document.getElementById("access-key-error"),
};

// ---------------------------------------------------------------------
// Access key gate - shown before anything else if no key is stored yet
// ---------------------------------------------------------------------
function showAccessKeyModal(withError) {
  el.accessKeyError.classList.toggle("hidden", !withError);
  el.accessKeyBackdrop.classList.remove("hidden");
  el.accessKeyInput.focus();
}

function hideAccessKeyModal() {
  el.accessKeyBackdrop.classList.add("hidden");
}

function submitAccessKey() {
  const key = el.accessKeyInput.value.trim();
  if (!key) return;
  ApiService.setStoredKey(key);
  el.accessKeyInput.value = "";
  hideAccessKeyModal();
}

el.accessKeySubmit.addEventListener("click", submitAccessKey);
el.accessKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitAccessKey();
  }
});

function handleAuthError() {
  // A request came back 401 - the stored key was wrong or missing.
  // api-service.js already cleared it; re-prompt with an error shown.
  showAccessKeyModal(true);
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderTranscript() {
  el.transcript.innerHTML = state.transcript
    .map((msg) => `
      <div class="bubble ${msg.sender}">
        ${escapeHtml(msg.text)}
        <span class="meta">${msg.sender === "partner" ? "them" : "you"} · ${msg.timestamp}</span>
      </div>
    `)
    .join("");
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function renderChips() {
  if (state.currentSuggestions.length === 0) {
    el.chipsRow.classList.add("hidden");
    el.chipsRow.innerHTML = "";
    return;
  }
  el.chipsRow.classList.remove("hidden");
  el.chipsRow.innerHTML = state.currentSuggestions
    .map((text, i) => `<button type="button" class="chip" data-index="${i}">${escapeHtml(text)}</button>`)
    .join("");
  el.chipsRow.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => {
      el.composeInput.value = state.currentSuggestions[Number(button.dataset.index)];
      autoResizeComposeInput();
      clearGhostText();
      el.composeInput.focus();
    });
  });
}

function renderTopbarSubtitle() {
  const { day, time } = effectiveDayTime();
  el.topbarSubtitle.textContent = `${day} ${time} · T=${state.settings.temperature.toFixed(2)} · rep=${state.settings.repetitionPenalty.toFixed(1)}`;
}

function clearGhostText() {
  el.ghostText.innerHTML = "";
}

function renderGhostText(typedText, suggestion) {
  if (!suggestion) {
    clearGhostText();
    return;
  }
  const separator = typedText.endsWith(" ") || typedText.length === 0 ? "" : " ";
  el.ghostText.innerHTML = `${escapeHtml(typedText)}${separator}<span class="suggestion">${escapeHtml(suggestion)}</span>`;
}

function autoResizeComposeInput() {
  el.composeInput.style.height = "auto";
  const maxHeight = 120;
  const newHeight = Math.min(el.composeInput.scrollHeight, maxHeight);
  el.composeInput.style.height = `${newHeight}px`;
  el.composeInput.style.overflowY = el.composeInput.scrollHeight > maxHeight ? "auto" : "hidden";
  el.ghostText.style.height = `${newHeight}px`;
}

// ---------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------
function debounce(fn, delayMs) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

// ---------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------
let latestAutocompleteRequestId = 0;

const requestAutocomplete = debounce(async () => {
  const typedText = el.composeInput.value;
  if (!typedText.trim()) {
    clearGhostText();
    return;
  }
  const requestId = ++latestAutocompleteRequestId;
  try {
    const suggestion = await ApiService.autocomplete(typedText, apiSettings());
    if (requestId !== latestAutocompleteRequestId) return;
    if (el.composeInput.value !== typedText) return;
    renderGhostText(typedText, suggestion);
  } catch (err) {
    if (err.isAuthError) { handleAuthError(); return; }
    console.error("autocomplete failed:", err);
  }
}, AUTOCOMPLETE_DEBOUNCE_MS);

el.composeInput.addEventListener("input", () => {
  autoResizeComposeInput();
  clearGhostText();
  requestAutocomplete();
});

el.composeInput.addEventListener("keydown", (event) => {
  const ghostSuggestion = el.ghostText.querySelector(".suggestion");
  const atEndOfInput = el.composeInput.selectionStart === el.composeInput.value.length;

  if (ghostSuggestion && atEndOfInput && (event.key === "Tab" || event.key === "ArrowRight")) {
    event.preventDefault();
    const typedText = el.composeInput.value;
    const separator = typedText.endsWith(" ") || typedText.length === 0 ? "" : " ";
    el.composeInput.value = typedText + separator + ghostSuggestion.textContent;
    autoResizeComposeInput();
    clearGhostText();
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.composeForm.requestSubmit();
  }
});

el.partnerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = el.partnerInput.value.trim();
  if (!text) return;

  state.transcript.push({ sender: "partner", text, timestamp: effectiveDayTime().time });
  saveTranscript(state.transcript);
  renderTranscript();
  el.partnerInput.value = "";

  state.currentSuggestions = [];
  renderChips();

  try {
    state.currentSuggestions = await ApiService.suggestReplies(text, apiSettings());
  } catch (err) {
    if (err.isAuthError) { handleAuthError(); return; }
    console.error("suggest-replies failed:", err);
    state.currentSuggestions = [];
  }
  renderChips();
});

el.composeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = el.composeInput.value.trim();
  if (!text) return;

  state.transcript.push({ sender: "me", text, timestamp: effectiveDayTime().time });
  saveTranscript(state.transcript);
  renderTranscript();

  el.composeInput.value = "";
  autoResizeComposeInput();
  clearGhostText();
  state.currentSuggestions = [];
  renderChips();
});

// --- settings modal ---
function openSettingsModal() {
  el.useNowToggle.checked = state.settings.useNow;
  el.daySelect.value = state.settings.day;
  el.timeInput.value = state.settings.time;
  el.temperatureInput.value = state.settings.temperature;
  el.temperatureValue.textContent = state.settings.temperature.toFixed(2);
  el.penaltyInput.value = state.settings.repetitionPenalty;
  el.penaltyValue.textContent = state.settings.repetitionPenalty.toFixed(1);
  el.daySelect.disabled = state.settings.useNow;
  el.timeInput.disabled = state.settings.useNow;
  el.settingsBackdrop.classList.remove("hidden");
}

function closeSettingsModal() {
  el.settingsBackdrop.classList.add("hidden");
}

el.settingsButton.addEventListener("click", openSettingsModal);
el.settingsClose.addEventListener("click", closeSettingsModal);
el.settingsBackdrop.addEventListener("click", (event) => {
  if (event.target === el.settingsBackdrop) closeSettingsModal();
});

el.useNowToggle.addEventListener("change", () => {
  el.daySelect.disabled = el.useNowToggle.checked;
  el.timeInput.disabled = el.useNowToggle.checked;
});

el.temperatureInput.addEventListener("input", () => {
  el.temperatureValue.textContent = Number(el.temperatureInput.value).toFixed(2);
});

el.penaltyInput.addEventListener("input", () => {
  el.penaltyValue.textContent = Number(el.penaltyInput.value).toFixed(1);
});

el.settingsSave.addEventListener("click", () => {
  state.settings = {
    useNow: el.useNowToggle.checked,
    day: el.daySelect.value,
    time: el.timeInput.value || "12:00",
    temperature: Number(el.temperatureInput.value),
    repetitionPenalty: Number(el.penaltyInput.value),
  };
  saveSettings(state.settings);
  renderTopbarSubtitle();
  closeSettingsModal();
});

el.clearChat.addEventListener("click", () => {
  state.transcript = [];
  state.currentSuggestions = [];
  saveTranscript(state.transcript);
  renderTranscript();
  renderChips();
  closeSettingsModal();
});

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
if (!state.settings.day) {
  const { day, time } = currentDayAndTime();
  state.settings.day = day;
  state.settings.time = time;
}
renderTranscript();
renderChips();
renderTopbarSubtitle();

if (!ApiService.getStoredKey()) {
  showAccessKeyModal(false);
}
