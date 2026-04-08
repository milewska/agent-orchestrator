# Design System — Agent Orchestrator Web

Reference document for agents implementing UI in `packages/web/`. Read this before writing any component code.

---

## Core Principles

- **Warm-toned neutral palette** — all grays are warm (stone/brown-tinted), never blue-gray.
- **No inline `style=` attributes** — use Tailwind utilities with `var(--token)` or CSS class names defined in `globals.css`.
- **Dark mode is always active** — all new styles must work in both `:root` (light) and `.dark` (dark).
- **No external UI libraries** — no Radix, shadcn, Headless UI, etc.
- **Tokens over raw values** — never hardcode `#1a1918` or `rgba(...)` in a component; use the CSS variable.

---

## Design Tokens

All tokens are defined in `packages/web/src/app/globals.css`. Reference them in Tailwind via `bg-[var(--color-bg-surface)]`, `text-[var(--color-text-primary)]`, etc.

### Background Colors

| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--color-bg-base` | `#f5f3f0` | `#121110` | Page background |
| `--color-bg-surface` | `#ffffff` | `#1a1918` | Cards, panels |
| `--color-bg-elevated` | `#f9f7f5` | `#222120` | Elevated cards, popovers |
| `--color-bg-elevated-hover` | `#f7f5f2` | `#2a2928` | Hover state of elevated surfaces |
| `--color-bg-subtle` | `rgba(120,100,80,.06)` | `rgba(255,240,220,.05)` | Subtle fills, tag backgrounds |
| `--color-bg-sidebar` | `#f0ede9` | `#0e0d0c` | Sidebar background |

### Border Colors

| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--color-border-subtle` | `rgba(0,0,0,.06)` | `rgba(255,240,220,.07)` | Hairline dividers, subtle outlines |
| `--color-border-default` | `#d6d3d1` | `rgba(255,240,220,.13)` | Standard borders (inputs, cards) |
| `--color-border-strong` | `#c4bfba` | `rgba(255,240,220,.24)` | Emphasized borders |

### Text Colors

| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--color-text-primary` | `#1c1917` | `#f0ece8` | Headings, primary body copy |
| `--color-text-secondary` | `#57534e` | `#a8a29e` | Supporting text, labels |
| `--color-text-tertiary` | `#78716c` | `#78716c` | Captions, placeholders |
| `--color-text-muted` | `#a8a29e` | `#57534e` | Disabled, timestamps, meta |
| `--color-text-inverse` | `#ffffff` | `#121110` | Text on colored/dark backgrounds |

**Typography hierarchy rule:** primary → secondary → tertiary → muted (decreasing importance).

### Accent Colors

| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--color-accent` | `#5c64b5` | `#8b9cf7` | Links, focus rings, interactive |
| `--color-accent-hover` | `#4a52a0` | `#8b9cf7` | Hover state of accent elements |
| `--color-accent-subtle` | `rgba(92,100,181,.1)` | `rgba(139,156,247,.12)` | Accent-tinted backgrounds |
| `--color-accent-amber` | `#d97706` | `#f97316` | Orchestrator CTA, warnings |
| `--color-accent-amber-dim` | `rgba(217,119,6,.1)` | `rgba(249,115,22,.12)` | Amber-tinted badge background |
| `--color-accent-amber-border` | `rgba(217,119,6,.3)` | `rgba(249,115,22,.35)` | Amber badge border |

**Named semantic aliases** (use when color intent is important):

| Token | Light | Dark |
|-------|-------|------|
| `--color-accent-blue` | `#5c64b5` | `#8b9cf7` |
| `--color-accent-green` | `#16a34a` | `#22c55e` |
| `--color-accent-yellow` | `#b8860b` | `#e2a336` |
| `--color-accent-orange` | `#bc4c00` | `#ff9d57` |
| `--color-accent-red` | `#dc2626` | `#ef4444` |
| `--color-accent-violet` | `#5c64b5` | `#8b9cf7` |

### Tint Colors (pill/badge backgrounds)

