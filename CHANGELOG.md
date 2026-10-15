# Changelog

All notable changes to TypeFlow are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project follows [Semantic Versioning](https://semver.org/).

A push to `main` publishes the next version from the commits since the last release. A `feat` commit raises the minor version, a `fix` commit raises the patch, and a breaking change raises the major. Those commit summaries become the notes for that version and for the GitHub Release. The version shown in the app is updated in the same step.

## [Unreleased]

### Added

- Flow mode, with the caret fixed in the center while the passage moves
- Spanish, French, German, and Portuguese word lists and public-domain quotes
- Two decimals on results and history, and one decimal on the live pace

### Changed

- The language control is a list of native names
- Duration choices and the live clock are marked in seconds, including word and quote tests
- Mode-specific options keep a fixed slot so language and the other shared controls stay put
- The last five seconds of a timed test change the clock color
- Result actions stay pinned below the scrolling results
- The result card's top edge is a smooth curve of the pace of the run
- Finishing a test leaves focus off Retry, so Space does not restart it. Tab, then Space, retries

## [1.0.0] - 2026-10-15

### Added

- Time, word-count, and quote typing tests in English and Italian
- Live WPM, accuracy, a per-second pace chart, a keyboard heatmap, and word analysis
- Local history with personal bests, progress, a daily streak, CSV export, and reset
- Five themes, a downloadable result card, and a layout for phones and external keyboards
- GitHub Pages deployment from the main branch
