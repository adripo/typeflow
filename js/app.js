import { loadHistory, loadSettings, saveResult, saveSettings, clearHistory } from "./storage.js";
import { summarize } from "./stats.js";
import {
  backspace,
  buildResult,
  createTest,
  loadCorpora,
  metrics,
  pause,
  resume,
  tick,
  timerLabel,
  typeChar,
} from "./test.js";
import * as ui from "./ui.js";

const VERSION = "1.0.0";

const settings = loadSettings();
let test = null;
let view = "test";
let lastResult = null;
let armed = false;
let armTimer = 0;
let lastAnnounce = 0;
let fromKey = false;

ui.init({
  onConfig: updateConfig,
  onTheme: updateTheme,
  onView: showView,
  onRestart: restart,
  onSettings: openSettings,
  onCloseSettings: closeSettings,
  onDismissHint: dismissHint,
  onFocusPassage: () => {
    if (view === "test") ui.focusCapture();
  },
  onShare: () => {
    if (lastResult) ui.downloadCard(lastResult);
  },
  onExport: () => ui.downloadCsv(loadHistory()),
  onReset: resetHistory,
});
ui.applyTheme(settings.theme);
document.querySelector("#app-version").textContent = `TypeFlow ${VERSION}`;

const touch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
ui.showHint(touch && !settings.hintDismissed);
document.documentElement.lang = settings.language === "it" ? "it" : "en";

try {
  await loadCorpora();
  test = createTest(settings);
  ui.syncConfig(settings, false);
  ui.renderPassage(test);
  ui.updateLive(test);
  ui.focusCapture();
  requestAnimationFrame(loop);
} catch (error) {
  ui.showFatal("The word lists could not be loaded. Open TypeFlow through a local server, then refresh.");
  console.error(error);
}

const input = ui.typingInput();

input.addEventListener("keydown", (event) => {
  if (ui.isSettingsOpen() || ui.isConfirmOpen() || view !== "test" || !test) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key === "Tab" || event.key === "Escape" || event.key === "Enter") return;
  if (test.status === "finished") {
    event.preventDefault();
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    backspace(test);
    ui.updatePassage(test);
    ui.updateLive(test);
    return;
  }
  if (event.key.length === 1) {
    event.preventDefault();
    fromKey = true;
    applyChar(event.key);
  }
});

input.addEventListener("input", () => {
  const value = input.value;
  input.value = "";
  if (fromKey) {
    fromKey = false;
    return;
  }
  if (!value || ui.isSettingsOpen() || view !== "test" || !test || test.status === "finished") return;
  for (const char of value) {
    if (char === "\n" || char === "\r") continue;
    applyChar(char);
  }
});

document.addEventListener("keydown", (event) => {
  if (ui.isConfirmOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      ui.settleConfirm(false);
    }
    return;
  }
  if (ui.isSettingsOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
    } else if (event.key === "Tab") {
      ui.trapFocus(event, ui.settingsRoot());
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    openSettings();
    return;
  }
  if (!test) return;
  if (event.key === "Tab" && document.activeElement === input) {
    event.preventDefault();
    armed = true;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      armed = false;
    }, 1500);
    return;
  }
  if (event.key === "Enter" && armed) {
    event.preventDefault();
    armed = false;
    restart();
  }
});

function loop() {
  requestAnimationFrame(loop);
  if (!test || view !== "test" || test.status !== "running" || test.pausedAt) return;
  if (tick(test)) {
    complete();
    return;
  }
  ui.updateLive(test);
  const now = performance.now();
  if (now - lastAnnounce > 1000) {
    ui.announce(liveSentence());
    lastAnnounce = now;
  }
}

function applyChar(char) {
  const wasIdle = test.status === "idle";
  const finished = typeChar(test, char);
  if (wasIdle) lastAnnounce = performance.now();
  ui.updatePassage(test);
  ui.updateLive(test);
  ui.syncConfig(settings, test.status === "running");
  if (finished) complete();
}

function complete() {
  if (!test || test.status !== "finished") return;
  if (test.saved) return;
  test.saved = true;
  lastResult = buildResult(test);
  saveResult(lastResult);
  view = "results";
  ui.showResults(lastResult);
  ui.blurCapture();
  ui.syncConfig(settings, false);
  document.title = `${Math.round(lastResult.wpm)} WPM · TypeFlow`;
  document.getElementById("result-retry")?.focus({ preventScroll: true });
}

function restart() {
  if (!test) return;
  if (ui.isSettingsOpen()) closeSettings();
  test = createTest(settings);
  lastResult = null;
  view = "test";
  document.title = "TypeFlow";
  ui.showView("test");
  ui.renderPassage(test);
  ui.updateLive(test);
  ui.syncConfig(settings, false);
  ui.focusCapture();
}

function updateConfig(patch) {
  if (!test || test.status === "running") return;
  Object.assign(settings, patch);
  saveSettings(settings);
  document.documentElement.lang = settings.language === "it" ? "it" : "en";
  test = createTest(settings);
  ui.renderPassage(test);
  ui.updateLive(test);
  ui.syncConfig(settings, false);
  if (view === "test") ui.focusCapture();
}

function updateTheme(theme) {
  settings.theme = theme;
  saveSettings(settings);
  ui.applyTheme(theme);
}

function showView(next) {
  if (!test) return;
  if (next === "test" && test.status === "finished") {
    restart();
    return;
  }
  if (next === "results") {
    if (!lastResult) return;
    view = "results";
    ui.showResults(lastResult);
    ui.blurCapture();
    return;
  }
  if (next !== "test" && test.status === "running") pause(test);
  if (next === "test" && test.pausedAt && !ui.isSettingsOpen()) resume(test);
  view = next;
  ui.showView(next);
  if (next === "stats") ui.renderStats(summarize(loadHistory()));
  if (next === "test") {
    ui.updatePassage(test);
    ui.updateLive(test);
    ui.focusCapture();
  } else ui.blurCapture();
}

function openSettings() {
  if (test?.status === "running") pause(test);
  ui.openSettings();
  ui.blurCapture();
}

function closeSettings() {
  ui.closeSettings();
  if (view === "test") {
    if (test?.pausedAt) resume(test);
    ui.focusCapture();
  }
}

function dismissHint() {
  settings.hintDismissed = true;
  saveSettings(settings);
  ui.showHint(false);
}

async function resetHistory() {
  const confirmed = await ui.confirmReset();
  if (!confirmed) return;
  clearHistory();
  ui.renderStats(summarize([]));
}

function liveSentence() {
  const snapshot = metrics(test);
  const clock = test.mode === "time" ? `${timerLabel(test)} seconds left` : timerLabel(test);
  return `${Math.round(snapshot.wpm)} words per minute, ${snapshot.accuracy.toFixed(0)} percent accuracy, ${clock}.`;
}
