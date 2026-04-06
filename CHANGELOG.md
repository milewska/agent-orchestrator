# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1.0] - 2026-04-06

### Changed
- Dashboard section heading uses native `<h2>` instead of `div[role="heading"]` — correct HTML semantics
- Accordion buttons in the Attention Board now include `aria-controls` linking to their body panel — screen readers can programmatically navigate the accordion
- Empty kanban columns show zone-specific messages ("No agents need your input", "No code waiting for review", etc.) instead of generic "No sessions" text
- Dashboard title uses JetBrains Mono at weight 500 and letter-spacing -0.02em, matching the Warm Terminal display spec
- Board section labels use 0.06em letter-spacing per the UI/Labels typography spec
- Section headings and kanban column titles gain `text-wrap: balance` for more even line breaks

### Fixed
- Removed concurrent breathe animations on status pills (active, ready, waiting) — only the dot pulse animation remains, reducing visual noise
- Restored correct text colors for detail card text in dark mode
- Fixed light mode WCAG AA contrast failures on several text tokens
- Replaced Berkeley Mono with JetBrains Mono (free, OFL licensed)

### Added
- `prefers-reduced-motion` media query collapses all animations and transitions to 0.01ms for users with vestibular disorders or motion sensitivity
- Full design system documentation in `DESIGN.md` — Warm Terminal aesthetic, WCAG AA contrast tables, component anatomy, typography scale, color tokens, spacing, and accessibility specs
- Contextual empty state test coverage for all 6 Attention Board zones
- `.gstack/` and `.gstack-report/` added to `.gitignore`
