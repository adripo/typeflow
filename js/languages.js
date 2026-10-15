export const LANGUAGES = [
  { id: "en", name: "English", code: "EN" },
  { id: "it", name: "Italiano", code: "IT" },
  { id: "es", name: "Español", code: "ES" },
  { id: "fr", name: "Français", code: "FR" },
  { id: "de", name: "Deutsch", code: "DE" },
  { id: "pt", name: "Português", code: "PT" },
];

const byId = new Map(LANGUAGES.map((language) => [language.id, language]));

export function languageById(id) {
  return byId.get(id) || { id: id || "en", name: id || "English", code: String(id || "en").toUpperCase() };
}

export function normalizeLanguage(id) {
  return byId.has(id) ? id : "en";
}
