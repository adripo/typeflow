import { metrics, timerLabel } from "./test.js";
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
    button.disabled = locked || settings.mode === "quote";
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== settings.mode;
  });
}

export function showHint(visible) {
  $("#keyboard-hint").hidden = !visible;
}

export function renderPassage(test) {
  activeTest = test;
  const words = $("#words");
  words.replaceChildren(...test.words.map((word, index) => renderWord(word, index, index === test.index)));
  $("#passage-shift").style.transform = "translateY(0px)";
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
  $("#stat-wpm").textContent = idle || !settled ? "—" : String(Math.round(snapshot.wpm));
  $("#stat-raw").textContent = idle || !settled ? "—" : String(Math.round(snapshot.raw));
  $("#stat-acc").textContent = idle ? "—" : `${snapshot.accuracy.toFixed(0)}%`;
  $("#stat-time").textContent = timerLabel(test, now);
  $("#stat-time-label").textContent = test.mode === "time" ? "left" : "time";
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
  $("#result-wpm").textContent = String(Math.round(result.wpm));
  $("#result-raw").textContent = String(Math.round(result.rawWpm));
  $("#result-acc").textContent = `${result.accuracy.toFixed(1)}%`;
  $("#result-con").textContent = `${Math.round(result.consistency)}%`;
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
    ["Average", summary.totalTests ? String(Math.round(summary.avgWpm)) : "—"],
    ["Accuracy", summary.totalTests ? `${summary.avgAcc.toFixed(1)}%` : "—"],
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
      score.textContent = String(best.wpm);
      copy.append(title, score);
      const meta = document.createElement("small");
      meta.textContent = `${best.accuracy.toFixed(1)}%`;
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
      mode.textContent = `${modeLabel(row)} · ${row.language === "it" ? "IT" : "EN"}`;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${Math.round(row.wpm)} wpm · ${row.accuracy.toFixed(1)}% · ${formatWhen(row.timestamp)}`;
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
  const card = css.getPropertyValue("--card-solid").trim() || "#171b24";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 630);
  roundRect(ctx, 48, 48, 1104, 534, 36);
  ctx.fillStyle = card;
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(48, 48, 1104, 12);

  ctx.fillStyle = text;
  ctx.font = "600 32px Outfit, sans-serif";
  ctx.fillText("TypeFlow", 92, 140);
  ctx.fillStyle = muted;
  ctx.font = "500 24px Outfit, sans-serif";
  ctx.fillText(resultSubtitle(result), 92, 180);

  ctx.fillStyle = text;
  ctx.font = "600 168px Outfit, sans-serif";
  const wpm = String(Math.round(result.wpm));
  const wpmWidth = ctx.measureText(wpm).width;
  ctx.fillText(wpm, 92, 400);
  ctx.fillStyle = muted;
  ctx.font = "600 32px Outfit, sans-serif";
  ctx.fillText("WPM", 112 + wpmWidth, 390);

  ctx.font = "500 28px Outfit, sans-serif";
  ctx.fillStyle = text;
  ctx.fillText(
    `Accuracy ${result.accuracy.toFixed(1)}%    Raw ${Math.round(result.rawWpm)}    Consistency ${Math.round(result.consistency)}%`,
    92,
    470,
  );
  ctx.fillStyle = muted;
  ctx.font = "400 22px Outfit, sans-serif";
  const date = new Date(result.timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  ctx.fillText(date, 92, 530);
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
      return;
    }
    const toggle = event.target.closest("[data-toggle]");
    if (toggle && !toggle.disabled) {
      handlers.onConfig?.({ [toggle.dataset.toggle]: toggle.getAttribute("aria-pressed") !== "true" });
    }
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
}

function optionNodes() {
  const fragment = document.createDocumentFragment();
  fragment.append(segment("Mode", "mode", [
    ["time", "time"],
    ["words", "words"],
    ["quote", "quote"],
  ]));
  const time = segment("Duration", "timeLimit", [[15, "15"], [30, "30"], [60, "60"], [120, "120"]]);
  time.dataset.panel = "time";
  const words = segment("Word count", "wordCount", [[10, "10"], [25, "25"], [50, "50"], [100, "100"]]);
  words.dataset.panel = "words";
  fragment.append(time, words, segment("Language", "language", [["en", "EN"], ["it", "IT"]]));
  fragment.append(toggle("punctuation", "punctuation"), toggle("numbers", "numbers"));
  return fragment;
}

function segment(label, key, pairs) {
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
    button.textContent = text;
    group.append(button);
  }
  return group;
}

function toggle(key, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip config-control";
  button.dataset.toggle = key;
  button.setAttribute("aria-pressed", "false");
  button.textContent = label;
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
  const wordEl = document.getElementById(`w-${test.index}`);
  if (!wordEl || test.status === "finished") {
    caret.hidden = test.status === "finished";
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
  caretY = target.offsetTop + (target.offsetHeight - height) / 2;
  caret.style.height = `${height}px`;
  caret.style.transform = `translate(${x}px, ${caretY}px)`;
  caret.style.animation = "none";
  void caret.offsetWidth;
  caret.style.animation = "";
  const frame = $("#passage-frame");
  const desired = Math.max(0, target.offsetTop - frame.clientHeight * 0.34);
  $("#passage-shift").style.transform = `translateY(${-desired}px)`;
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

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