| Token | Use for |
|-------|---------|
| `--color-tint-blue` | Blue badge background |
| `--color-tint-green` | Green badge background |
| `--color-tint-yellow` | Yellow badge background |
| `--color-tint-red` | Red / error badge background |
| `--color-tint-orange` | Orange badge background |
| `--color-tint-neutral` | Neutral/gray badge background |

### Status Colors

| Token | Light | Dark | Meaning |
|-------|-------|------|---------|
| `--color-status-working` | `#2563eb` (blue) | `#60a5fa` | Agent actively working |
| `--color-status-ready` | `#16a34a` | `#22c55e` | Agent ready/done recently |
| `--color-status-respond` | `#ea580c` | `#f97316` | Needs human response |
| `--color-status-review` | `#0891b2` | `#06b6d4` | Under review |
| `--color-status-pending` | `#ca8a04` | `#eab308` | Pending / queued |
| `--color-status-merge` | `#16a34a` | `#22c55e` | Ready to merge / merged |
| `--color-status-idle` | `#a8a29e` | `#44403c` | Idle / inactive |
| `--color-status-done` | `#a8a29e` | `#44403c` | Completed |
| `--color-status-error` | `#dc2626` | `#ef4444` | Error state |
| `--color-ci-pass` | `#16a34a` | `#22c55e` | CI passing |
| `--color-ci-fail` | `#dc2626` | `#ef4444` | CI failing |

### Alert Colors

Alert colors are for inline callout rows inside cards (CI failures, review requests, etc.).

| Token | Background token | Use for |
|-------|-----------------|---------|
| `--color-alert-ci` | `--color-alert-ci-bg` | CI failure |
| `--color-alert-review` | `--color-alert-review-bg` | Review requested |
| `--color-alert-changes` | `--color-alert-changes-bg` | Changes requested |
| `--color-alert-conflict` | `--color-alert-conflict-bg` | Merge conflict |
| `--color-alert-comment` | `--color-alert-comment-bg` | New comment |

---

## Typography

### Font Families

| Token | Use for |
|-------|---------|
| `font-sans` (Tailwind) / `var(--font-sans)` | Body text, UI labels |
| `font-mono` (Tailwind) / `var(--font-mono)` | Code, IDs, hashes, numbers, mono data |

In Tailwind: `font-sans`, `font-mono`.
In CSS: `font-family: var(--font-sans)`.

### Font Size Scale

These are defined in `:root` as `--font-size-*`. In Tailwind, use `text-[var(--font-size-xs)]` or just use hardcoded pixel utilities:

| Token | Value | Use for |
|-------|-------|---------|
| `--font-size-xs` | `10px` | Timestamps, IDs, meta labels, mono data |
| `--font-size-sm` | `11px` | Secondary labels, captions, badge text |
| `--font-size-base` | `13px` | Body text, primary labels |
| `--font-size-lg` | `15px` | Section headings, card titles |
| `--font-size-xl` | `17px` | Page headings |

**In Tailwind components, use `text-[10px]`, `text-[11px]`, `text-[13px]` etc.**

Letter spacing rule: body uses `tracking-[-0.011em]` (set on `<body>`). Mono elements often use `tracking-wide` or `tracking-[0.04em]`.

---

## Spacing

Reference tokens in `:root` (rarely needed directly; use Tailwind `p-*`/`gap-*` instead):

| Token | Value | Tailwind equiv |
|-------|-------|----------------|
| `--space-1` | `4px` | `p-1` / `gap-1` |
| `--space-2` | `8px` | `p-2` / `gap-2` |
| `--space-3` | `12px` | `p-3` / `gap-3` |
| `--space-4` | `16px` | `p-4` / `gap-4` |
| `--space-6` | `24px` | `p-6` / `gap-6` |
| `--space-8` | `32px` | `p-8` / `gap-8` |

---

## Border Radius

Defined in `@theme` — use Tailwind utilities directly:

