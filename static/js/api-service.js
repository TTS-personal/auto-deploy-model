/**
 * api-service.js
 *
 * Thin wrapper around every backend call - app.js never calls fetch()
 * directly. Also owns the access-key header: every request attaches
 * whatever key is currently stored, and a 401 is surfaced as a distinct
 * error type so app.js can react (clear the stored key, re-prompt)
 * without needing to know HOW the key gets sent.
 */

const ACCESS_KEY_STORAGE = "autoreply.accessKey";

const ApiService = (() => {
  function getStoredKey() {
    return localStorage.getItem(ACCESS_KEY_STORAGE) || "";
  }

  function setStoredKey(key) {
    localStorage.setItem(ACCESS_KEY_STORAGE, key);
  }

  function clearStoredKey() {
    localStorage.removeItem(ACCESS_KEY_STORAGE);
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": getStoredKey(),
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      clearStoredKey();
      const error = new Error("Unauthorized");
      error.isAuthError = true;
      throw error;
    }
    if (!response.ok) {
      throw new Error(`Request to ${path} failed: ${response.status}`);
    }
    return response.json();
  }

  async function suggestReplies(partnerMessage, settings) {
    const data = await postJson("/api/suggest-replies", {
      partner_message: partnerMessage,
      day: settings.day,
      time: settings.time,
      temperature: settings.temperature,
      repetition_penalty: settings.repetitionPenalty,
    });
    return data.suggestions || [];
  }

  async function autocomplete(partialText, settings) {
    const data = await postJson("/api/autocomplete", {
      partial_text: partialText,
      day: settings.day,
      time: settings.time,
      temperature: settings.temperature,
      repetition_penalty: settings.repetitionPenalty,
    });
    return data.suggestion || "";
  }

  return { suggestReplies, autocomplete, getStoredKey, setStoredKey, clearStoredKey };
})();
