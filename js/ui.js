import { LANGUAGES, languageById } from "./languages.js";
import { metrics, secondsLeft, timerLabel } from "./test.js";
import { formatDuration, historyToCsv, modeLabel, resultSubtitle } from "./stats.js";

const $ = (selector) => document.querySelector(selector);

const THEMES = [
  ["system", "System", "swatch-system"],
  ["dark", "Dark", "swatch-dark"],
  ["light", "Light", "swatch-light"],
  ["aurora", "Aurora", "swatch-aurora"],
  ["sunset", "Sunset", "swatch-sunset"],
  ["ocean", "Ocean", "swatch-ocean"],
];

const THEME_COLORS = {
  dark: "#0c0f14",
  light: "#f3efe6",
  aurora: "#071816",
  sunset: "#1a1018",
  ocean: "#061525",
};

const KEY_ROWS = [
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
  [" "],
];

const KNOWN_KEYS = new Set(KEY_ROWS.flat());

let handlers = {};
let activeTest = null;
let confirmResolve = null;
let wpmChart = null;
let progressChart = null;
let caretY = 0;

export function init(nextHandlers) {
  handlers = nextHandlers;
  $("#config-bar").append(optionNodes());
  $("#settings-options").append(optionNodes());
  renderThemePicker();
  bind();
  syncViewport();
  syncOrientation();
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", syncViewport);
  viewport?.addEventListener("scroll", syncViewport);
  window.addEventListener("resize", syncViewport);
  window.addEventListener("orientationchange", syncOrientation);
  matchMedia("(orientation: landscape)").addEventListener("change", syncOrientation);
  matchMedia("(orientation: landscape) and (max-height: 520px)").addEventListener("change", syncOrientation);
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) applyTheme("system");
  });
  document.fonts?.ready.then(() => {
    if (activeTest) placeCaret(activeTest);
  });
}

