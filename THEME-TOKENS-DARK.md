# Theme Tokens (Dark) - Compact Reference

Purpose: single source of truth for dark design tokens used by the dashboard redesign.
Scope: dark mode only. Light mode overrides are intentionally excluded here.
Primary source: theme-override.css (:root)

## Typography

- --font-body: IBM Plex Sans stack for body text, forms, labels
- --font-display: Space Grotesk stack for headings and section titles
- --font-mono: JetBrains Mono stack for technical metadata

Rules:

- Use --font-display only for emphasis-level headings.
- Use --font-mono for IDs, kicker labels, and compact metadata.

## Surface Tokens

- --bg-primary: #07111f (main canvas)
- --bg-secondary: rgba(11, 21, 38, 0.9) (secondary surfaces, form shells)
- --bg-card: rgba(10, 20, 36, 0.88) (cards, modals)
- --bg-sidebar: rgba(5, 12, 24, 0.96) (sidebar base)
- --bg-sidebar-accent: rgba(13, 29, 52, 0.96) (sidebar gradient end)
- --overlay-bg: rgba(3, 8, 18, 0.72) (modal backdrop)
- --progress-bg: rgba(115, 138, 171, 0.14) (progress tracks)

Rules:

- Default interactive containers to --bg-card.
- Default input shells to --bg-secondary.

## Text Tokens

- --text-primary: #edf4ff
- --text-secondary: #b9c9df
- --text-muted: #7f91ab
- --text-inverse: #08101c

Rules:

- Body copy should use --text-primary or --text-secondary.
- Helper content should use --text-muted.

## Border and Depth Tokens

- --border-color: rgba(110, 148, 201, 0.18)
- --border-strong: rgba(125, 169, 229, 0.28)
- --shadow-color: rgba(1, 5, 12, 0.45)

Rules:

- Use --border-color as standard stroke.
- Use --border-strong for active and selected states.

## Accent Tokens

- --accent-blue: #5ea2ff
- --accent-cyan: #63e2ff
- --accent-green: #40d98c
- --accent-yellow: #f6c760
- --accent-red: #ff6b7a
- --accent-purple: #8c8aff

Rules:

- Primary CTA gradient should run from accent-cyan to accent-blue.
- Avoid hardcoded status colors if semantic token exists.

## Interaction and Button Tokens

- --focus-color: var(--accent-cyan)
- --btn-default-bg: rgba(255, 255, 255, 0.04)
- --btn-default-bg-hover: rgba(255, 255, 255, 0.09)
- --btn-default-border: var(--border-color)
- --btn-default-text: var(--text-primary)
- --btn-primary-text: #f6fbff
- --btn-secondary-bg: rgba(255, 255, 255, 0.03)
- --btn-secondary-bg-hover: rgba(99, 226, 255, 0.14)
- --btn-secondary-border: rgba(99, 226, 255, 0.22)

Rules:

- Keep focus rings visible and based on --focus-color.
- Primary CTAs always use gradient plus --btn-primary-text.
- Secondary actions keep visible borders and high readability.

## Semantic Mapping (Quick)

- Card container: background --bg-card, border --border-color, text --text-primary
- Secondary text: --text-secondary
- Helper text: --text-muted
- Modal overlay: --overlay-bg
- Input shell: background --bg-secondary, border --border-color
- Primary button: accent-cyan/accent-blue gradient + --btn-primary-text
- Secondary button: --btn-secondary-bg + --btn-secondary-border

## Extension Guardrails

1. Do not hardcode hex for generic backgrounds, text, or borders.
2. Use tokens first; inline dynamic colors only for data-driven cases like role/status badges.
3. Reuse semantic classes before introducing ad-hoc inline styles.
4. If a visual pattern repeats, add a token in theme-override.css and document it here.

## Minimal Example

```css
.new-panel {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.new-panel small {
  color: var(--text-muted);
}

.new-panel button.primary {
  background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue));
  color: var(--btn-primary-text);
}
```
