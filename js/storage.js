const HISTORY_KEY = "typeflow-history";
const SETTINGS_KEY = "typeflow-settings";
const HISTORY_LIMIT = 500;

export const DEFAULT_SETTINGS = {
  theme: "system",
  mode: "time",
  timeLimit: 30,
  wordCount: 25,
  language: "en",
  punctuation: false,
  numbers: false,
  focusCaret: false,
  hintDismissed: false,
};

export function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveResult(result) {
  const history = loadHistory();
  history.push(result);
  const trimmed = history.slice(-HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