| Token | Value | Tailwind | Use for |
|-------|-------|----------|---------|
| `--radius-base` | `0` | `rounded-none` | Sharp corners (default for most elements) |
| `--radius-sm` | `4px` | `rounded-sm` | Buttons, tags, small chips |
| `--radius-md` | `6px` | `rounded-md` | Input fields, medium cards |
| `--radius-lg` | `rounded-lg` | `8px` | Cards, modals |
| `--radius-xl` | `12px` | `rounded-xl` | Large panels |

**Pill shape** (fully rounded): `rounded-full` — for status pills, activity dots, avatars.

---

## Shadows

Defined in `:root` as `--box-shadow-*`. Reference with `shadow-[var(--box-shadow-sm)]` etc.

| Token | Use for |
|-------|---------|
| `--box-shadow-sm` | Subtle card lift |
| `--box-shadow-md` | Standard card shadow |
| `--box-shadow-lg` | Elevated popovers |
| `--box-shadow-xl` | Modals, full-screen overlays |

---

## Z-Index Scale

| Token | Value | Use for |
|-------|-------|---------|
| `--z-base` | `0` | Default flow |
| `--z-raised` | `10` | Tooltips, dropdowns |
| `--z-nav` | `100` | Top navigation bar |
| `--z-modal` | `200` | Modal dialogs |
| `--z-bottom-nav` | `250` | Mobile bottom navigation |
| `--z-overlay` | `300` | Overlay backdrops |
| `--z-toast` | `400` | Toast notifications |
| `--z-connection-bar` | `500` | Connection status bar (always on top) |

---

## Transitions

| Token | Value | Use for |
|-------|-------|---------|
| `--transition-quick` | `0.1s` | Hover states, color changes |
| `--transition-regular` | `0.25s` | Expand/collapse, panel transitions |

In Tailwind: `transition-colors duration-[var(--transition-quick)]`.

---

## Component Patterns

### Badges / Pills / Chips

Use the reusable `<Badge>` primitive in `components/Badge.tsx`:

```tsx
import { Badge } from "@/components/Badge";

// Status badge
<Badge variant="status" color="blue">working</Badge>
<Badge variant="status" color="green">merged</Badge>
<Badge variant="status" color="orange">respond</Badge>

// Neutral chip (default)
<Badge>label</Badge>

// Outlined
<Badge variant="outline">tag</Badge>

// Mono (for IDs, hashes, numbers)
<Badge mono>abc123</Badge>
```

**When NOT to use `<Badge>`:** For domain-specific indicators like `<ActivityDot>` (agent activity state) or `<CIBadge>` (CI check status) — those have their own semantic components.