export function applyTheme(theme) {
  if (!theme || theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = themeColor(theme);
  document.querySelectorAll("[data-theme-pick]").forEach((button) => {
    button.setAttribute("aria-checked", button.dataset.themePick === (theme || "system") ? "true" : "false");
  });
}

export function syncConfig(settings, locked) {
  document.querySelectorAll("[data-set]").forEach((button) => {
    const selected = String(settings[button.dataset.set]) === button.dataset.value;
    button.setAttribute("aria-checked", selected ? "true" : "false");
    button.disabled = locked;
  });
  document.querySelectorAll("[data-toggle]").forEach((button) => {
    const on = Boolean(settings[button.dataset.toggle]);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    const staysLive = button.dataset.toggle === "focusCaret";
    button.disabled = staysLive ? false : locked || settings.mode === "quote";
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    const active = panel.dataset.panel === settings.mode;
    panel.classList.toggle("is-inactive", !active);
    panel.setAttribute("aria-hidden", active ? "false" : "true");
    if (active) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
  });
  const language = languageById(settings.language);
  document.querySelectorAll(".lang-field").forEach((field) => {
    field.querySelector(".lang-code").textContent = language.code;
    field.querySelector(".lang-name").textContent = language.name;
    field.querySelector(".lang-current").disabled = locked;
  });
  document.querySelectorAll(".lang-menu [role='option']").forEach((option) => {
    option.setAttribute("aria-selected", option.dataset.value === language.id ? "true" : "false");
  });
  $("#passage-card").classList.toggle("is-flow", Boolean(settings.focusCaret));
}

export function showHint(visible) {
  $("#keyboard-hint").hidden = !visible;
}

export function renderPassage(test) {
  activeTest = test;
  const words = $("#words");
  words.replaceChildren(...test.words.map((word, index) => renderWord(word, index, index === test.index)));
  setQuote(test);
  placeCaret(test);
}

export function updatePassage(test) {
  activeTest = test;
  const words = $("#words");
  if (!words.childElementCount || words.childElementCount > test.words.length) {
    renderPassage(test);
    return;
  }
  if (words.childElementCount < test.words.length) {
    for (let index = words.childElementCount; index < test.words.length; index += 1) {
      words.append(renderWord(test.words[index], index, false));
    }
  }
  test.words.forEach((word, index) => {
    if (index !== test.index && index !== test.index - 1 && word.completed) return;
    const current = document.getElementById(`w-${index}`);
    if (!current) return;
    if (index === test.index || index === test.index - 1) {
      current.replaceWith(renderWord(word, index, index === test.index));
    }
  });
  setQuote(test);
  placeCaret(test);
}

export function updateLive(test, now = performance.now()) {
  const idle = test.status === "idle";
  const snapshot = metrics(test, now);
  const settled = snapshot.elapsed >= 1000;
  $("#stat-wpm").textContent = idle || !settled ? "—" : snapshot.wpm.toFixed(1);
  $("#stat-raw").textContent = idle || !settled ? "—" : snapshot.raw.toFixed(1);
  $("#stat-acc").textContent = idle ? "—" : `${snapshot.accuracy.toFixed(2)}%`;
  $("#stat-time").textContent = timerLabel(test, now);
  $("#stat-time-label").textContent = "sec";
  const left = secondsLeft(test, now);
  $("#stat-time").closest(".stat-time").classList.toggle(
    "is-urgent",
    test.status === "running" && left !== null && left <= 5,
  );
}

export function announce(text) {
  const region = $("#live-announcer");
  if (region.textContent !== text) region.textContent = text;
}

export function showFatal(message) {
  const error = $("#passage-error");
  error.hidden = false;
  error.textContent = message;
}

export function showView(name) {
  for (const view of ["test", "results", "stats"]) {
    $("#view-" + view).hidden = view !== name;
  }
  setCurrent($("#nav-test"), name === "test");
  setCurrent($("#nav-stats"), name === "stats");
}

export function showResults(result) {
  $("#result-mode").textContent = resultSubtitle(result);
  $("#result-wpm").textContent = Number(result.wpm).toFixed(2);
  $("#result-raw").textContent = Number(result.rawWpm).toFixed(2);
  $("#result-acc").textContent = `${Number(result.accuracy).toFixed(2)}%`;
  $("#result-con").textContent = `${Number(result.consistency).toFixed(2)}%`;
  $("#result-time").textContent = formatDuration(result.durationMs);
  $("#result-correct").textContent = String(result.correct);
  $("#result-incorrect").textContent = String(result.incorrect);
  $("#result-extra").textContent = String(result.extra);
  $("#result-missed").textContent = String(result.missed);
  renderWordList($("#slow-words"), slowest(result), (word) => `${(word.ms / 1000).toFixed(2)}s`);
  renderWordList($("#mistyped-words"), mistyped(result), (word) => `${word.mistakes} miss${word.mistakes === 1 ? "" : "es"}`);
  renderHeatmap(result.keyErrors || {});
  renderWpmChart(result.timeline || []);
  showView("results");
}

export function renderStats(summary) {
  const cards = [
    ["Tests", String(summary.totalTests)],
    ["Time typed", formatDuration(summary.totalMs)],
    ["Average", summary.totalTests ? Number(summary.avgWpm).toFixed(2) : "—"],
    ["Accuracy", summary.totalTests ? `${summary.avgAcc.toFixed(2)}%` : "—"],
    ["Streak", summary.streak ? `${summary.streak} day${summary.streak === 1 ? "" : "s"}` : "0"],
  ];
  const grid = $("#stats-summary");
  grid.replaceChildren(...cards.map(([label, value]) => {
    const item = document.createElement("div");
    item.className = "card metric";
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    item.append(term, detail);
    return item;
  }));

  const bests = $("#bests");
  bests.replaceChildren();
  if (!summary.bests.length) {
    bests.append(emptyNote("No personal bests yet. Finish a test to start one."));
  } else {
    for (const best of summary.bests) {
      const card = document.createElement("article");
      card.className = "best";
      const copy = document.createElement("div");
      const title = document.createElement("span");
      title.textContent = `${best.label} · ${best.language}`;
      const score = document.createElement("strong");
      score.textContent = Number(best.wpm).toFixed(2);
      copy.append(title, score);
      const meta = document.createElement("small");
      meta.textContent = `${best.accuracy.toFixed(2)}%`;
      card.append(copy, meta);
      bests.append(card);
    }
  }

  const recent = $("#recent-tests");
  recent.replaceChildren();
  if (!summary.recent.length) {
    recent.append(emptyNote("No tests yet."));
  } else {
    for (const row of summary.recent) {
      const item = document.createElement("li");
      const mode = document.createElement("span");
      mode.className = "mode";
      mode.textContent = `${modeLabel(row)} · ${languageById(row.language).code}`;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${Number(row.wpm).toFixed(2)} wpm · ${Number(row.accuracy).toFixed(2)}% · ${formatWhen(row.timestamp)}`;
      item.append(mode, meta);
      recent.append(item);
    }
  }
  renderProgress(summary.progress);
}

export function openSettings() {
  $("#settings-dialog").hidden = false;
  $("#settings-close").focus();
}

export function closeSettings() {
  $("#settings-dialog").hidden = true;
}

export function isSettingsOpen() {
  return !$("#settings-dialog").hidden;
}

export function settingsRoot() {
  return $("#settings-dialog .dialog");
}

export function isConfirmOpen() {
  return !$("#confirm-dialog").hidden;
}

export function confirmReset() {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $("#confirm-dialog").hidden = false;
    $("#confirm-cancel").focus();
  });
}

export function settleConfirm(value) {
  $("#confirm-dialog").hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve?.(value);
}

export function trapFocus(event, root) {
  const nodes = [...root.querySelectorAll("button, [href], input, select, textarea")]
    .filter((element) => !element.disabled && !element.closest("[hidden]"));
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function focusCapture() {
  $("#typing-input").focus({ preventScroll: true });
}

export function blurCapture() {
  if (document.activeElement === $("#typing-input")) $("#typing-input").blur();
}

export function typingInput() {
  return $("#typing-input");
}

export async function downloadCard(result) {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue("--bg").trim() || "#0c0f14";
  const text = css.getPropertyValue("--text").trim() || "#f4f1ea";
  const muted = css.getPropertyValue("--muted").trim() || "#b4bac8";
  const accent = css.getPropertyValue("--accent").trim() || "#8b7cff";
  const accent2 = css.getPropertyValue("--accent-2").trim() || accent;
  const card = css.getPropertyValue("--card-solid").trim() || "#171b24";

  const x = 48;
  const width = 1104;
  const bottom = 582;
  const crest = 36;
  const amplitude = 72;
  const pace = paceOutline(result.timeline, x, width, crest, amplitude);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 630);
  badgePath(ctx, pace, x, bottom, 18);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = card;
  ctx.fillRect(0, 0, 1200, 630);

  const cap = ctx.createLinearGradient(0, crest, 0, crest + amplitude + 28);
  cap.addColorStop(0, withAlpha(accent, 0.92));
  cap.addColorStop(0.42, withAlpha(accent, 0.28));
  cap.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = cap;
  ctx.fillRect(x, crest - 8, width, amplitude + 48);

  const wash = ctx.createLinearGradient(x + width * 0.42, 0, x + width, bottom);
  wash.addColorStop(0, withAlpha(accent2, 0));
  wash.addColorStop(1, withAlpha(accent2, 0.2));
  ctx.fillStyle = wash;
  ctx.fillRect(x, crest, width, bottom - crest);

  ctx.beginPath();
  tracePace(ctx, pace);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 14;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = text;
  ctx.font = "600 32px Outfit, sans-serif";
  ctx.fillText("TypeFlow", 96, 176);
  ctx.fillStyle = muted;
  ctx.font = "500 24px Outfit, sans-serif";
  ctx.fillText(resultSubtitle(result), 96, 216);

  ctx.fillStyle = text;
  ctx.font = "600 128px Outfit, sans-serif";
  const wpm = Number(result.wpm).toFixed(2);
  const wpmWidth = ctx.measureText(wpm).width;
  ctx.fillText(wpm, 96, 390);
  ctx.fillStyle = muted;
  ctx.font = "600 28px Outfit, sans-serif";
  ctx.fillText("WPM", 118 + wpmWidth, 378);

  const figures = [
    ["Raw", Number(result.rawWpm).toFixed(2)],
    ["Accuracy", `${Number(result.accuracy).toFixed(2)}%`],
    ["Consistency", `${Number(result.consistency).toFixed(2)}%`],
  ];
  figures.forEach(([label, value], index) => {
    const y = 250 + index * 92;
    ctx.textAlign = "right";
    ctx.fillStyle = muted;
    ctx.font = "500 18px Outfit, sans-serif";
    ctx.fillText(label.toUpperCase(), 1096, y);
    ctx.fillStyle = text;
    ctx.font = "600 40px Outfit, sans-serif";
    ctx.fillText(value, 1096, y + 46);
    ctx.textAlign = "left";
  });

  ctx.fillStyle = muted;
  ctx.font = "400 22px Outfit, sans-serif";
  const date = new Date(result.timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  ctx.fillText(date, 96, 530);
  const site = "adripo.github.io/typeflow";
  ctx.fillText(site, 1104 - ctx.measureText(site).width, 530);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) downloadBlob(blob, "typeflow-result.png");
}

export function downloadCsv(history) {
  const blob = new Blob([historyToCsv(history)], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "typeflow-history.csv");
}

function bind() {
  document.addEventListener("click", (event) => {
    const theme = event.target.closest("[data-theme-pick]");
    if (theme) {
      handlers.onTheme?.(theme.dataset.themePick);
      return;
    }
    const option = event.target.closest("[data-set]");
    if (option && !option.disabled) {
      const key = option.dataset.set;
      const value = key === "timeLimit" || key === "wordCount" ? Number(option.dataset.value) : option.dataset.value;
      handlers.onConfig?.({ [key]: value });
      closeLangMenus();
      return;
    }
    const toggle = event.target.closest("[data-toggle]");
    if (toggle && !toggle.disabled) {
      handlers.onConfig?.({ [toggle.dataset.toggle]: toggle.getAttribute("aria-pressed") !== "true" });
      return;
    }
    const langButton = event.target.closest(".lang-current");
    if (langButton) {
      if (!langButton.disabled) toggleLangMenu(langButton);
      return;
    }
    if (!event.target.closest(".lang-menu")) closeLangMenus();
  });

  $("#nav-test").addEventListener("click", () => handlers.onView?.("test"));
  $("#nav-stats").addEventListener("click", () => handlers.onView?.("stats"));
  $("#nav-restart").addEventListener("click", () => handlers.onRestart?.());
  $("#nav-settings").addEventListener("click", () => handlers.onSettings?.());
  $("#settings-close").addEventListener("click", () => handlers.onCloseSettings?.());
  $("#hint-dismiss").addEventListener("click", () => handlers.onDismissHint?.());
  $("#result-retry").addEventListener("click", () => handlers.onRestart?.());
  $("#result-share").addEventListener("click", () => handlers.onShare?.());
  $("#result-stats").addEventListener("click", () => handlers.onView?.("stats"));
  $("#export-csv").addEventListener("click", () => handlers.onExport?.());
  $("#reset-data").addEventListener("click", () => handlers.onReset?.());
  $("#confirm-cancel").addEventListener("click", () => settleConfirm(false));
  $("#confirm-ok").addEventListener("click", () => settleConfirm(true));

  $("#view-test").addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, a, input")) return;
    handlers.onFocusPassage?.();
  });

  const input = $("#typing-input");
  input.addEventListener("focus", () => $("#passage-card").classList.add("is-focused"));
  input.addEventListener("blur", () => $("#passage-card").classList.remove("is-focused"));

  $("#settings-dialog").addEventListener("pointerdown", (event) => {
    if (event.target === $("#settings-dialog")) handlers.onCloseSettings?.();
  });

  document.addEventListener("keydown", (event) => {
    const menu = openLangMenu();
    if (!menu) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const id = menu.id;
      closeLangMenus();
      document.querySelector(`[aria-controls="${id}"]`)?.focus();
      return;
    }
    const options = [...menu.querySelectorAll("[role='option']")];
    const index = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index < 0 ? 0 : (index + step + options.length) % options.length;
      options[next]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      options[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      options.at(-1)?.focus();
    } else if ((event.key === "Enter" || event.key === " ") && index >= 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options[index].click();
    }
  }, true);

  document.addEventListener("scroll", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".lang-menu")) return;
    placeOpenLangMenu();
  }, true);
}

function optionNodes() {
  const fragment = document.createDocumentFragment();
  fragment.append(segment("Mode", "mode", [
    ["time", "time"],
    ["words", "words"],
    ["quote", "quote"],
  ]));
  const time = segment("Duration", "timeLimit", [[15, "15"], [30, "30"], [60, "60"], [120, "120"]], {
    unit: "s",
    unitLabel: "seconds",
  });
  time.dataset.panel = "time";
  const words = segment("Word count", "wordCount", [[10, "10"], [25, "25"], [50, "50"], [100, "100"]], {
    unit: "w",
    unitLabel: "words",
  });
  words.dataset.panel = "words";
  const slot = document.createElement("div");
  slot.className = "config-slot";
  const note = document.createElement("p");
  note.className = "slot-note";
  note.dataset.panel = "quote";
  note.textContent = "full passage";
  slot.append(time, words, note);
  fragment.append(slot, languagePicker());
  const toggles = document.createElement("div");
  toggles.className = "config-toggles";
  toggles.append(
    toggle("punctuation", "punctuation"),
    toggle("numbers", "numbers"),
    toggle("focusCaret", "flow", "Flow, keep the caret centered"),
  );
  fragment.append(toggles);
  return fragment;
}

let langSeq = 0;

function segment(label, key, pairs, options = {}) {
  const group = document.createElement("div");
  group.className = "seg";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", label);
  for (const [value, text] of pairs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip config-control";
    button.setAttribute("role", "radio");
    button.dataset.set = key;
    button.dataset.value = String(value);
    if (options.unit) {
      const number = document.createElement("span");
      number.textContent = text;
      const unit = document.createElement("small");
      unit.className = "unit";
      unit.textContent = options.unit;
      button.append(number, unit);
      button.setAttribute("aria-label", `${text} ${options.unitLabel || options.unit}`);
    } else {
      button.textContent = text;
    }
    group.append(button);
  }
  return group;
}

function languagePicker() {
  langSeq += 1;
  const id = `lang-menu-${langSeq}`;
  const field = document.createElement("div");
  field.className = "lang-field";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lang-current";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", id);
  const kicker = document.createElement("span");
  kicker.className = "lang-kicker";
  kicker.textContent = "Language";
  const value = document.createElement("span");
  value.className = "lang-value";
  const code = document.createElement("span");
  code.className = "lang-code";
  const name = document.createElement("span");
  name.className = "lang-name";
  value.append(code, name);
  button.append(kicker, value);
  const menu = document.createElement("ul");
  menu.className = "lang-menu";
  menu.id = id;
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Language");
  for (const language of LANGUAGES) {
    const option = document.createElement("li");
    option.setAttribute("role", "option");
    option.tabIndex = -1;
    option.dataset.set = "language";
    option.dataset.value = language.id;
    const optionCode = document.createElement("span");
    optionCode.className = "lang-code";
    optionCode.textContent = language.code;
    const optionName = document.createElement("span");
    optionName.className = "lang-name";
    optionName.textContent = language.name;
    option.append(optionCode, optionName);
    menu.append(option);
  }
  field.append(button, menu);
  return field;
}

function openLangMenu() {
  return document.querySelector(".lang-menu:not([hidden])");
}

function toggleLangMenu(button) {
  const menu = document.getElementById(button.getAttribute("aria-controls"));
  const wasOpen = button.getAttribute("aria-expanded") === "true";
  closeLangMenus();
  if (wasOpen || !menu) return;
  document.body.append(menu);
  menu.hidden = false;
  menu.style.position = "fixed";
  menu.style.zIndex = "40";
  button.setAttribute("aria-expanded", "true");
  placeOpenLangMenu();
  menu.querySelector('[aria-selected="true"]')?.focus();
}

function placeOpenLangMenu() {
  const menu = openLangMenu();
  if (!menu) return;
  const button = document.querySelector(`[aria-controls="${menu.id}"]`);
  if (!button) {
    closeLangMenus();
    return;
  }
  const rect = button.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    closeLangMenus();
    return;
  }
  const width = Math.max(220, rect.width);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.bottom > window.innerHeight - 8) {
    menu.style.top = `${Math.max(8, rect.top - menuRect.height - 6)}px`;
  }
}

function closeLangMenus() {
  let closed = false;
  for (const menu of document.querySelectorAll(".lang-menu")) {
    const button = document.querySelector(`[aria-controls="${menu.id}"]`);
    if (!menu.hidden) closed = true;
    menu.hidden = true;
    button?.setAttribute("aria-expanded", "false");
    if (button?.parentElement && menu.parentElement !== button.parentElement) button.parentElement.append(menu);
  }
  return closed;
}

function toggle(key, label, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip config-control";
  button.dataset.toggle = key;
  button.setAttribute("aria-pressed", "false");
  button.textContent = label;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  return button;
}

function renderThemePicker() {
  const picker = $("#theme-picker");
  picker.replaceChildren(...THEMES.map(([id, label, swatch]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-swatch";
    button.dataset.themePick = id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    const chip = document.createElement("span");
    chip.className = `swatch ${swatch}`;
    chip.setAttribute("aria-hidden", "true");
    button.append(chip, document.createTextNode(label));
    return button;
  }));
}

function renderWord(word, index, active) {
  const element = document.createElement("span");
  element.className = `word${active ? " active" : ""}`;
  element.id = `w-${index}`;
  for (const item of word.chars) {
    const span = document.createElement("span");
    span.className = `char ${item.state}`;
    span.textContent = item.state === "incorrect" || item.state === "extra" ? item.typed : item.expected;
    element.append(span);
  }
  for (const extra of word.extras) {
    const span = document.createElement("span");
    span.className = "char extra";
    span.textContent = extra;
    element.append(span);
  }
  return element;
}

function setQuote(test) {
  const quote = $("#quote-by");
  quote.hidden = !test.author;
  quote.textContent = test.author ? `— ${test.author}` : "";
}

function placeCaret(test) {
  const caret = $("#caret");
  const frame = $("#passage-frame");
  const shift = $("#passage-shift");
  const wordEl = document.getElementById(`w-${test.index}`);
  const flow = $("#passage-card").classList.contains("is-flow");
  if (!wordEl || test.status === "finished") {
    caret.hidden = test.status === "finished";
    if (!flow) shift.style.transform = "translateY(0px)";
    return;
  }
  caret.hidden = false;
  const chars = [...wordEl.querySelectorAll(".char")];
  const word = test.words[test.index];
  const typed = word.chars.filter((item) => item.state === "correct" || item.state === "incorrect").length + word.extras.length;
  const target = chars[Math.min(typed, chars.length - 1)];
  if (!target) return;
  const atEnd = typed >= word.chars.length;
  const x = atEnd ? target.offsetLeft + target.offsetWidth : target.offsetLeft;
  const height = Math.max(16, target.offsetHeight * 0.78);
  caret.style.height = `${height}px`;
  if (flow) {
    const delta = target.offsetTop + target.offsetHeight / 2 - shift.offsetHeight / 2;
    shift.style.top = "50%";
    shift.style.transform = `translate(${frame.clientWidth / 2 - x}px, -50%)`;
    caret.style.left = "50%";
    caret.style.top = "50%";
    caret.style.transform = `translate(-1px, calc(-50% + ${delta}px))`;
  } else {
    const desired = Math.max(0, target.offsetTop - frame.clientHeight * 0.34);
    shift.style.top = "";
    shift.style.transform = `translateY(${-desired}px)`;
    caretY = target.offsetTop + (target.offsetHeight - height) / 2 - desired;
    caret.style.left = "0";
    caret.style.top = "0";
    caret.style.transform = `translate(${x}px, ${caretY}px)`;
  }
  caret.style.animation = "none";
  void caret.offsetWidth;
  caret.style.animation = "";
}

function renderWordList(list, rows, metaText) {
  list.replaceChildren();
  if (!rows.length) {
    list.append(emptyNote("Nothing to show yet."));
    return;
  }
  for (const row of rows) {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = row.text;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = metaText(row);
    item.append(text, meta);
    list.append(item);
  }
}

function slowest(result) {
  const rows = [...(result.wordStats || [])].filter((word) => word.typed > 0);
  const timed = rows.filter((word) => word.ms >= 40);
  return (timed.length ? timed : rows).sort((a, b) => b.ms - a.ms).slice(0, 5);
}

function mistyped(result) {
  return [...(result.wordStats || [])]
    .filter((word) => word.mistakes > 0)
    .sort((a, b) => b.mistakes - a.mistakes || b.ms - a.ms)
    .slice(0, 5);
}

function renderHeatmap(keyErrors) {
  const heatmap = $("#heatmap");
  const entries = Object.entries(keyErrors).filter(([, count]) => count > 0);
  const max = entries.reduce((top, [, count]) => Math.max(top, count), 0);
  heatmap.replaceChildren();
  heatmap.setAttribute("role", "img");
  heatmap.setAttribute("aria-label", max ? "Keyboard heatmap of mistyped keys" : "Keyboard heatmap with no mistyped keys");
  for (const row of KEY_ROWS) {
    const line = document.createElement("div");
    line.className = "heat-row";
    for (const key of row) {
      const count = keyErrors[key] || 0;
      const button = document.createElement("div");
      button.className = `key${key === " " ? " key-space" : ""}`;
      const heat = max ? count / max : 0;
      if (heat) {
        button.style.background = `color-mix(in srgb, var(--error) ${Math.round(20 + heat * 70)}%, var(--key))`;
      }
      button.textContent = key === " " ? "space" : key;
      button.title = count ? `${key === " " ? "space" : key}: ${count} error${count === 1 ? "" : "s"}` : key;
      button.setAttribute("aria-label", button.title);
      line.append(button);
    }
    heatmap.append(line);
  }
  const extras = entries.filter(([key]) => !KNOWN_KEYS.has(key));
  if (extras.length) {
    const extraRow = document.createElement("div");
    extraRow.className = "other-keys";
    for (const [key, count] of extras.sort((a, b) => b[1] - a[1])) {
      const pill = document.createElement("span");
      pill.className = "key";
      pill.textContent = `${key} ${count}`;
      extraRow.append(pill);
    }
    heatmap.append(extraRow);
  }
  $("#heatmap-note").textContent = max ? "" : "No mistyped keys.";
}

function renderWpmChart(timeline) {
  const canvas = $("#wpm-chart");
  const fallback = $("#chart-fallback");
  if (!globalThis.Chart) {
    canvas.hidden = true;
    fallback.hidden = false;
    return;
  }
  canvas.hidden = false;
  fallback.hidden = true;
  wpmChart?.destroy();
  const colors = chartColors();
  wpmChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        lineSet("WPM", timeline.map((point) => ({ x: point.second, y: point.wpm })), colors.accent, true),
        lineSet("Raw", timeline.map((point) => ({ x: point.second, y: point.raw })), colors.accent2, false),
        {
          type: "scatter",
          label: "Errors",
          data: timeline.filter((point) => point.errors > 0).map((point) => ({ x: point.second, y: point.raw })),
          pointStyle: "triangle",
          pointRadius: 7,
          backgroundColor: colors.error,
          borderColor: colors.error,
        },
      ],
    },
    options: chartOptions(colors, "Second", "WPM"),
  });
}

function renderProgress(progress) {
  const canvas = $("#progress-chart");
  const empty = $("#progress-empty");
  progressChart?.destroy();
  progressChart = null;
  if (!progress.length || !globalThis.Chart) {
    canvas.hidden = true;
    empty.hidden = false;
    empty.textContent = globalThis.Chart ? "Finish a test to see your progress." : "Chart could not be loaded.";
    return;
  }
  canvas.hidden = false;
  empty.hidden = true;
  const colors = chartColors();
  progressChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: progress.map((point) => formatWhen(point.timestamp)),
      datasets: [lineSet("WPM", progress.map((point) => point.wpm), colors.accent, true)],
    },
    options: {
      ...chartOptions(colors, "Test", "WPM"),
      scales: {
        x: axis(colors, ""),
        y: { ...axis(colors, "WPM"), beginAtZero: true },
      },
    },
  });
}

function withAlpha(color, alpha) {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const value = Math.round(alpha * 255).toString(16).padStart(2, "0");
    return `${hex}${value}`;
  }
  return color;
}

function lineSet(label, data, color, fill) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: fill ? withAlpha(color, 0.16) : "transparent",
    tension: 0.35,
    fill,
    pointRadius: 0,
    borderWidth: 2,
  };
}

function chartOptions(colors, xTitle, yTitle) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduce ? false : { duration: 420 },
    plugins: {
      legend: { position: "bottom", labels: { color: colors.muted, boxWidth: 10, usePointStyle: true } },
      tooltip: { mode: "index", intersect: false },
    },
    scales: {
      x: { ...axis(colors, xTitle), type: xTitle === "Second" ? "linear" : "category" },
      y: { ...axis(colors, yTitle), beginAtZero: true },
    },
  };
}

function axis(colors, title) {
  return {
    ticks: { color: colors.muted, maxTicksLimit: 8 },
    grid: { color: colors.line },
    title: title ? { display: true, text: title, color: colors.muted } : { display: false },
  };
}

function chartColors() {
  const css = getComputedStyle(document.documentElement);
  return {
    accent: css.getPropertyValue("--accent").trim(),
    accent2: css.getPropertyValue("--accent-2").trim(),
    error: css.getPropertyValue("--error").trim(),
    muted: css.getPropertyValue("--muted").trim(),
    line: css.getPropertyValue("--line").trim(),
  };
}

function emptyNote(text) {
  const note = document.createElement("p");
  note.className = "empty";
  note.textContent = text;
  return note;
}

function formatWhen(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function themeColor(theme) {
  if (theme && theme !== "system" && THEME_COLORS[theme]) return THEME_COLORS[theme];
  return matchMedia("(prefers-color-scheme: light)").matches ? THEME_COLORS.light : THEME_COLORS.dark;
}

function syncViewport() {
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : window.innerHeight;
  const top = viewport ? viewport.offsetTop : 0;
  document.documentElement.style.setProperty("--vvh", `${height}px`);
  document.documentElement.style.setProperty("--vv-top", `${top}px`);
  if (activeTest && activeTest.status !== "finished") placeCaret(activeTest);
}

function syncOrientation() {
  const landscape = matchMedia("(orientation: landscape)").matches;
  document.documentElement.dataset.orientation = landscape ? "landscape" : "portrait";
  document.documentElement.dataset.compact = matchMedia("(orientation: landscape) and (max-height: 520px)").matches ? "true" : "false";
  if (activeTest && activeTest.status !== "finished") placeCaret(activeTest);
}

function setCurrent(button, current) {
  if (current) button.setAttribute("aria-current", "page");
  else button.removeAttribute("aria-current");
}

function paceOutline(timeline, x, width, crest, amplitude) {
  const values = (timeline || []).map((point) => Math.max(0, Number(point.wpm) || 0));
  if (values.length < 2) return [[x, crest], [x + width, crest]];
  const max = Math.max(...values, 1);
  return values.map((value, index) => [
    x + (index / (values.length - 1)) * width,
    crest + (1 - value / max) * amplitude,
  ]);
}

function badgePath(ctx, points, x, bottom, radius) {
  const right = points[points.length - 1][0];
  const r = radius;
  ctx.beginPath();
  tracePace(ctx, points);
  ctx.lineTo(right, bottom - r);
  ctx.arcTo(right, bottom, right - r, bottom, r);
  ctx.lineTo(x + r, bottom);
  ctx.arcTo(x, bottom, x, bottom - r, r);
  ctx.closePath();
}

function tracePace(ctx, points) {
  ctx.moveTo(points[0][0], points[0][1]);
  if (points.length < 3) {
    ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
    return;
  }
  const slopes = monotoneSlopes(points);
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const span = end[0] - start[0];
    ctx.bezierCurveTo(
      start[0] + span / 3,
      start[1] + (slopes[index] * span) / 3,
      end[0] - span / 3,
      end[1] - (slopes[index + 1] * span) / 3,
      end[0],
      end[1],
    );
  }
}

function monotoneSlopes(points) {
  const count = points.length;
  const delta = [];
  const slope = [];
  for (let index = 0; index < count - 1; index += 1) {
    delta[index] = points[index + 1][0] - points[index][0] || 1;
    slope[index] = (points[index + 1][1] - points[index][1]) / delta[index];
  }
  const tangent = Array(count);
  tangent[0] = slope[0];
  tangent[count - 1] = slope[count - 2];
  for (let index = 1; index < count - 1; index += 1) {
    tangent[index] = slope[index - 1] * slope[index] <= 0 ? 0 : (slope[index - 1] + slope[index]) / 2;
  }
  for (let index = 0; index < count - 1; index += 1) {
    if (Math.abs(slope[index]) < 1e-6) {
      tangent[index] = 0;
      tangent[index + 1] = 0;
      continue;
    }
    const left = tangent[index] / slope[index];
    const right = tangent[index + 1] / slope[index];
    const scale = Math.hypot(left, right);
    if (scale > 3) {
      tangent[index] = (left * 3 / scale) * slope[index];
      tangent[index + 1] = (right * 3 / scale) * slope[index];
    }
  }
  return tangent;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
