const ORDER = [
  ["time", 15],
  ["time", 30],
  ["time", 60],
  ["time", 120],
  ["words", 10],
  ["words", 25],
  ["words", 50],
  ["words", 100],
  ["quote", "quote"],
];

export function summarize(history) {
  const totalTests = history.length;
  const totalMs = history.reduce((sum, row) => sum + (row.durationMs || 0), 0);
  const avgWpm = totalTests ? history.reduce((sum, row) => sum + row.wpm, 0) / totalTests : 0;
  const avgAcc = totalTests ? history.reduce((sum, row) => sum + row.accuracy, 0) / totalTests : 0;
  const bests = [];

  for (const [mode, modeValue] of ORDER) {
    for (const language of ["en", "it"]) {
      const rows = history.filter((row) => (
        row.mode === mode
        && String(row.modeValue) === String(modeValue)
        && row.language === language
      ));
      if (!rows.length) continue;
      const best = rows.reduce((top, row) => (isBetter(row, top) ? row : top));
      bests.push({
        label: modeLabel(best),
        language: language === "it" ? "IT" : "EN",
        wpm: Math.round(best.wpm),
        accuracy: best.accuracy,
        timestamp: best.timestamp,
      });
    }
  }

  return {
    totalTests,
    totalMs,
    avgWpm,
    avgAcc,
    streak: currentStreak(history),
    bests,
    progress: history.map((row) => ({
      timestamp: row.timestamp,
      wpm: row.wpm,
      accuracy: row.accuracy,
    })),
    recent: history.slice(-8).reverse(),
  };
}

export function modeLabel(result) {
  if (result.mode === "time") return `${result.modeValue}s`;
  if (result.mode === "words") return `${result.modeValue} words`;
  return "Quote";
}

export function resultSubtitle(result) {
  const language = result.language === "it" ? "Italian" : "English";
  if (result.mode === "time") return `${result.modeValue} second test · ${language}`;
  if (result.mode === "words") return `${result.modeValue} words · ${language}`;
  const author = result.quoteAuthor ? `${result.quoteAuthor} · ` : "";
  return `Quote · ${author}${language}`;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function historyToCsv(history) {
  const columns = [
    "date",
    "mode",
    "modeValue",
    "language",
    "punctuation",
    "numbers",
    "wpm",
    "rawWpm",
    "accuracy",
    "consistency",
    "correct",
    "incorrect",
    "extra",
    "missed",
    "durationSeconds",
  ];
  const lines = [columns.join(",")];
  for (const row of history) {
    const values = [
      new Date(row.timestamp).toISOString(),
      row.mode,
      row.modeValue,
      row.language,
      Boolean(row.punctuation),
      Boolean(row.numbers),
      row.wpm,
      row.rawWpm,
      row.accuracy,
      row.consistency,
      row.correct,
      row.incorrect,
      row.extra,
      row.missed,
      Math.round((row.durationMs || 0) / 100) / 10,
    ];
    lines.push(values.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function isBetter(row, top) {
  if (row.wpm !== top.wpm) return row.wpm > top.wpm;
  if (row.accuracy !== top.accuracy) return row.accuracy > top.accuracy;
  return row.timestamp > top.timestamp;
}

function currentStreak(history) {
  if (!history.length) return 0;
  const days = new Set(history.map((row) => dayStamp(row.timestamp)));
  const today = dayStamp(Date.now());
  let cursor = days.has(today) ? today : days.has(shiftDay(today, -1)) ? shiftDay(today, -1) : null;
  if (cursor == null) return 0;
  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor = shiftDay(cursor, -1);
  }
  return count;
}

function dayStamp(ms) {
  const date = new Date(ms);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

function shiftDay(stamp, days) {
  const date = new Date(stamp);
  date.setDate(date.getDate() + days);
  return dayStamp(date.getTime());
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
