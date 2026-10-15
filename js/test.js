let corpora = null;
let lastQuote = "";

export async function loadCorpora() {
  const base = new URL("../assets/", import.meta.url);
  const [en, it, quotes] = await Promise.all([
    readJson(new URL("words-en.json", base)),
    readJson(new URL("words-it.json", base)),
    readJson(new URL("quotes.json", base)),
  ]);
  corpora = { en, it, quotes };
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname}`);
  return response.json();
}

export function createTest(config, preset) {
  if (!corpora && !preset?.tokens) throw new Error("Word lists are not loaded.");
  const mode = config.mode || "time";
  let tokens = preset?.tokens;
  let author = preset?.author || "";
  if (!tokens) {
    if (mode === "quote") {
      const quote = pickQuote(config.language);
      tokens = quote.text.split(/\s+/).filter(Boolean);
      author = quote.author;
    } else if (mode === "words") {
      tokens = decorate(pickWords(wordList(config.language), config.wordCount), config);
    } else {
      tokens = decorate(pickWords(wordList(config.language), 80), config);
    }
  }

  return {
    mode,
    timeLimit: Number(config.timeLimit) || 30,
    wordCount: Number(config.wordCount) || 25,
    language: config.language === "it" ? "it" : "en",
    punctuation: Boolean(config.punctuation),
    numbers: Boolean(config.numbers),
    author,
    words: tokens.map(makeWord),
    index: 0,
    status: "idle",
    startedAt: 0,
    endedAt: 0,
    pausedAt: 0,
    pauseTotal: 0,
    events: [],
    keyErrors: {},
  };
}

export function typeChar(test, ch, now = performance.now()) {
  if (!test || test.status === "finished" || test.pausedAt) return false;
  if (test.status === "running" && overtime(test, now)) {
    finishTest(test, now);
    return true;
  }
  if (ch === " ") return commitWord(test, now);
  if (test.status === "idle") start(test, now);

  const word = currentWord(test);
  touch(word, now);
  const next = word.chars.find((item) => item.state === "pending");
  if (!next) {
    word.extras.push(ch);
    noteKey(test, ch, 1);
    pushEvent(test, now, { correct: 0, typed: 1, errors: 1 });
    return false;
  }
  next.typed = ch;
  if (next.expected === ch) {
    next.state = "correct";
    pushEvent(test, now, { correct: 1, typed: 1, errors: 0 });
  } else {
    next.state = "incorrect";
    noteKey(test, ch, 1);
    pushEvent(test, now, { correct: 0, typed: 1, errors: 1 });
  }
  if (isTerminal(test) && word.chars.every((item) => item.state !== "pending") && word.extras.length === 0) {
    closeWord(word, now, false, false);
    finishTest(test, now);
    return true;
  }
  return false;
}

export function backspace(test, now = performance.now()) {
  if (!test || test.status === "finished" || test.pausedAt || test.status === "idle") return;
  const word = currentWord(test);
  if (!word?.started) return;
  if (word.extras.length) {
    const removed = word.extras.pop();
    noteKey(test, removed, -1);
    pushEvent(test, now, { correct: 0, typed: -1, errors: -1 });
    return;
  }
  const typed = [...word.chars].reverse().find((item) => item.state === "correct" || item.state === "incorrect");
  if (!typed) return;
  if (typed.state === "correct") {
    pushEvent(test, now, { correct: -1, typed: -1, errors: 0 });
  } else {
    noteKey(test, typed.typed, -1);
    pushEvent(test, now, { correct: 0, typed: -1, errors: -1 });
  }
  typed.typed = null;
  typed.state = "pending";
}

export function tick(test, now = performance.now()) {
  if (!test || test.status !== "running" || test.pausedAt) return false;
  if (overtime(test, now)) {
    finishTest(test, now);
    return true;
  }
  return false;
}

export function pause(test, now = performance.now()) {
  if (!test || test.status !== "running" || test.pausedAt) return;
  test.pausedAt = now;
}

export function resume(test, now = performance.now()) {
  if (!test?.pausedAt) return;
  const delta = now - test.pausedAt;
  test.pauseTotal += delta;
  const word = currentWord(test);
  if (word?.started && !word.completed) word.pausedMs = (word.pausedMs || 0) + delta;
  test.pausedAt = 0;
}

export function metrics(test, now = performance.now()) {
  const counts = recount(test);
  const elapsed = activeElapsed(test, now);
  const minutes = elapsed / 60000;
  const wpm = minutes > 0 ? (counts.correct / 5) / minutes : 0;
  const raw = minutes > 0 ? (counts.typed / 5) / minutes : 0;
  const denom = counts.correct + counts.incorrect + counts.extra + counts.missed;
  const accuracy = denom > 0 ? (counts.correct / denom) * 100 : 100;
  return { ...counts, elapsed, wpm, raw, accuracy };
}

export function timerLabel(test, now = performance.now()) {
  if (test.mode === "time") {
    if (test.status === "idle") return String(test.timeLimit);
    const left = Math.max(0, test.timeLimit - activeElapsed(test, now) / 1000);
    return String(Math.ceil(left - 1e-9));
  }
  const elapsed = Math.floor(activeElapsed(test, now) / 1000);
  const minutes = Math.floor(elapsed / 60);
  return `${minutes}:${String(elapsed % 60).padStart(2, "0")}`;
}

export function buildResult(test) {
  const snapshot = metrics(test, test.endedAt || performance.now());
  const timeline = buildTimeline(test);
  return {
    id: uid(),
    timestamp: Date.now(),
    mode: test.mode,
    modeValue: test.mode === "time" ? test.timeLimit : test.mode === "words" ? test.wordCount : "quote",
    language: test.language,
    punctuation: test.punctuation,
    numbers: test.numbers,
    wpm: round1(snapshot.wpm),
    rawWpm: round1(snapshot.raw),
    accuracy: round1(snapshot.accuracy),
    consistency: Math.round(consistency(timeline)),
    correct: snapshot.correct,
    incorrect: snapshot.incorrect,
    extra: snapshot.extra,
    missed: snapshot.missed,
    durationMs: snapshot.elapsed,
    timeline,
    keyErrors: { ...test.keyErrors },
    wordStats: wordStats(test),
    quoteAuthor: test.author || "",
  };
}

function wordList(language) {
  return language === "it" ? corpora.it : corpora.en;
}

function pickWords(list, count) {
  const words = [];
  let previous = "";
  let guard = 0;
  while (words.length < count && guard < count * 20) {
    guard += 1;
    const word = list[Math.floor(Math.random() * list.length)];
    if (!word || word === previous) continue;
    words.push(word);
    previous = word;
  }
  return words;
}

function pickQuote(language) {
  const list = corpora.quotes[language === "it" ? "it" : "en"];
  let quote = list[Math.floor(Math.random() * list.length)];
  if (list.length > 1 && quote.text === lastQuote) {
    quote = list.find((item) => item.text !== lastQuote) || quote;
  }
  lastQuote = quote.text;
  return quote;
}

function decorate(words, config) {
  let capitalizeNext = true;
  return words.map((word) => {
    let token = word;
    if (config.numbers && Math.random() < 0.12) token = randomNumber();
    if (!config.punctuation) return token;
    if (capitalizeNext) token = capitalize(token);
    capitalizeNext = false;
    if (Math.random() < 0.06) token = `"${token}"`;
    const roll = Math.random();
    if (roll < 0.1) {
      token += ".";
      capitalizeNext = true;
    } else if (roll < 0.18) token += ",";
    else if (roll < 0.22) token += ";";
    else if (roll < 0.25) token += ":";
    else if (roll < 0.29) {
      token += "?";
      capitalizeNext = true;
    } else if (roll < 0.32) {
      token += "!";
      capitalizeNext = true;
    }
    return token;
  });
}

function randomNumber() {
  const roll = Math.random();
  if (roll < 0.45) return String(1 + Math.floor(Math.random() * 9));
  if (roll < 0.8) return String(10 + Math.floor(Math.random() * 90));
  return String(100 + Math.floor(Math.random() * 9000));
}

function capitalize(token) {
  const chars = [...token];
  for (let i = 0; i < chars.length; i += 1) {
    if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(chars[i])) {
      chars[i] = chars[i].toLocaleUpperCase();
      break;
    }
  }
  return chars.join("");
}

function makeWord(text) {
  return {
    text,
    chars: [...text].map((expected) => ({ expected, typed: null, state: "pending" })),
    extras: [],
    started: false,
    completed: false,
    spaced: false,
    spaceCorrect: false,
    startedAt: 0,
    endedAt: 0,
    pausedMs: 0,
  };
}

function start(test, now) {
  test.status = "running";
  test.startedAt = now;
}

function commitWord(test, now) {
  if (test.status === "idle") start(test, now);
  const word = currentWord(test);
  touch(word, now);
  const pending = word.chars.filter((item) => item.state === "pending");
  const spaceCorrect = pending.length === 0;
  for (const item of pending) item.state = "missed";
  closeWord(word, now, true, spaceCorrect);
  pushEvent(test, now, { correct: spaceCorrect ? 1 : 0, typed: 1, errors: pending.length });
  if (isTerminal(test)) {
    finishTest(test, now);
    return true;
  }
  test.index += 1;
  if (test.mode === "time") extendPassage(test);
  if (test.index >= test.words.length) {
    finishTest(test, now);
    return true;
  }
  return false;
}

function extendPassage(test) {
  if (test.words.length - test.index > 24) return;
  const more = decorate(pickWords(wordList(test.language), 40), test);
  test.words.push(...more.map(makeWord));
}

function closeWord(word, now, spaced, spaceCorrect) {
  word.completed = true;
  word.endedAt = now;
  word.spaced = spaced;
  word.spaceCorrect = spaceCorrect;
}

function finishTest(test, now) {
  if (test.status === "finished") return;
  test.endedAt = test.mode === "time" && test.startedAt
    ? test.startedAt + test.pauseTotal + test.timeLimit * 1000
    : now;
  test.status = "finished";
  const word = currentWord(test);
  if (word?.started && !word.completed) {
    for (const item of word.chars) {
      if (item.state === "pending") item.state = "missed";
    }
    word.completed = true;
    word.endedAt = test.endedAt;
  }
}

function overtime(test, now) {
  return test.mode === "time" && activeElapsed(test, now) >= test.timeLimit * 1000;
}

function isTerminal(test) {
  return test.mode !== "time" && test.index >= test.words.length - 1;
}

function currentWord(test) {
  return test.words[test.index];
}

function touch(word, now) {
  if (!word.started) {
    word.started = true;
    word.startedAt = now;
  }
}

function pushEvent(test, now, delta) {
  test.events.push({ dt: activeElapsed(test, now), ...delta });
}

function noteKey(test, key, direction) {
  const name = normalizeKey(key);
  const next = (test.keyErrors[name] || 0) + direction;
  if (next <= 0) delete test.keyErrors[name];
  else test.keyErrors[name] = next;
}

function normalizeKey(key) {
  return /^[A-Za-z]$/.test(key) ? key.toLowerCase() : key;
}

function activeElapsed(test, now) {
  if (!test.startedAt) return 0;
  const end = test.status === "finished" ? test.endedAt : now;
  const livePause = test.pausedAt ? Math.max(0, end - test.pausedAt) : 0;
  return Math.max(0, end - test.startedAt - test.pauseTotal - livePause);
}

function recount(test) {
  const counts = { correct: 0, incorrect: 0, extra: 0, missed: 0, typed: 0 };
  const last = Math.min(test.index, test.words.length - 1);
  for (let i = 0; i <= last; i += 1) {
    const word = test.words[i];
    for (const item of word.chars) {
      if (item.state === "correct") {
        counts.correct += 1;
        counts.typed += 1;
      } else if (item.state === "incorrect") {
        counts.incorrect += 1;
        counts.typed += 1;
      } else if (item.state === "missed") counts.missed += 1;
    }
    counts.extra += word.extras.length;
    counts.typed += word.extras.length;
    if (word.spaced) {
      counts.typed += 1;
      if (word.spaceCorrect) counts.correct += 1;
    }
  }
  return counts;
}

function buildTimeline(test) {
  const duration = activeElapsed(test, test.endedAt || performance.now());
  const seconds = Math.max(1, Math.ceil(duration / 1000));
  const bins = Array.from({ length: seconds }, () => ({ correct: 0, typed: 0, errors: 0 }));
  for (const event of test.events) {
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor(event.dt / 1000)));
    bins[index].correct += event.correct;
    bins[index].typed += event.typed;
    bins[index].errors += event.errors;
  }
  const points = bins.map((bin, index) => {
    const windowMs = Math.min(1000, Math.max(1, duration - index * 1000));
    const minutes = windowMs / 60000;
    return {
      second: index + 1,
      wpm: round1((Math.max(0, bin.correct) / 5) / minutes),
      raw: round1((Math.max(0, bin.typed) / 5) / minutes),
      errors: Math.max(0, bin.errors),
      partial: windowMs < 980,
      windowMs,
    };
  });
  const tail = points[points.length - 1];
  if (points.length > 1 && tail.partial && tail.windowMs < 450) points.pop();
  return points.map(({ windowMs, ...point }) => point);
}

function consistency(timeline) {
  const full = timeline.filter((point) => !point.partial);
  const samples = (full.length ? full : timeline).map((point) => point.wpm);
  if (samples.length < 2) return samples.length ? 100 : 0;
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  if (mean <= 0) return 0;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  return Math.max(0, Math.min(100, 100 - (Math.sqrt(variance) / mean) * 100));
}

function wordStats(test) {
  return test.words.filter((word) => word.started).map((word) => ({
    text: word.text,
    ms: Math.max(0, (word.endedAt || test.endedAt) - word.startedAt - (word.pausedMs || 0)),
    mistakes: word.chars.filter((item) => item.state === "incorrect" || item.state === "missed").length + word.extras.length,
    typed: word.chars.filter((item) => item.state === "correct" || item.state === "incorrect").length + word.extras.length,
  }));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `tf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