**Manual pattern** (when Badge doesn't fit):
```tsx
// Colored pill
<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[var(--color-tint-blue)] text-[var(--color-accent-blue)]">
  label
</span>

// Mono ID chip
<span className="font-mono text-[10px] tracking-[0.04em] text-[var(--color-text-muted)]">
  {id}
</span>
```

### Buttons

Use the reusable `<Button>` primitive in `components/Button.tsx`:

```tsx
import { Button } from "@/components/Button";

<Button>Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="danger">Delete</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button disabled>Disabled</Button>
```

**Manual pattern** (inline button without the component):
```tsx
// Ghost/outline button (most common in this UI)
<button className="inline-flex items-center gap-1.5 border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
  label
</button>
```

### Activity State Indicators

Use `<ActivityDot>` from `components/ActivityDot.tsx`:

```tsx
import { ActivityDot } from "@/components/ActivityDot";

<ActivityDot activity="active" />           // dot + pill label
<ActivityDot activity="idle" dotOnly />     // dot only
<ActivityDot activity="waiting_input" />
```

Valid `activity` values: `"active"` `"ready"` `"idle"` `"waiting_input"` `"blocked"` `"exited"`.

### CI Status

Use `<CIBadge>` from `components/CIBadge.tsx`:

```tsx
import { CIBadge } from "@/components/CIBadge";

<CIBadge status="passing" />
<CIBadge status="failing" checks={ciChecks} />
<CIBadge status="pending" compact />
```

### Cards / Surfaces

```tsx
// Standard card
<div className="bg-[var(--card-bg)] border border-[var(--card-border)] shadow-[var(--card-shadow)]">

// Surface card (lighter)
<div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]">

// Elevated card
<div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)]">
```

### Dividers

```tsx
// Horizontal rule
<div className="border-t border-[var(--color-border-subtle)]" />

// With spacing
<div className="my-4 border-t border-[var(--color-border-default)]" />
```

### Alert / Callout Rows

For inline alerts inside cards:

```tsx
// CI failure row
<div className="flex items-center gap-2 border-l-2 border-[var(--color-alert-ci)] bg-[var(--color-alert-ci-bg)] px-3 py-2 text-[11px] text-[var(--color-alert-ci)]">
  <span>CI failing</span>
</div>

// Review requested
<div className="... border-[var(--color-alert-review)] bg-[var(--color-alert-review-bg)] text-[var(--color-alert-review)]">
```

### Mono Data (IDs, hashes, numbers)

```tsx
// Inline mono id
<span className="font-mono text-[10px] tracking-[0.04em] text-[var(--color-text-muted)]">
  {sessionId}
</span>

// PR number
<span className="font-mono text-[11px] font-bold text-[var(--color-text-primary)]">
  #{prNumber}
</span>
```

### Status Text (session status in sidebar/cards)

```tsx
// Status label — always mono, muted color
<span className="font-mono text-[10px] text-[var(--color-text-muted)]">
  {statusLabel}
</span>
```

---

## CSS Naming Conventions

Component-scoped BEM-style classes are defined in `globals.css`. New CSS classes follow:

```
.{component-name}__{element}
.{component-name}__{element}--{modifier}
```

Examples: `.project-sidebar__proj-toggle`, `.session-card__pr`, `.activity-pill__text`.

**When to add a CSS class vs. use Tailwind:**
- Use **Tailwind utilities** for one-off layout, spacing, sizing.
- Add a **CSS class** in `globals.css` when: the element has theme-sensitive colors, uses gradients, has pseudo-element styles, or the same pattern repeats 3+ times.

---

## Dark/Light Mode Conventions

- Tokens in `:root` = light mode defaults.
- Tokens in `.dark` = dark mode overrides.
- The `html` element gets class `dark` via `ThemeToggle.tsx`.
- **Never use `dark:` Tailwind variant directly** — use CSS variable tokens that already adapt. The tokens flip automatically.

Correct:
```tsx
<div className="bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]">
```

Wrong:
```tsx
<div className="bg-white dark:bg-[#1a1918] text-black dark:text-[#f0ece8]">
```

---

## Anti-Patterns

| Don't | Do instead |
|-------|-----------|
| `style={{ color: '#1c1917' }}` | `text-[var(--color-text-primary)]` |
| `className="bg-white dark:bg-gray-900"` | `bg-[var(--color-bg-surface)]` |
| `className="text-gray-500"` | `text-[var(--color-text-secondary)]` |
| `className="border-gray-200"` | `border-[var(--color-border-default)]` |
| `className="bg-blue-100 text-blue-700"` | `bg-[var(--color-tint-blue)] text-[var(--color-accent-blue)]` |
| `import { Button } from 'some-ui-lib'` | `import { Button } from "@/components/Button"` |
| Hardcode `rounded-full` for a card | Use `rounded-lg` (cards) or `rounded-full` only for pills/dots/avatars |

---

## Existing Primitive Components

| Component | File | Use for |
|-----------|------|---------|
| `<Badge>` | `components/Badge.tsx` | Generic status labels, chips, tags |
| `<Button>` | `components/Button.tsx` | All clickable button elements |
| `<ActivityDot>` | `components/ActivityDot.tsx` | Agent activity state indicator |
| `<CIBadge>` | `components/CIBadge.tsx` | CI check status display |
| `<PRStatus>` | `components/PRStatus.tsx` | Pull request status details |
| `<Toast>` | `components/Toast.tsx` | Toast notifications |

---

## File Organization

- All components in flat `packages/web/src/components/` — no subdirectories.
- Tests in `packages/web/src/components/__tests__/`.
- Hooks in `packages/web/src/hooks/`.
- Max **400 lines** per component file.
- Client components get `"use client"` at the top; pages are server components by default.
