import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apply = process.env.GITHUB_ACTIONS === "true";

function git(args, allowFailure = false) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

function currentVersion() {
  const source = readFileSync("js/app.js", "utf8");
  const found = source.match(/const VERSION = "(\d+\.\d+\.\d+)";/);
  if (!found) throw new Error("VERSION is missing from js/app.js.");
  return found[1];
}

function baseline() {
  const tags = git(["tag", "--list", "v[0-9]*", "--sort=-v:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  if (tags.length) {
    return { rev: git(["rev-parse", `${tags[0]}^{commit}`]), version: tags[0].slice(1) };
  }
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const released = changelog.match(/## \[(\d+\.\d+\.\d+)\]/);
  if (!released) throw new Error("No version tag and no released changelog entry.");
  const rev = git(["log", "-1", "--format=%H", "-S", `## [${released[1]}]`, "--", "CHANGELOG.md"]);
  if (!rev) throw new Error(`Could not find the commit that released ${released[1]}.`);
  return { rev, version: released[1] };
}

function parseCommits(rev) {
  const raw = git(["log", `${rev}..HEAD`, "--format=%s%x1f%b%x1e"]);
  if (!raw) return [];
  return raw.split("\x1e").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [subject, body = ""] = entry.split("\x1f");
    const match = subject.match(/^(\w+)(?:\([^)]*\))?(!)?:\s+(.+)$/);
    if (!match) return null;
    return {
      type: match[1].toLowerCase(),
      breaking: Boolean(match[2]) || /^BREAKING CHANGE:/m.test(body),
      summary: match[3].trim(),
    };
  }).filter(Boolean);
}

function bump(version, commits) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (commits.some((commit) => commit.breaking)) return `${major + 1}.0.0`;
  if (commits.some((commit) => commit.type === "feat")) return `${major}.${minor + 1}.0`;
  if (commits.some((commit) => commit.type === "fix" || commit.type === "perf" || commit.type === "revert")) {
    return `${major}.${minor}.${patch + 1}`;
  }
  return null;
}

function notes(commits) {
  const groups = [
    ["Added", (commit) => commit.type === "feat" && !commit.breaking],
    ["Fixed", (commit) => (commit.type === "fix" || commit.type === "revert") && !commit.breaking],
    ["Changed", (commit) => commit.type === "perf" && !commit.breaking],
    ["Breaking", (commit) => commit.breaking],
  ];
  return groups.map(([title, include]) => {
    const lines = commits.filter(include).map((commit) => `- ${capitalize(commit.summary)}`);
    return lines.length ? `### ${title}\n\n${lines.join("\n")}` : "";
  }).filter(Boolean).join("\n\n");
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function writeChangelog(version, section) {
  const today = new Date().toISOString().slice(0, 10);
  const markdown = readFileSync("CHANGELOG.md", "utf8");
  const stripped = markdown.replace(/## \[Unreleased\][\s\S]*?(?=## \[)/, "");
  const heading = `## [${version}] - ${today}`;
  const entry = `${heading}\n\n${section}\n\n`;
  const next = stripped.includes("## [")
    ? stripped.replace(/## \[/, `${entry}## [`)
    : `${stripped.trim()}\n\n${entry}`;
  writeFileSync("CHANGELOG.md", next.endsWith("\n") ? next : `${next}\n`);
}

function replaceVersion(path, pattern, value) {
  const source = readFileSync(path, "utf8");
  const next = source.replace(pattern, value);
  if (next === source) throw new Error(`Could not update the version in ${path}.`);
  writeFileSync(path, next);
}

const start = baseline();
const version = currentVersion();
const commits = parseCommits(start.rev).reverse();
const next = bump(version, commits);
if (!next) {
  console.log(`No feat, fix, or breaking commit since ${version}.`);
  process.exit(0);
}

const section = notes(commits);
console.log(`Releasing ${next}\n\n${section}`);
if (!apply) {
  console.log("Dry run. Set GITHUB_ACTIONS=true to publish.");
  process.exit(0);
}

writeChangelog(next, section);
replaceVersion("js/app.js", /const VERSION = "\d+\.\d+\.\d+";/, `const VERSION = "${next}";`);
replaceVersion("README.md", /The current release is \*\*\d+\.\d+\.\d+\*\*\./, `The current release is **${next}**.`);

git(["config", "user.name", "github-actions[bot]"]);
git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
git(["add", "CHANGELOG.md", "js/app.js", "README.md"]);
git(["commit", "-m", `chore: release ${next}`]);
git(["tag", "-a", `v${next}`, "-m", next]);
git(["push", "origin", "HEAD"]);
git(["push", "origin", `v${next}`]);

const notesPath = join(tmpdir(), "typeflow-release.md");
writeFileSync(notesPath, section);
execFileSync("gh", ["release", "create", `v${next}`, "--title", next, "--notes-file", notesPath], {
  stdio: "inherit",
  env: process.env,
});
