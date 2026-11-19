/**
 * Idempotent style injection using strictly verified DSH semantic tokens.
 * Avoids all empty DSH aliases documented in dsh-plugin-development (no bg-l1, fill-l1,
 * fill-tertiary, label-quaternary, separator-primary, or --dsw-focus-ring-color).
 * Minimum font size >= 0.75rem (12px at 16px root).
 *
 * Visual rules (docs/design/visual-macos-v6.md):
 * - Every colour is a --mw-* token declared on the roots; fills and lines are mixed from the
 *   label colour so light and dark host themes both work without a theme switch.
 * - System blue is reserved for primary actions, focus rings, links and current room state.
 * - Glass is reserved for floating layers. Page content, cards and code remain opaque.
 * - Lengths are rem; only 1px/2px hairlines are allowed.
 */

export const MUWEAVE_STYLE_ATTR = 'data-muweave-dsh-styles'

export const MUWEAVE_CORE_CSS = `
.mw-dsh-root,
.mw-dsh-float-root,
.mw-dsh-companion,
.mw-theater-companion,
.mw-session-view,
.mw-gen-drawer,
.mw-cmdk,
.mw-theater-header-action {
  --mw-label: var(--dsw-alias-label-primary, #1c1c1e);
  --mw-label-2: var(--dsw-alias-label-secondary, #636366);
  --mw-label-3: color-mix(in oklab, var(--mw-label-2) 72%, transparent);
  --mw-surface: var(--dsw-alias-bg-base, #ffffff);
  --mw-fill-1: color-mix(in oklab, var(--mw-label) 4%, transparent);
  --mw-fill-2: color-mix(in oklab, var(--mw-label) 8%, transparent);
  --mw-fill-3: color-mix(in oklab, var(--mw-label) 13%, transparent);
  --mw-line: color-mix(in oklab, var(--mw-label) 8%, transparent);
  --mw-line-strong: color-mix(in oklab, var(--mw-label) 16%, transparent);
  --mw-selected: var(--mw-fill-3);
  /* System blue is the single accent (macOS 26). It must NOT chain to the host's
     button-primary-fill: that alias is ink, which silently turned the CTA black. */
  --mw-accent: #0A84FF;
  --mw-accent-hover: #0066CC;
  --mw-accent-text: var(--mw-accent);
  --mw-accent-fill: color-mix(in oklab, var(--mw-accent) 12%, var(--mw-surface));
  --mw-on-accent: #ffffff;
  --mw-card: var(--dsw-alias-bg-layer-2, var(--mw-surface));
  --mw-glass: color-mix(in srgb, var(--mw-card) 78%, transparent);
  --mw-glass-solid: var(--mw-card);
  --mw-font: -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
  --mw-serif: var(--mw-font);
  --mw-latin-serif: var(--mw-font);
  --mw-elev-1: var(--dsw-elevation-soft, 0 0.0625rem 0.125rem color-mix(in oklab, var(--mw-label) 8%, transparent), 0 0.5rem 1.5rem -0.875rem color-mix(in oklab, var(--mw-label) 14%, transparent));
  --mw-elev-2: var(--dsw-elevation-prominent, 0 0.125rem 0.25rem color-mix(in oklab, var(--mw-label) 10%, transparent), 0 1rem 2.5rem -1.25rem color-mix(in oklab, var(--mw-label) 20%, transparent));
  --mw-elev-3: var(--dsw-elevation-panel, 0 0.25rem 0.75rem -0.375rem color-mix(in oklab, var(--mw-label) 14%, transparent), 0 1.5rem 3rem -1.25rem color-mix(in oklab, var(--mw-label) 20%, transparent));
  --mw-elev-4: 0 0.0625rem 0.125rem color-mix(in oklab, var(--mw-label) 12%, transparent),
    0 0.75rem 1.5rem -0.75rem color-mix(in oklab, var(--mw-label) 18%, transparent),
    0 2rem 4rem -1.5rem color-mix(in oklab, var(--mw-label) 22%, transparent);
  --mw-bevel: inset 0 0 0 1px color-mix(in oklab, var(--mw-label) 8%, transparent);
  --mw-r-xl: 0.75rem;
  --mw-r-panel: 1rem;
  --mw-ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --mw-blob-1: oklch(0.78 0.05 255);
  --mw-blob-2: oklch(0.8 0.045 345);
  --mw-blob-3: oklch(0.82 0.04 150);
  --mw-ok: oklch(0.6 0.12 155);
  --mw-warn: oklch(0.72 0.14 92);
  --mw-bad: oklch(0.58 0.17 25);
  --mw-info: oklch(0.58 0.09 245);
  --mw-neutral: var(--mw-label-3);
  --mw-r-1: 0.25rem;
  --mw-r-2: 0.5rem;
  --mw-r-3: 0.75rem;
  --mw-r-pill: 62.4375rem;
  --mw-s-1: 0.25rem;
  --mw-s-2: 0.5rem;
  --mw-s-3: 0.75rem;
  --mw-s-4: 1rem;
  --mw-s-5: 1.25rem;
  --mw-s-6: 1.5rem;
  --mw-shadow-1: 0 0.0625rem 0.125rem color-mix(in oklab, var(--mw-label) 8%, transparent);
  --mw-shadow-2: 0 0.75rem 2rem -0.5rem color-mix(in oklab, var(--mw-label) 26%, transparent),
    0 0.125rem 0.375rem color-mix(in oklab, var(--mw-label) 8%, transparent);
  --mw-dur-fast: 120ms;
  --mw-dur-base: 200ms;
  --mw-ease: cubic-bezier(0.2, 0, 0, 1);
  --mw-mono: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  --mw-card-min: 14rem;
  --mw-tone: var(--mw-neutral);
  --mw-bar: 0%;
  color: var(--mw-label);
  font-family: var(--mw-font);
  font-size: 0.875rem;
  line-height: 1.5;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}

.mw-dsh-root *,
.mw-dsh-float-root *,
.mw-dsh-companion * {
  box-sizing: border-box;
}

/* ---------- Shell ---------- */

.mw-dsh-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: calc(100vh - 2rem);
  padding: var(--mw-s-4) var(--mw-s-6) 5.5rem var(--mw-s-6);
  padding-inline-start: calc(var(--mw-s-6) + var(--dsh-frame-leading-clearance, 0rem));
  gap: var(--mw-s-3);
  position: relative;
  isolation: isolate;
  outline: none;
  container-type: inline-size;
  container-name: mw-root;
}

.mw-dsh-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mw-s-2) var(--mw-s-3);
  min-height: 2.5rem;
}

.mw-dsh-title-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mw-dsh-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mw-dsh-subtitle {
  margin: 0;
  color: var(--mw-label-2);
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mw-dsh-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--mw-s-1);
  flex-shrink: 0;
  max-width: 100%;
  margin-inline-start: auto;
}

.mw-dsh-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--mw-s-2);
  padding: var(--mw-s-2) var(--mw-s-3);
  border-radius: var(--mw-r-2);
  background: color-mix(in oklch, var(--mw-tone) 9%, transparent);
  color: var(--mw-label);
  font-size: 0.8125rem;
}

.mw-dsh-notice > .mw-dot {
  margin-top: 0.4375rem;
}

.mw-dsh-notice > p {
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mw-dsh-workspace-grid {
  display: grid;
  gap: var(--mw-s-3);
  flex: 1;
  min-height: 26rem;
}

.mw-dsh-col {
  border: 1px solid var(--mw-line);
  border-radius: var(--mw-r-xl);
  padding: var(--mw-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-3);
  overflow: auto;
  min-width: 0;
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
}

.mw-dsh-col[data-muweave-pane="left"],
.mw-dsh-col[data-muweave-pane="inspector"] {
  background: var(--mw-card);
}

.mw-dsh-col[data-muweave-pane="stage"] {
  padding: 0;
  gap: 0;
  overflow: hidden;
  container-type: inline-size;
  /* Desk v3: the stage is the page, not a card inside it. Cards keep the elevation. */
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}

.mw-dsh-stagebar {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  padding: var(--mw-s-3) var(--mw-s-3) var(--mw-s-2) var(--mw-s-4);
  min-height: 3.25rem;
  position: sticky;
  top: 0;
  z-index: 4;
  /* Transparent so the ambient page shows through: a filled bar reads as a seam across the canvas. */
  background: transparent;
}

.mw-dsh-stage-actions {
  display: flex;
  align-items: center;
  gap: var(--mw-s-1);
  margin-inline-start: auto;
  flex-shrink: 0;
}

.mw-dsh-pop {
  position: relative;
}

.mw-dsh-tablist {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  gap: var(--mw-s-4);
  padding: 0;
  margin-inline-end: auto;
  background: transparent;
  overflow-x: auto;
  scrollbar-width: none;
}

.mw-dsh-tablist::-webkit-scrollbar {
  display: none;
}

.mw-dsh-tab {
  position: relative;
  flex-shrink: 0;
  min-height: 2rem;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--mw-label-3);
  font: inherit;
  font-size: 0.8125rem;
  white-space: nowrap;
  transition: color var(--mw-dur-fast) var(--mw-ease);
}

.mw-dsh-tab::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  bottom: -0.0625rem;
  height: 1px;
  background: transparent;
  transition: background-color var(--mw-dur-fast) var(--mw-ease);
}

.mw-dsh-tab:hover {
  color: var(--mw-label);
  background: transparent;
}

.mw-dsh-tab[aria-selected="true"] {
  color: var(--mw-label);
  font-weight: 600;
  background: transparent;
  box-shadow: none;
}

.mw-dsh-tab[aria-selected="true"]::after {
  background: var(--mw-label);
}

.mw-dsh-viewctl {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  flex-shrink: 0;
}

.mw-dsh-viewctl[data-popover="true"] {
  position: absolute;
  top: calc(100% + var(--mw-s-1));
  right: var(--mw-s-2);
  z-index: 5;
  flex-direction: column;
  align-items: stretch;
  padding: var(--mw-s-2);
  border: 0;
  border-radius: var(--mw-r-xl);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-3);
}

@supports (backdrop-filter: blur(1rem)) {
  .mw-dsh-viewctl[data-popover="true"],
  .mw-room-menu {
    background: var(--mw-glass);
    backdrop-filter: blur(1.5rem) saturate(1.8);
  }
}

.mw-dsh-stage-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--mw-s-2) var(--mw-s-5) var(--mw-s-6);
}

.mw-dsh-stage-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.mw-dsh-stage-scroll > .mw-dsh-stage-body {
  flex: 1 0 auto;
  overflow: visible;
}

.mw-dsh-stage-split {
  display: grid;
  gap: var(--mw-s-3);
}

.mw-dsh-stage-split > * {
  min-width: 0;
}

.mw-dsh-stage-split[data-split="single"] {
  grid-template-columns: minmax(0, 1fr);
}

.mw-dsh-stage-split[data-split="horizontal"] {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mw-dsh-stage-split[data-split="vertical"] {
  grid-template-rows: auto auto;
}

.mw-dsh-compare-pane {
  border: 0;
  border-radius: var(--mw-r-xl);
  padding: var(--mw-s-3);
  background: var(--mw-fill-1);
}

.mw-dsh-stage-split[data-split="horizontal"] > .mw-dsh-compare-pane {
  position: sticky;
  top: 0;
  align-self: start;
}

.mw-dsh-compare-hint {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  margin-top: var(--mw-s-3);
  padding: var(--mw-s-3);
  border: 1px dashed var(--mw-line-strong);
  border-radius: var(--mw-r-2);
  color: var(--mw-label-2);
  font-size: 0.8125rem;
}

/* ---------- Controls ---------- */

.mw-dsh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-height: 2rem;
  padding: 0 0.875rem;
  border-radius: var(--mw-r-2);
  border: 0;
  box-shadow: inset 0 0 0 1px var(--mw-line);
  background: var(--mw-card);
  color: var(--mw-label);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color var(--mw-dur-fast) var(--mw-ease), box-shadow var(--mw-dur-fast) var(--mw-ease),
    color var(--mw-dur-fast) var(--mw-ease);
}

.mw-dsh-btn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--mw-card) 92%, var(--mw-label));
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
}

.mw-dsh-btn:active:not(:disabled) {
  background: var(--mw-fill-3);
}

.mw-dsh-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mw-dsh-btn[data-variant="primary"] {
  background: var(--mw-accent);
  box-shadow: none;
  color: var(--mw-on-accent);
}

.mw-dsh-btn[data-variant="primary"]:hover:not(:disabled) {
  background: var(--mw-accent-hover);
  box-shadow: var(--mw-elev-1);
}

.mw-dsh-btn[data-variant="ghost"] {
  background: transparent;
  box-shadow: none;
  color: var(--mw-label-2);
}

.mw-dsh-btn[data-variant="ghost"]:hover:not(:disabled) {
  background: var(--mw-fill-2);
  box-shadow: none;
  color: var(--mw-label);
}

.mw-dsh-btn[data-variant="quiet"] {
  background: var(--mw-glass-solid);
  box-shadow: inset 0 0 0 0.5px var(--mw-line-strong);
}

.mw-dsh-btn[data-variant="danger"] {
  color: color-mix(in oklch, var(--mw-bad) 80%, var(--mw-label));
}

.mw-dsh-btn[data-size="sm"] {
  min-height: 1.75rem;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  gap: 0.25rem;
}

.mw-dsh-btn[data-icon="true"] {
  padding: 0;
  width: 2rem;
}

.mw-dsh-btn[data-icon="true"][data-size="sm"] {
  width: 1.75rem;
}

.mw-dsh-btn[aria-pressed="true"],
.mw-dsh-btn[data-active="true"] {
  background: var(--mw-selected);
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
  color: var(--mw-label);
  font-weight: 600;
}

.mw-seg {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.1875rem;
  border-radius: var(--mw-r-pill);
  background: var(--mw-fill-2);
}

.mw-seg > .mw-dsh-btn {
  min-height: 1.75rem;
  box-shadow: none;
  background: transparent;
  color: var(--mw-label-2);
  border-radius: var(--mw-r-pill);
}

.mw-seg > .mw-dsh-btn[data-icon="true"] {
  width: 1.75rem;
}

.mw-seg > .mw-dsh-btn:hover:not(:disabled) {
  background: var(--mw-fill-2);
  box-shadow: none;
  color: var(--mw-label);
}

.mw-seg > .mw-dsh-btn[aria-pressed="true"] {
  background: var(--mw-card);
  color: var(--mw-label);
  box-shadow: var(--mw-elev-1);
}

.mw-ic {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.mw-dsh-btn[data-size="sm"] .mw-ic {
  width: 0.875rem;
  height: 0.875rem;
}

.mw-dsh-root :is(button, a, input, select, textarea, [tabindex]):focus-visible,
.mw-dsh-float-root :is(button, a, input, select, textarea, [tabindex]):focus-visible,
.mw-dsh-companion :is(button, a, input, select, textarea, [tabindex]):focus-visible,
.mw-theater-companion :is(button, a, input, select, textarea, [tabindex]):focus-visible,
.mw-session-view :is(button, a, input, select, textarea, [tabindex]):focus-visible,
.mw-gen-drawer :is(button, a, input, select, textarea, audio, [tabindex]):focus-visible,
.mw-theater-header-action:focus-visible {
  outline: 2px solid var(--mw-accent);
  outline-offset: 2px;
}

.mw-dsh-root .mw-dsh-tab:focus-visible {
  outline-offset: -2px;
}

.mw-field {
  display: flex;
  flex-direction: column;
  gap: 0.3125rem;
  min-width: 0;
}

.mw-field > span:first-child {
  color: var(--mw-label-2);
  font-size: 0.75rem;
  font-weight: 500;
}

.mw-input {
  width: 100%;
  min-height: 2.125rem;
  padding: 0 0.75rem;
  border-radius: var(--mw-r-3);
  border: 1px solid var(--mw-line);
  background: var(--mw-surface);
  color: var(--mw-label);
  font: inherit;
  font-size: 0.8125rem;
  transition: border-color var(--mw-dur-fast) var(--mw-ease);
}

.mw-input:hover {
  border-color: var(--mw-line-strong);
}

.mw-input:focus {
  border-color: var(--mw-accent);
}

.mw-form-grid {
  display: grid;
  gap: var(--mw-s-3);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
}

/* ---------- Content ---------- */

.mw-stack {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-3);
  min-width: 0;
}

.mw-stack[data-gap="sm"] {
  gap: var(--mw-s-2);
}

.mw-stack[data-gap="xs"] {
  gap: var(--mw-s-1);
}

.mw-stack[data-gap="lg"] {
  gap: var(--mw-s-5);
}

.mw-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--mw-s-2);
  min-width: 0;
}

.mw-row[data-gap="xs"] {
  gap: var(--mw-s-1);
}

.mw-spread {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mw-s-2);
  min-width: 0;
}

:is(ul, ol).mw-stack,
:is(ul, ol).mw-row {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mw-dsh-card > p,
.mw-dsh-card p {
  margin: 0;
}

.mw-card-hit {
  appearance: none;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-card-hit:focus-visible {
  outline: 2px solid var(--mw-accent);
  outline-offset: 2px;
  border-radius: var(--mw-r-1);
}

.mw-metric[data-tone] > b {
  color: var(--mw-tone);
}

.mw-spacer {
  flex: 1;
}

.mw-split-2 {
  display: grid;
  gap: var(--mw-s-3);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}

.mw-grid-auto {
  display: grid;
  gap: var(--mw-s-3);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--mw-card-min)), 1fr));
}

.mw-section-head {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  min-width: 0;
}

.mw-section-head > h3 {
  margin: 0;
  font-family: var(--mw-serif);
  font-size: 1rem;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-section-head > .mw-meta {
  color: var(--mw-label-3);
  font-size: 0.75rem;
  white-space: nowrap;
}

.mw-section-head > .mw-section-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--mw-s-1);
}

.mw-eyebrow {
  margin: 0;
  color: var(--mw-label-3);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.mw-dsh-card {
  border: 1px solid var(--mw-line);
  border-radius: var(--mw-r-xl);
  padding: var(--mw-s-3) var(--mw-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-2);
  min-width: 0;
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
  transition: box-shadow var(--mw-dur-base) var(--mw-ease-out), background-color var(--mw-dur-fast) var(--mw-ease),
    transform var(--mw-dur-base) var(--mw-ease-out);
}

.mw-dsh-card[data-flat="true"] {
  border-color: transparent;
  background: var(--mw-fill-1);
  box-shadow: none;
}

.mw-dsh-card[aria-selected="true"],
.mw-dsh-card[data-selected="true"] {
  background: var(--mw-card);
  box-shadow: var(--mw-elev-2), inset 0 0 0 1px var(--mw-line-strong);
}

.mw-dsh-card[data-selected="true"] .mw-title {
  font-weight: 600;
}

.mw-dsh-root a {
  color: var(--mw-accent);
}

.mw-dsh-root a:hover {
  color: var(--mw-accent-hover);
}

.mw-title {
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mw-dsh-muted {
  margin: 0;
  color: var(--mw-label-2);
  font-size: 0.75rem;
}

.mw-dsh-badge,
.mw-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  min-height: 1.375rem;
  padding: 0 0.5rem;
  border-radius: var(--mw-r-pill);
  background: var(--mw-fill-2);
  color: var(--mw-label-2);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mw-chip[data-mono="true"] {
  font-family: var(--mw-mono);
  font-weight: 400;
}

.mw-kbd {
  display: inline-flex;
  align-items: center;
  min-height: 1.25rem;
  padding: 0 0.3125rem;
  border-radius: var(--mw-r-1);
  border: 1px solid var(--mw-line);
  font-family: var(--mw-mono);
  font-size: 0.75rem;
  color: var(--mw-label-2);
  white-space: nowrap;
}

.mw-dot {
  display: inline-block;
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--mw-tone);
}

.mw-status {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 1.375rem;
  padding: 0 0.5rem;
  border-radius: var(--mw-r-pill);
  background: color-mix(in oklch, var(--mw-tone) 14%, transparent);
  color: var(--mw-label);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

[data-tone="ok"] { --mw-tone: var(--mw-ok); }
[data-tone="warn"] { --mw-tone: var(--mw-warn); }
[data-tone="bad"] { --mw-tone: var(--mw-bad); }
[data-tone="info"] { --mw-tone: var(--mw-info); }
[data-tone="neutral"] { --mw-tone: var(--mw-neutral); }

.mw-callout {
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--mw-s-2);
  padding: var(--mw-s-2) var(--mw-s-3);
  border-radius: var(--mw-r-3);
  background: color-mix(in oklch, var(--mw-tone) 10%, transparent);
  border: 0;
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.mw-dsh-code {
  font-family: var(--mw-mono);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.mw-pre {
  margin: 0;
  padding: var(--mw-s-3);
  border-radius: var(--mw-r-3);
  background: var(--mw-fill-2);
  font-family: var(--mw-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: auto;
  max-height: 18rem;
}

.mw-dl {
  margin: 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--mw-s-1) var(--mw-s-3);
  font-size: 0.8125rem;
}

.mw-dl > dt {
  color: var(--mw-label-3);
  font-size: 0.75rem;
  line-height: 1.6;
}

.mw-dl > dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mw-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mw-s-2);
  padding: var(--mw-s-6) var(--mw-s-4);
  border: 0;
  border-radius: var(--mw-r-xl);
  background: var(--mw-fill-1);
  color: var(--mw-label-2);
  text-align: center;
  font-family: var(--mw-serif);
  font-size: 0.9375rem;
}

.mw-empty > .mw-ic {
  width: 1.5rem;
  height: 1.5rem;
  color: var(--mw-label-3);
}

.mw-empty > p {
  margin: 0;
  max-width: 28rem;
}

.mw-skeleton {
  border-radius: var(--mw-r-2);
  background: var(--mw-fill-2);
  min-height: 4.5rem;
}

.mw-meter {
  position: relative;
  height: 0.375rem;
  border-radius: var(--mw-r-pill);
  background: var(--mw-fill-3);
  overflow: hidden;
}

.mw-meter::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--mw-bar);
  border-radius: inherit;
  background: var(--mw-tone);
}

.mw-metrics {
  display: grid;
  gap: var(--mw-s-2);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
}

.mw-metric {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: var(--mw-s-3);
  border-radius: var(--mw-r-xl);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
}

.mw-metric > b {
  font-family: var(--mw-latin-serif);
  font-size: 1.5rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

.mw-metric > span {
  color: var(--mw-label-2);
  font-size: 0.75rem;
}

.mw-table-wrap {
  overflow: auto;
  border: 0;
  border-radius: var(--mw-r-xl);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
  max-height: 32rem;
}

.mw-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.8125rem;
}

.mw-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--mw-card);
  box-shadow: inset 0 -1px 0 var(--mw-line);
  color: var(--mw-label-2);
  font-size: 0.75rem;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}

.mw-table th,
.mw-table td {
  padding: var(--mw-s-2) var(--mw-s-3);
  vertical-align: middle;
}

.mw-table tbody tr + tr td {
  border-top: 1px solid var(--mw-line);
}

.mw-table tbody tr:hover td {
  background: var(--mw-fill-1);
}

.mw-table td[data-num="true"],
.mw-table th[data-num="true"] {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.mw-nav {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.mw-nav-item {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  width: 100%;
  min-height: 2rem;
  padding: 0 var(--mw-s-2);
  border: 0;
  border-radius: var(--mw-r-pill);
  background: transparent;
  color: var(--mw-label-2);
  font: inherit;
  font-size: 0.8125rem;
  text-align: left;
}

.mw-nav-item:hover {
  background: var(--mw-fill-2);
  color: var(--mw-label);
}

.mw-nav-item[aria-pressed="true"],
.mw-nav-item[aria-current="true"] {
  background: var(--mw-selected);
  color: var(--mw-label);
  font-weight: 600;
}

.mw-divider {
  width: 100%;
  height: 1px;
  margin: var(--mw-s-1) 0;
  border: 0;
  background: var(--mw-line);
}

/* ---------- Plugin: Eikona ---------- */

.ek-thumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mw-s-1);
  aspect-ratio: 3 / 4;
  max-height: 22rem;
  border-radius: var(--mw-r-3);
  background: var(--mw-fill-2);
  color: var(--mw-label-3);
  font-size: 0.75rem;
  overflow: hidden;
}

.ek-thumb > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ek-cand {
  padding: var(--mw-s-2);
}

.ek-cand-actions {
  display: flex;
  align-items: center;
  gap: var(--mw-s-1);
  flex-wrap: wrap;
}

.ek-cand-actions > .mw-dsh-btn:not([data-icon]) {
  flex: 1 1 4.5rem;
}

/* ---------- Plugin: Kit ---------- */

.kt-tpl {
  appearance: none;
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
  align-items: flex-start;
}

.kt-tpl-grid {
  --mw-card-min: 13rem;
}

/* ---------- Plugin: Script ---------- */

.sc-track {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr);
  align-items: center;
  gap: var(--mw-s-3);
}

.sc-lane {
  display: flex;
  gap: var(--mw-s-1);
  margin: 0;
  padding: var(--mw-s-1);
  list-style: none;
  border-radius: var(--mw-r-xl);
  background: var(--mw-fill-2);
  overflow-x: auto;
}

.sc-block {
  flex: 1 0 9rem;
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-1);
  padding: var(--mw-s-2) var(--mw-s-3);
  border-radius: var(--mw-r-3);
  border: 0;
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
  min-width: 0;
}

.sc-block > .mw-kbd {
  align-self: flex-start;
}

[data-diff-side='candidate'] {
  box-shadow: var(--mw-elev-1), inset 0 0 0 1px var(--mw-line-strong);
}

/* ---------- Plugin: Drama ---------- */

.dr-track {
  position: relative;
  height: 2.5rem;
  border-radius: var(--mw-r-pill);
  background: var(--mw-fill-2);
  overflow: hidden;
}

.dr-clip {
  position: absolute;
  top: 0.25rem;
  bottom: 0.25rem;
  left: var(--dr-start, 0%);
  width: var(--dr-len, 10%);
  display: flex;
  align-items: center;
  padding: 0 var(--mw-s-2);
  border-radius: var(--mw-r-pill);
  border: 0;
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
  font-family: var(--mw-mono);
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- Progress strip ---------- */

.mw-dsh-progress-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mw-s-2) var(--mw-s-3);
  min-height: 2.25rem;
  padding: var(--mw-s-1) var(--mw-s-3);
  border-radius: var(--mw-r-pill);
  border: 0;
  background: color-mix(in oklch, var(--mw-tone) 10%, var(--mw-card));
  box-shadow: var(--mw-elev-1);
  font-size: 0.75rem;
}

.mw-dsh-progress-strip[data-state="idle"] {
  box-shadow: none;
  background: transparent;
  color: var(--mw-label-3);
  min-height: 1.75rem;
  padding-block: 0;
}

.mw-dsh-progress-strip .mw-span {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--mw-label-2);
  font-family: var(--mw-mono);
}

/* ---------- Floating agent ---------- */

.mw-dsh-float-root {
  position: fixed;
  z-index: 40;
  pointer-events: auto;
  border: 0;
  border-radius: var(--mw-r-panel);
  background: var(--mw-glass-solid);
  box-shadow: var(--mw-elev-2), inset 0 0 0 0.5px var(--mw-line-strong);
  padding: var(--mw-s-2);
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-2);
}

@supports (backdrop-filter: blur(1rem)) {
  .mw-dsh-float-root {
    background: var(--mw-glass);
    backdrop-filter: blur(1.5rem) saturate(1.6);
  }
}

.mw-fa-input-row > .mw-dsh-btn[data-variant="primary"] {
  width: 2rem;
  padding: 0;
  border-radius: 50%;
}

.mw-fa-bottom {
  bottom: var(--mw-s-3);
}

.mw-dsh-float-root[data-muweave-floating-agent="panel"] {
  max-height: 22rem;
}

.mw-dsh-float-root[data-muweave-floating-agent="pill"] {
  padding: 0.1875rem;
  border-radius: var(--mw-r-pill);
}

.mw-fa-pill {
  width: 100%;
  border: 0;
  border-radius: var(--mw-r-pill);
  background: transparent;
}

.mw-fa-spark {
  display: inline-flex;
}

.mw-fa-panel {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-2);
  max-height: 11rem;
  overflow: auto;
  padding: var(--mw-s-1) var(--mw-s-1) var(--mw-s-2);
  border-bottom: 1px solid var(--mw-line);
}

.mw-fa-input-row {
  display: flex;
  align-items: center;
  gap: var(--mw-s-1);
}

.mw-fa-input {
  flex: 1;
  min-width: 6rem;
  min-height: 2.25rem;
  padding: 0 var(--mw-s-2);
  border: 0;
  border-radius: var(--mw-r-pill);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.875rem;
}

.mw-fa-input::placeholder {
  color: var(--mw-label-3);
}

.mw-fa-spark {
  color: var(--mw-accent-text);
}

.mw-fa-input-row > .mw-fa-spark {
  padding-left: var(--mw-s-1);
}

/* ---------- Companion (right sidebar) ---------- */

.mw-dsh-companion {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-2);
  padding: var(--mw-s-3);
  min-width: 0;
}

/* ---------- Theater: room switcher ---------- */

.mw-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.mw-theater {
  display: contents;
}

.mw-dsh-title-group[data-theater="true"] {
  flex-direction: row;
  align-items: center;
  gap: var(--mw-s-3);
}

.mw-room-switch {
  position: relative;
  flex-shrink: 0;
}

.mw-room-switch-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--mw-s-2);
  min-height: 2.5rem;
  padding: 0.25rem 0.75rem 0.25rem 0.25rem;
  border: 0;
  border-radius: var(--mw-r-pill);
  background: var(--mw-glass-solid);
  box-shadow: inset 0 0 0 0.5px var(--mw-line-strong), var(--mw-elev-1);
  color: var(--mw-label);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: background-color var(--mw-dur-fast) var(--mw-ease), box-shadow var(--mw-dur-fast) var(--mw-ease);
}

.mw-room-switch-btn:hover,
.mw-room-switch-btn[aria-expanded="true"] {
  background: var(--mw-card);
  box-shadow: inset 0 0 0 0.5px var(--mw-line-strong), var(--mw-elev-2);
}

.mw-room-switch-btn > .mw-ic {
  color: var(--mw-label-2);
  transition: transform var(--mw-dur-fast) var(--mw-ease);
}

.mw-room-switch-btn[aria-expanded="true"] > .mw-ic {
  transform: rotate(180deg);
}

.mw-room-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  border-radius: 50%;
  border: 0;
  background: var(--mw-accent);
  color: var(--mw-on-accent);
}

.mw-room-switch-text,
.mw-room-item-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.mw-room-switch-eyebrow {
  color: var(--mw-label-3);
  font-size: 0.6875rem;
  font-weight: 500;
}

.mw-room-switch-name {
  font-family: var(--mw-serif);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.mw-room-menu {
  position: absolute;
  top: calc(100% + var(--mw-s-1));
  left: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  width: max-content;
  min-width: 18rem;
  max-width: min(26rem, calc(100vw - 2rem));
  padding: var(--mw-s-1);
  border: 0;
  border-radius: var(--mw-r-xl);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-3), inset 0 0 0 0.5px var(--mw-line);
  animation: mw-fade-in var(--mw-dur-fast) var(--mw-ease-out);
}

.mw-room-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 1rem;
  align-items: center;
  gap: var(--mw-s-2);
  padding: 0.375rem var(--mw-s-2) 0.375rem 0.375rem;
  border: 0;
  border-radius: var(--mw-r-3);
  background: transparent;
  color: var(--mw-label);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.mw-room-item:hover,
.mw-room-item:focus-visible {
  background: var(--mw-fill-2);
}

.mw-room-item[aria-checked="true"] {
  background: var(--mw-selected);
}

.mw-room-item .mw-room-icon {
  background: var(--mw-fill-2);
  color: var(--mw-label);
}

.mw-room-nav {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.25rem;
  border-radius: var(--mw-r-pill);
  background: var(--mw-glass-solid);
  box-shadow: inset 0 0 0 0.5px var(--mw-line-strong), var(--mw-elev-1);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.mw-room-nav-btn {
  flex-shrink: 0;
  min-height: 2rem;
  padding: 0 0.9375rem;
  border: 0;
  border-radius: var(--mw-r-pill);
  background: transparent;
  color: var(--mw-label-2);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--mw-dur-fast) var(--mw-ease), color var(--mw-dur-fast) var(--mw-ease);
}

.mw-room-nav-btn:hover {
  background: var(--mw-fill-2);
  color: var(--mw-label);
}

.mw-room-nav-btn[aria-current="page"] {
  background: var(--mw-accent);
  color: var(--mw-on-accent);
  font-weight: 600;
}

/* Wide stage: the pill nav names the rooms, the switcher collapses to its round icon + chevron. */
.mw-dsh-title-group[data-theater="true"] .mw-room-switch-text {
  display: none;
}

@container mw-root (max-width: 54rem) {
  .mw-room-nav {
    display: none;
  }
  .mw-dsh-title-group[data-theater="true"] .mw-room-switch-text {
    display: flex;
  }
}

.mw-room-item-name {
  font-size: 0.8125rem;
  font-weight: 600;
}

.mw-room-item-desc {
  color: var(--mw-label-2);
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mw-room-check {
  display: inline-flex;
  color: var(--mw-label);
}

/* ---------- Theater: header action and companion ---------- */

.mw-theater-header-action.mw-dsh-btn {
  min-height: 1.75rem;
  padding: 0 0.625rem;
  gap: 0.25rem;
  box-shadow: none;
  background: transparent;
  color: var(--mw-label-2);
  font-size: 0.75rem;
}

.mw-theater-header-action.mw-dsh-btn:hover {
  background: var(--mw-fill-2);
  color: var(--mw-label);
}

.mw-theater-companion {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mw-theater-companion-rooms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.125rem;
  margin: var(--mw-s-3) var(--mw-s-3) 0 var(--mw-s-3);
  padding: 0.1875rem;
  border-radius: var(--mw-r-xl);
  background: var(--mw-fill-2);
}

.mw-theater-companion-rooms > .mw-dsh-btn {
  flex: 1 1 auto;
  min-height: 1.75rem;
  box-shadow: none;
  background: transparent;
  color: var(--mw-label-2);
  border-radius: var(--mw-r-pill);
}

.mw-theater-companion-rooms > .mw-dsh-btn[aria-pressed="true"] {
  background: var(--mw-card);
  color: var(--mw-label);
  box-shadow: var(--mw-elev-1);
}

/* ---------- Session 做剧 view and compact drama pieces ---------- */

.mw-session-view {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-3);
  width: 100%;
  max-width: 52rem;
  margin: 0 auto;
  padding: var(--mw-s-4) var(--mw-s-5) var(--mw-s-6);
  color: var(--mw-label);
  font-size: 0.8125rem;
  animation: mw-fade-in var(--mw-dur-base) var(--mw-ease);
}

.mw-sv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mw-s-3);
  flex-wrap: wrap;
}

.mw-sv-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mw-s-3);
  min-width: 0;
}

.mw-sv-body > * {
  align-self: stretch;
}

.mw-sv-body > .mw-dsh-btn {
  align-self: flex-start;
}

.mw-sv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mw-s-2);
  padding: var(--mw-s-6) var(--mw-s-4);
  border: 0;
  border-radius: var(--mw-r-panel);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
  text-align: center;
}

.mw-sv-empty .mw-empty {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 1.125rem;
  color: var(--mw-label);
}

.mw-sv-log,
.mw-sv-assets {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 0;
  border-radius: var(--mw-r-xl);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
  overflow: hidden;
}

.mw-sv-log-row,
.mw-sv-asset {
  display: grid;
  align-items: center;
  gap: var(--mw-s-2) var(--mw-s-3);
  padding: var(--mw-s-3) var(--mw-s-4);
  min-width: 0;
}

.mw-sv-log-row {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.mw-sv-asset {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.mw-sv-log-row + .mw-sv-log-row,
.mw-sv-asset + .mw-sv-asset {
  border-top: 1px solid var(--mw-line);
}

.mw-sv-log-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mw-progress-line dl {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mw-s-1) var(--mw-s-4);
  margin: 0;
}

.mw-progress-item {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
}

.mw-progress-item dt {
  color: var(--mw-label-2);
  font-size: 0.75rem;
}

.mw-progress-item dd {
  margin: 0;
  font-family: var(--mw-latin-serif);
  font-size: 1.25rem;
  font-style: italic;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.mw-shot-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: var(--mw-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mw-shot {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.mw-shot-frame {
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  aspect-ratio: 16 / 9;
  padding: 0.25rem 0.375rem;
  border: 0;
  border-radius: var(--mw-r-3);
  background: var(--mw-fill-2);
  color: var(--mw-label-2);
  font-family: var(--mw-latin-serif);
  font-style: italic;
  font-size: 0.875rem;
}

.mw-shot-ref {
  font-family: var(--mw-mono);
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mw-shot-dur {
  color: var(--mw-label-3);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.mw-readiness {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.mw-readiness-count {
  margin-inline-start: 0.25rem;
  color: var(--mw-label-2);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.mw-scene-mini {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: var(--mw-s-3) var(--mw-s-4);
  border: 0;
  border-radius: var(--mw-r-xl);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1);
  min-width: 0;
}

@media (max-width: 40rem) {
  .mw-sv-log-row,
  .mw-sv-asset {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .mw-sv-log-row > .mw-row,
  .mw-sv-asset > .mw-readiness {
    grid-column: 1 / -1;
  }
}

/* ---------- Editorial v2: ambient, hero, collage, cards ---------- */

.mw-ambient {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.mw-ambient > i {
  position: absolute;
  width: 42rem;
  height: 42rem;
  border-radius: 50%;
  filter: blur(4rem);
  opacity: 0.55;
  animation: mw-drift 42s var(--mw-ease) infinite alternate;
}

.mw-ambient > i:nth-child(1) {
  top: -16rem;
  left: -10rem;
  background: radial-gradient(circle, color-mix(in oklab, var(--mw-blob-1) 70%, var(--mw-surface)), transparent 68%);
}

.mw-ambient > i:nth-child(2) {
  top: -12rem;
  right: -14rem;
  background: radial-gradient(circle, color-mix(in oklab, var(--mw-blob-2) 70%, var(--mw-surface)), transparent 68%);
  animation-delay: -14s;
}

.mw-ambient > i:nth-child(3) {
  top: 18rem;
  left: 30%;
  background: radial-gradient(circle, color-mix(in oklab, var(--mw-blob-3) 70%, var(--mw-surface)), transparent 68%);
  animation-delay: -28s;
}

body[data-ds-dark-theme] .mw-ambient > i {
  opacity: 0.18;
}

@keyframes mw-drift {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to { transform: translate3d(3rem, 2rem, 0) scale(1.08); }
}

.mw-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--mw-s-4) var(--mw-s-6);
  padding: var(--mw-s-4) var(--mw-s-5) var(--mw-s-3);
  animation: mw-rise var(--mw-dur-base) var(--mw-ease-out);
}

.mw-hero-main {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-3);
  min-width: 0;
}

.mw-hero-eyebrow {
  margin: 0;
  color: var(--mw-label-2);
  font-family: var(--mw-latin-serif);
  font-size: 0.875rem;
  font-style: italic;
}

.mw-hero-title {
  margin: 0;
  font-family: var(--mw-serif);
  font-size: clamp(1.625rem, 3.4cqi, 2.5rem);
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.mw-hero-lede {
  margin: 0;
  max-width: 40rem;
  color: var(--mw-label-2);
  font-family: var(--mw-serif);
  font-size: 1rem;
  line-height: 1.8;
}

.mw-hero-lede .mw-inline-thumb {
  display: inline-block;
  width: 2.75rem;
  height: 1.75rem;
  margin: 0 0.25rem;
  vertical-align: -0.375rem;
  border-radius: var(--mw-r-pill);
  object-fit: cover;
  box-shadow: var(--mw-elev-1);
}

.mw-hero-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mw-s-2) var(--mw-s-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mw-hero-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.375rem;
  color: var(--mw-label-2);
  font-size: 0.8125rem;
}

.mw-hero-stat > .mw-ic {
  align-self: center;
  color: var(--mw-label-3);
}

.mw-hero-stat > b {
  color: var(--mw-label);
  font-family: var(--mw-latin-serif);
  font-size: 1.25rem;
  font-style: italic;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.mw-hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mw-s-2);
}

.mw-hero-actions .mw-dsh-btn {
  min-height: 2.25rem;
  padding: 0 1rem;
}

.mw-collage {
  position: relative;
  width: 15rem;
  height: 11.5rem;
  flex-shrink: 0;
}

.mw-collage-tile {
  position: absolute;
  width: 8.5rem;
  aspect-ratio: 3 / 4;
  margin: 0;
  padding: 0.375rem;
  border-radius: var(--mw-r-xl);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-2);
  overflow: hidden;
  transition: transform var(--mw-dur-base) var(--mw-ease-out);
}

.mw-collage-tile > img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--mw-r-3);
  object-fit: cover;
}

.mw-collage-tile:nth-child(1) { left: 0; top: 1.25rem; transform: rotate(-6deg); z-index: 1; }
.mw-collage-tile:nth-child(2) { left: 3.25rem; top: 0; transform: rotate(2deg); z-index: 2; }
.mw-collage-tile:nth-child(3) { left: 6.5rem; top: 1.75rem; transform: rotate(7deg); z-index: 3; }
.mw-collage[data-count="1"] .mw-collage-tile { left: 3.25rem; top: 0.5rem; transform: rotate(-3deg); }
.mw-collage[data-count="2"] .mw-collage-tile:nth-child(2) { left: 5.5rem; top: 0.75rem; transform: rotate(5deg); }
.mw-collage:hover .mw-collage-tile:nth-child(1) { transform: rotate(-9deg) translateX(-0.5rem); }
.mw-collage:hover .mw-collage-tile:nth-child(3) { transform: rotate(10deg) translateX(0.5rem); }

.mw-poster {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  padding: var(--mw-s-3);
  border-radius: var(--mw-r-3);
  background: linear-gradient(160deg, var(--mw-fill-1), var(--mw-fill-3));
  color: var(--mw-label);
  overflow: hidden;
}

.mw-poster > b {
  font-family: var(--mw-serif);
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.mw-poster > span {
  color: var(--mw-label-2);
  font-family: var(--mw-latin-serif);
  font-size: 0.875rem;
  font-style: italic;
}

@container (max-width: 40rem) {
  .mw-hero {
    grid-template-columns: minmax(0, 1fr);
    padding-inline: var(--mw-s-3);
  }
  .mw-hero .mw-collage {
    display: none;
  }
}

.mw-masonry {
  columns: var(--mw-card-min) 4;
  column-gap: var(--mw-s-3);
}

.mw-masonry > * {
  break-inside: avoid;
  margin-bottom: var(--mw-s-3);
}

/* Entrance motion belongs to the column container, never to an individual card: a CSS animation
   owns the transform channel while it runs, which would silently cancel the pointer tilt. */
.mw-masonry {
  animation: mw-fade-in var(--mw-dur-base) var(--mw-ease-out) both;
}

.mw-media-card {
  position: relative;
  padding: 0;
  gap: 0;
  overflow: hidden;
}

.mw-media-card-media {
  position: relative;
  display: flex;
  margin: 0.375rem 0.375rem 0;
  aspect-ratio: var(--mw-media-ratio, 4 / 3);
  border-radius: var(--mw-r-3);
  background: var(--mw-fill-2);
  overflow: hidden;
}

.mw-media-card-media > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s var(--mw-ease-out);
}

.mw-media-card:hover .mw-media-card-media > img {
  transform: scale(1.03);
}

.mw-media-card-media > .mw-poster,
.mw-media-card-media > .ek-thumb {
  flex: 1;
  max-height: none;
  aspect-ratio: auto;
  border-radius: 0;
}

.mw-media-card-media > .ek-thumb > img {
  object-fit: cover;
}

.mw-media-card-actions {
  position: absolute;
  top: 0.875rem;
  right: 0.875rem;
  z-index: 2;
  display: flex;
  gap: 0.25rem;
  opacity: 0;
  transform: translateY(-0.25rem);
  transition: opacity var(--mw-dur-fast) var(--mw-ease), transform var(--mw-dur-fast) var(--mw-ease-out);
}

.mw-media-card:hover .mw-media-card-actions,
.mw-media-card:focus-within .mw-media-card-actions {
  opacity: 1;
  transform: none;
}

@media (hover: none) {
  .mw-media-card-actions {
    opacity: 1;
    transform: none;
  }
}

.mw-media-card-actions > .mw-dsh-btn {
  width: 2rem;
  min-height: 2rem;
  padding: 0;
  border-radius: 50%;
  background: var(--mw-glass-solid);
  box-shadow: inset 0 0 0 0.5px var(--mw-line-strong), var(--mw-elev-1);
}

.mw-media-card-body {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-2);
  padding: var(--mw-s-3) var(--mw-s-4) var(--mw-s-4);
  min-width: 0;
}

.mw-media-card-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.mw-media-card-meta {
  margin: 0;
  color: var(--mw-label-2);
  font-size: 0.75rem;
}

.mw-num {
  font-family: var(--mw-font);
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

.mw-quote-card {
  margin: 0;
  font-family: var(--mw-serif);
  font-size: 1.0625rem;
  line-height: 1.75;
}

.mw-quote-card blockquote {
  margin: 0;
}

.mw-quote-card::before {
  content: '\\201C';
  display: block;
  height: 1.5rem;
  color: var(--mw-label-3);
  font-family: var(--mw-latin-serif);
  font-size: 2.5rem;
  line-height: 1;
}

/* Emphasis card: a full-bleed blue slab is too loud for macOS. Keep the surface quiet and use
   the system blue only on the hairline, the eyebrow and the primary action. */
.mw-dsh-card[data-ink="true"] {
  background: var(--mw-card);
  color: var(--mw-label);
  box-shadow: var(--mw-elev-1), inset 0 0 0 1px color-mix(in oklab, var(--mw-accent) 55%, transparent);
}

.mw-dsh-card[data-ink="true"] :is(.mw-dsh-muted, .mw-media-card-meta) {
  color: var(--mw-label-2);
}

.mw-dsh-card[data-ink="true"] .mw-eyebrow {
  color: var(--mw-accent);
}

.mw-dsh-card[data-ink="true"] .mw-dsh-btn {
  background: var(--mw-accent);
  color: var(--mw-on-accent);
  box-shadow: none;
}

.mw-card-title {
  margin: 0;
  font-family: var(--mw-serif);
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.mw-board {
  display: grid;
  gap: var(--mw-s-3);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--mw-card-min)), 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}

.mw-board .mw-poster {
  align-items: flex-start;
}

.mw-board .mw-poster > b {
  font-family: var(--mw-latin-serif);
  font-size: 2rem;
  font-style: italic;
  font-weight: 400;
  color: var(--mw-label-2);
}

.mw-read {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-4);
  padding: var(--mw-s-5) var(--mw-s-5) var(--mw-s-6);
  font-family: var(--mw-serif);
  font-size: 1rem;
  line-height: 1.9;
}

.mw-read h4 {
  margin: 0 0 var(--mw-s-1);
  font-family: var(--mw-serif);
  font-size: 1.125rem;
  font-weight: 600;
}

.mw-read p {
  margin: 0;
}

.mw-read .mw-read-beat {
  color: var(--mw-label-2);
  font-family: var(--mw-font);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.dr-axes {
  margin: var(--mw-s-2) 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.8125rem;
}

.mw-view-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mw-s-2);
  flex-wrap: wrap;
}

/* ---------- Motion ---------- */

@keyframes mw-fade-in {
  from { opacity: 0; transform: translateY(0.25rem); }
  to { opacity: 1; transform: none; }
}

@keyframes mw-rise {
  from { opacity: 0; transform: translateY(0.5rem); }
  to { opacity: 1; transform: none; }
}

@keyframes mw-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.mw-dsh-root .mw-dsh-stage-split,
.mw-dsh-root .mw-dsh-notice,
.mw-dsh-root .mw-dsh-viewctl[data-popover="true"] {
  animation: mw-fade-in var(--mw-dur-base) var(--mw-ease);
}

.mw-dsh-root .mw-skeleton,
.mw-dsh-root .mw-dot[data-live="true"] {
  animation: mw-pulse 1.4s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .mw-dsh-root *,
  .mw-dsh-float-root *,
  .mw-dsh-companion *,
  .mw-theater-companion *,
  .mw-session-view * {
    animation: none !important;
    transition: none !important;
  }
  .mw-ambient > i {
    animation: none !important;
  }
}

/* ---------- Narrow ---------- */

@media (max-width: 56.25rem) {
  .mw-dsh-root {
    padding: var(--mw-s-3) var(--mw-s-3) 5.5rem var(--mw-s-3);
    padding-inline-start: calc(var(--mw-s-3) + var(--dsh-frame-leading-clearance, 0rem));
  }
  .mw-dsh-stage-split[data-split="horizontal"] {
    grid-template-columns: minmax(0, 1fr);
  }
  .mw-dsh-stage-body {
    padding: var(--mw-s-3);
  }
}

@container (max-width: 36rem) {
  .mw-dsh-stage-split[data-split="horizontal"] {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* ---------- Generation desk ---------- */

.mw-gen-badge {
  display: inline-grid;
  place-items: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.3125rem;
  border-radius: var(--mw-r-pill);
  background: var(--mw-accent);
  color: var(--mw-on-accent);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.mw-gen-drawer {
  position: fixed;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: 40;
  width: min(26rem, 100vw);
  overflow-y: auto;
  padding: var(--mw-s-4);
  border-start-start-radius: var(--mw-r-panel);
  border-end-start-radius: var(--mw-r-panel);
  background: var(--mw-glass-solid);
  box-shadow: var(--mw-elev-3), inset 0 0 0 0.5px var(--mw-line-strong);
  animation: mw-rise var(--mw-dur-base) var(--mw-ease-out) both;
}

@supports (backdrop-filter: blur(1rem)) {
  .mw-gen-drawer {
    background: var(--mw-glass);
    backdrop-filter: blur(1.25rem);
  }
}

.mw-gen-drawer *,
.mw-gen-drawer *::before,
.mw-gen-drawer *::after {
  box-sizing: border-box;
}

.mw-gen-body {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-3);
}

.mw-gen-caps,
.mw-gen-slots,
.mw-gen-plan {
  display: grid;
  gap: var(--mw-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mw-gen-plan {
  gap: 0.125rem;
  color: var(--mw-label-2);
  font-size: 0.8125rem;
}

.mw-gen-cap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  width: 100%;
  padding: var(--mw-s-3);
  border: 0;
  border-radius: var(--mw-r-3);
  box-shadow: inset 0 0 0 1px var(--mw-line);
  background: var(--mw-card);
  color: var(--mw-label);
  font: inherit;
  text-align: start;
}

.mw-gen-cap:hover:not(:disabled) {
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
}

.mw-gen-cap[aria-pressed="true"] {
  background: var(--mw-selected);
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
}

.mw-gen-cap:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.mw-gen-slots {
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
}

.mw-gen-slot {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-2);
  padding: var(--mw-s-2);
  border-radius: var(--mw-r-3);
  background: var(--mw-fill-1);
  box-shadow: inset 0 0 0 1px var(--mw-line);
}

.mw-gen-slot[data-status="failed"] {
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--mw-bad) 40%, transparent);
}

.mw-gen-slot-body {
  display: grid;
  place-items: center;
  min-height: 3.5rem;
}

.mw-gen-slot audio {
  width: 100%;
  min-width: 0;
}

.mw-gen-slot .ek-thumb img {
  width: 100%;
  border-radius: var(--mw-r-2);
}

.mw-gen-approval {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-3);
  padding: var(--mw-s-3);
  border-radius: var(--mw-r-3);
  background: var(--mw-fill-1);
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
}

.mw-gen-check {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
}

.mw-gen-drawer textarea.mw-input {
  min-height: 5rem;
  padding-block: var(--mw-s-2);
  resize: vertical;
}

/* Shot cards of the 成稿 room and the drama grid: linked keyframe, generate action. */
.mw-shot-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mw-script-scene {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-2);
}

.mw-draft-layout {
  display: grid;
  gap: var(--mw-s-4);
  grid-template-columns: minmax(0, 1fr);
}

@container mw-root (min-width: 56rem) {
  .mw-draft-layout {
    grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
    align-items: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mw-gen-drawer {
    animation: none;
  }
}

/* ---- Desk v3: room filter popover, command palette, quieter stage ---- */

.mw-dsh-filter-panel {
  width: 19rem;
  max-height: min(30rem, 70vh);
  overflow-x: hidden;
  overflow-y: auto;
  align-items: stretch;
}

.mw-dsh-filter-panel .mw-spread,
.mw-dsh-filter-panel .mw-nav-item {
  min-width: 0;
}

.mw-dsh-filter-panel .mw-spread > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-cmdk {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh var(--mw-s-4) var(--mw-s-4);
}

.mw-cmdk-scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in oklch, var(--mw-label) 42%, transparent);
  animation: mw-fade var(--mw-dur-fast) var(--mw-ease) both;
}

.mw-cmdk-panel {
  position: relative;
  width: min(34rem, 100%);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--mw-r-panel);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-3), inset 0 0 0 1px var(--mw-line);
  overflow: hidden;
  animation: mw-rise var(--mw-dur-base) var(--mw-ease-out) both;
}

@supports (backdrop-filter: blur(1rem)) {
  .mw-cmdk-panel {
    background: var(--mw-glass);
    backdrop-filter: blur(1.5rem) saturate(1.8);
  }
}

.mw-cmdk-field {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  padding: var(--mw-s-3) var(--mw-s-4);
  box-shadow: inset 0 -1px 0 var(--mw-line);
  color: var(--mw-label-3);
}

.mw-cmdk-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--mw-label);
  font: inherit;
  font-size: 0.9375rem;
  outline: none;
}

.mw-cmdk-input::placeholder {
  color: var(--mw-label-3);
}

.mw-cmdk-list {
  margin: 0;
  padding: var(--mw-s-2);
  list-style: none;
  overflow: auto;
  flex: 1;
}

.mw-cmdk-list ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mw-cmdk-group {
  margin: var(--mw-s-2) var(--mw-s-2) var(--mw-s-1);
  color: var(--mw-label-3);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mw-cmdk-row {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  width: 100%;
  padding: 0.5625rem var(--mw-s-2);
  border: 0;
  border-radius: var(--mw-r-2);
  background: transparent;
  color: var(--mw-label);
  font: inherit;
  font-size: 0.875rem;
  text-align: start;
  cursor: pointer;
}

.mw-cmdk-row[data-active="true"] {
  background: var(--mw-selected);
}

.mw-cmdk-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-cmdk-hint {
  color: var(--mw-label-3);
  font-size: 0.75rem;
}

.mw-cmdk-current {
  display: inline-flex;
  color: var(--mw-label-2);
}

.mw-cmdk-empty {
  padding: var(--mw-s-5) var(--mw-s-3);
  color: var(--mw-label-3);
  font-size: 0.8125rem;
  text-align: center;
}

/* Right-click menu in the palette: position comes from --mw-menu-x/y set inline by the caller. */
/* Project context bar: the entry that used to hide inside the collapsed left drawer. */
.mw-stage-projectbar {
  padding: var(--mw-s-3) var(--mw-s-5) 0;
}

.mw-project-bar {
  position: relative;
  flex-wrap: wrap;
}

.mw-project-popover {
  position: absolute;
  inset-block-start: calc(100% + 0.25rem);
  inset-inline-start: 0;
  z-index: 40;
  width: min(28rem, calc(100vw - 4rem));
  max-height: min(32rem, 70vh);
  overflow-y: auto;
  padding: var(--mw-s-3);
  border-radius: var(--mw-r-xl);
  background: var(--mw-glass-solid);
  box-shadow: var(--mw-elev-3), var(--mw-bevel);
}

@supports (backdrop-filter: blur(1rem)) {
  .mw-project-popover {
    background: var(--mw-glass);
    backdrop-filter: blur(1.5rem) saturate(1.6);
  }
}

.mw-truncate {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-cmdk-menu {
  position: fixed;
  left: var(--mw-menu-x, 0);
  top: var(--mw-menu-y, 0);
  min-width: 10rem;
  padding: var(--mw-s-1);
  z-index: 80;
}

/* @ chips in the composer: icon, status dot and remove button keep a stable rhythm. */
.mw-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--mw-s-1);
  min-width: 0;
  max-width: 16rem;
}

.mw-chip > .mw-title,
.mw-chip > span:not(.mw-dot) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-chip > .mw-ic,
.mw-chip > .mw-dot,
.mw-chip > .mw-dsh-btn {
  flex: 0 0 auto;
}

/* Session workflow: a vertical thread connecting steps, drawn from the row itself. */
.mw-sv-log-row {
  position: relative;
  padding-inline-start: var(--mw-s-4);
}

.mw-sv-log-row::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0.3125rem;
  width: 1px;
  background: var(--mw-line);
}

.mw-sv-log-row:first-child::before {
  inset-block-start: 50%;
}

.mw-sv-log-row:last-child::before {
  inset-block-end: 50%;
}

.mw-cmdk-footer {
  margin: 0;
  padding: var(--mw-s-2) var(--mw-s-4);
  box-shadow: inset 0 1px 0 var(--mw-line);
  color: var(--mw-label-3);
  font-size: 0.6875rem;
}

@media (prefers-reduced-motion: reduce) {
  .mw-cmdk-scrim,
  .mw-cmdk-panel {
    animation: none;
  }
}

/* ---- Desk v4: floating layers get real depth (contact + mid + wide shadow) ---- */

.mw-cmdk-panel {
  box-shadow: var(--mw-elev-4), var(--mw-bevel);
  animation: mw-pop var(--mw-dur-base) var(--mw-ease-out) both;
}

@keyframes mw-pop {
  from {
    opacity: 0;
    transform: perspective(60rem) translateY(0.5rem) rotateX(1.2deg) scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.mw-dsh-card[data-interactive="true"]:hover {
  transform: translateY(-0.125rem);
  box-shadow: var(--mw-elev-2);
}

.mw-dsh-card[data-interactive="true"]:hover:active {
  transform: translateY(0);
}

/* Tool catalog rows: name on the left, owner and the blocking reason on the right. */
.mw-sv-tool {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--mw-s-2);
  padding-block: var(--mw-s-1);
  border-block-end: 1px solid var(--mw-line);
}

.mw-sv-tool:last-child {
  border-block-end: none;
}

.mw-sv-tool > .mw-dsh-btn {
  flex: 1 1 auto;
  justify-content: flex-start;
  text-align: start;
  min-width: 0;
}

.mw-sv-tool > .mw-dsh-btn > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-sv-tool > .mw-dsh-muted {
  flex: 0 0 auto;
  font-size: 0.6875rem;
  white-space: nowrap;
}

/* Composer action bar: one row that scrolls, never a two-row block that eats the stage. */
[data-composer-actions="true"] {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--mw-s-1);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding-block: 0.125rem;
  /* Trailing room so the last action is not sliced by the panel edge while scrolling. */
  padding-inline-end: var(--mw-s-3);
  scroll-padding-inline-end: var(--mw-s-3);
  mask-image: linear-gradient(to right, black calc(100% - 1.5rem), transparent);
}

[data-composer-actions="true"]::-webkit-scrollbar {
  display: none;
}

[data-composer-actions="true"] > .mw-dsh-btn {
  flex: 0 0 auto;
  max-width: 11rem;
}

[data-composer-actions="true"] > .mw-dsh-btn > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Keep the floating composer from swallowing the stage on short viewports. */
.mw-dsh-float-root {
  max-height: min(22rem, 46vh);
  overflow: visible;
}

.mw-fa-panel {
  max-height: min(20rem, 42vh);
  overflow-y: auto;
}

.mw-fa-hint {
  margin: 0;
  padding: var(--mw-s-2) 0;
  color: var(--mw-label-3);
  font-family: var(--mw-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.02em;
}

.mw-fa-panel,
.mw-dsh-root [data-muweave-floating-agent="panel"] {
  box-shadow: var(--mw-elev-3), var(--mw-bevel);
}

.mw-dsh-root [data-muweave-floating-agent="pill"],
.mw-dsh-root [data-muweave-floating-agent="bar"] {
  box-shadow: var(--mw-elev-2), var(--mw-bevel);
}

.mw-gen-drawer {
  box-shadow: var(--mw-elev-4), var(--mw-bevel);
}

.mw-tilt {
  --mw-tilt-x: 0;
  --mw-tilt-y: 0;
  transform: perspective(60rem) rotateX(calc(var(--mw-tilt-y, 0) * -3deg))
    rotateY(calc(var(--mw-tilt-x, 0) * 3deg));
  transition: transform var(--mw-dur-base) var(--mw-ease-out), box-shadow var(--mw-dur-base) var(--mw-ease-out);
  transform-style: preserve-3d;
}

.mw-tilt:hover {
  box-shadow: var(--mw-elev-3);
}

/* Delegated tilt: any interactive card tilts, whether or not a room passes tilt explicitly.
   Scoped with .mw-dsh-root so the reduced-motion reset can never out-rank it by source order. */
/* Interactive cards carry no entrance animation on purpose: a CSS animation owns its transform
   channel while running (even with fill-mode), which silently kills the pointer tilt. Entrance
   polish lives on the room container (mw-spring-in) instead. */

.mw-dsh-root .mw-dsh-card[data-interactive="true"][data-mw-tilting="true"] {
  transform: perspective(60rem) rotateX(calc(var(--mw-tilt-y, 0) * -3deg))
    rotateY(calc(var(--mw-tilt-x, 0) * 3deg));
  box-shadow: var(--mw-elev-3);
}

.mw-dsh-root .mw-dsh-card.mw-tilt[data-interactive="true"]:hover {
  transform: perspective(60rem) rotateX(calc(var(--mw-tilt-y, 0) * -3deg))
    rotateY(calc(var(--mw-tilt-x, 0) * 3deg));
  box-shadow: var(--mw-elev-3);
}

.mw-parallax {
  --mw-parallax-x: 0;
  --mw-parallax-y: 0;
}

.mw-parallax .mw-ambient {
  transform: translate3d(
    clamp(-0.75rem, calc(var(--mw-parallax-x, 0) * 0.75rem), 0.75rem),
    clamp(-0.75rem, calc(var(--mw-parallax-y, 0) * 0.75rem), 0.75rem),
    0
  );
  transition: transform var(--mw-dur-base) var(--mw-ease-out);
}

@keyframes mw-spring-in {
  from {
    transform: scale(0.985) translateY(0.375rem);
  }
  to {
    transform: scale(1) translateY(0);
  }
}

.mw-spring-in {
  animation: mw-spring-in var(--mw-dur-base) var(--mw-ease-out) both;
}

@media (prefers-reduced-motion: reduce) {
  .mw-cmdk-panel,
  .mw-dsh-card,
  .mw-tilt,
  .mw-spring-in,
  .mw-parallax .mw-ambient {
    animation: none;
    transition: none;
    transform: none;
  }

  .mw-dsh-card[data-interactive="true"]:hover {
    transform: none;
  }

  .mw-dsh-card[data-interactive="true"][data-mw-tilting="true"],
  .mw-dsh-card.mw-tilt[data-interactive="true"]:hover {
    transform: none;
  }
}

/* ---- Desk v4 + v7: schedule room. The calendar is the page; the backlog is a quieter side column. ---- */

.mw-stage-projectbar .mw-sched-project-title {
  color: var(--mw-label);
  font-size: 0.8125rem;
  font-weight: 600;
}

.mw-sched-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mw-s-2) var(--mw-s-4);
  padding-block-end: var(--mw-s-2);
  border-block-end: 1px solid var(--mw-line);
}

.mw-sched-toolbar-nav {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  min-width: 0;
  flex: 1 1 auto;
}

.mw-sched-month {
  margin: 0;
  color: var(--mw-label);
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.mw-sched-monthnav {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
}

.mw-sched-next .mw-ic {
  transform: scaleX(-1);
}

.mw-sched-count {
  min-width: 1.25rem;
  padding: 0 0.3125rem;
  border-radius: var(--mw-r-pill);
  background: var(--mw-fill-2);
  color: var(--mw-label-2);
  font-family: var(--mw-mono);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.mw-sched-backlog-toggle[aria-expanded="true"] {
  background: var(--mw-fill-2);
}

.mw-sched-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--mw-s-1) var(--mw-s-3);
  margin: 0;
}

.mw-sched-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3125rem;
}

.mw-sched-stat + .mw-sched-stat {
  padding-inline-start: var(--mw-s-3);
  border-inline-start: 1px solid var(--mw-line);
}

.mw-sched-stat dt {
  color: var(--mw-label-3);
  font-size: 0.6875rem;
}

.mw-sched-stat dd {
  margin: 0;
  color: var(--mw-label);
  font-family: var(--mw-mono);
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.mw-sched-stat[data-tone="warn"] dd {
  color: var(--mw-tone);
}

.mw-sched-others-toggle[aria-pressed="true"] {
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
}

.mw-sched-layout {
  position: relative;
  display: grid;
  gap: var(--mw-s-4);
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

.mw-sched-layout[data-backlog="open"]:not([data-narrow="true"]) {
  grid-template-columns: minmax(13rem, 16.5rem) minmax(0, 1fr);
}

/* Side column: no card, smaller type, hairline divider; the calendar card carries the weight. */
.mw-sched-side {
  min-width: 0;
  padding-inline-end: var(--mw-s-3);
  border-inline-end: 1px solid var(--mw-line);
}

.mw-sched-side .mw-card-title {
  font-size: 0.8125rem;
}

.mw-sched-side > .mw-dsh-muted {
  font-size: 0.75rem;
}

/* Narrow stages: the backlog becomes an overlay drawer over the calendar. */
.mw-sched-side[data-drawer="true"] {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  z-index: 30;
  width: min(20rem, 88%);
  max-height: min(36rem, 80vh);
  overflow-y: auto;
  padding: var(--mw-s-3);
  border: 0;
  border-radius: var(--mw-r-xl);
  background: var(--mw-glass-solid);
  box-shadow: var(--mw-elev-3), var(--mw-bevel);
  animation: mw-sched-drawer-in var(--mw-dur-base) var(--mw-ease);
}

@supports (backdrop-filter: blur(1rem)) {
  .mw-sched-side[data-drawer="true"] {
    background: var(--mw-glass);
    backdrop-filter: blur(1.5rem) saturate(1.6);
  }
}

@keyframes mw-sched-drawer-in {
  from {
    opacity: 0;
    transform: translateX(-0.75rem);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.mw-sched-main {
  min-width: 0;
  padding: var(--mw-s-3);
  border-radius: var(--mw-r-3);
  background: var(--mw-card);
  box-shadow: var(--mw-elev-1), var(--mw-bevel);
}

.mw-sched-backlog {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 30rem;
  overflow-y: auto;
}

.mw-sched-group {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin-block-start: var(--mw-s-2);
  padding: var(--mw-s-2) var(--mw-s-2) 0.25rem;
  border-block-start: 1px solid var(--mw-line);
}

.mw-sched-group-title {
  color: var(--mw-label-2);
  font-size: 0.6875rem;
  font-weight: 600;
}

.mw-sched-group .mw-dsh-muted {
  font-size: 0.6875rem;
}

.mw-sched-row {
  display: flex;
  align-items: center;
  gap: var(--mw-s-2);
  width: 100%;
  padding: 0.4375rem var(--mw-s-2);
  border: 0;
  border-radius: var(--mw-r-2);
  background: transparent;
  color: var(--mw-label);
  font: inherit;
  text-align: start;
  cursor: grab;
  transition: background-color var(--mw-dur-fast) var(--mw-ease);
}

.mw-sched-row:hover {
  background: var(--mw-fill-1);
}

.mw-sched-row[data-selected="true"] {
  background: var(--mw-selected);
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
}

.mw-sched-row[data-ownership="unknown"] .mw-sched-row-title {
  color: var(--mw-label-2);
}

.mw-sched-row[data-ownership="others"] {
  border: 1px dashed var(--mw-line-strong);
}

.mw-sched-row-main {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
  flex: 1;
}

.mw-sched-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
}

.mw-sched-row-meta {
  color: var(--mw-label-3);
  font-size: 0.6875rem;
}

.mw-sched-row-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: var(--mw-r-pill);
  background: var(--mw-tone, var(--mw-neutral));
  flex-shrink: 0;
}

.mw-sched-weekhead {
  display: grid;
  gap: 0.25rem;
  padding-block-end: 0.125rem;
  color: var(--mw-label-3);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: center;
}

.mw-sched-grid {
  /* Rows for the a11y tree: one week per row, one day per gridcell. */
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.mw-sched-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.25rem;
}

/* Cell layers, weakest to strongest: other month, empty day, scheduled day, today. */
.mw-sched-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
  min-height: 4.75rem;
  padding: 0.375rem;
  border-radius: var(--mw-r-2);
  background: var(--mw-fill-1);
  box-shadow: inset 0 0 0 1px transparent;
  overflow: hidden;
  opacity: 0.48;
  transition: background-color var(--mw-dur-fast) var(--mw-ease), box-shadow var(--mw-dur-fast) var(--mw-ease), opacity var(--mw-dur-fast) var(--mw-ease);
}

.mw-sched-cell[data-in-month="true"] {
  background: var(--mw-card);
  box-shadow: inset 0 0 0 1px var(--mw-line);
  opacity: 1;
}

/* Same specificity as the layers below, so scheduled/today/drop states still win by order. */
.mw-sched-cell[data-weekend="true"]:where([data-in-month="true"]) {
  background: color-mix(in oklab, var(--mw-label) 2%, var(--mw-card));
}

.mw-sched-cell[data-has-entries="true"] {
  background: color-mix(in oklab, var(--mw-label) 6%, var(--mw-card));
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
}

.mw-sched-cell[data-today="true"] {
  background: color-mix(in oklab, var(--mw-accent) 8%, var(--mw-card));
  box-shadow: inset 0 0 0 1px var(--mw-accent);
  opacity: 1;
}

.mw-sched-cell[data-drop-ready="true"]:hover {
  background: var(--mw-fill-2);
}

.mw-sched-cell[data-drop-active="true"] {
  background: color-mix(in oklab, var(--mw-accent) 12%, var(--mw-card));
  box-shadow: inset 0 0 0 2px var(--mw-accent);
  transform: translateY(-0.0625rem);
}

.mw-sched-day {
  align-self: flex-start;
  min-width: 1.375rem;
  padding: 0 0.25rem;
  border-radius: var(--mw-r-pill);
  color: var(--mw-label-2);
  font-family: var(--mw-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.375rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.mw-sched-cell[data-in-month="true"][data-past="true"] .mw-sched-day {
  color: var(--mw-label-3);
}

.mw-sched-cell[data-today="true"] .mw-sched-day {
  background: var(--mw-accent);
  color: var(--mw-on-accent);
  font-weight: 600;
}

.mw-sched-chips {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
  min-height: 0;
}

/* Chips tint with a status tone only (12% wash, neutral text, 2px tone edge); never a per-project hue. */
.mw-sched-chip {
  display: block;
  width: 100%;
  padding: 0.125rem 0.3125rem;
  border: 1px solid transparent;
  border-radius: var(--mw-r-1);
  background: color-mix(in oklab, var(--mw-tone, var(--mw-neutral)) 12%, var(--mw-card));
  box-shadow: inset 2px 0 0 var(--mw-tone, var(--mw-neutral));
  color: var(--mw-label);
  font: inherit;
  font-size: 0.6875rem;
  text-align: start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--mw-dur-fast) var(--mw-ease);
}

.mw-sched-chip:hover {
  background: color-mix(in oklab, var(--mw-tone, var(--mw-neutral)) 20%, var(--mw-card));
}

.mw-sched-chip[data-ownership="unknown"] {
  color: var(--mw-label-2);
}

.mw-sched-chip[data-ownership="others"] {
  border: 1px dashed var(--mw-line-strong);
  box-shadow: none;
  color: var(--mw-label-2);
}

.mw-sched-legend {
  font-size: 0.6875rem;
}

.mw-sched-undo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mw-s-2);
  font-size: 0.75rem;
}

.mw-sched-row[data-dragging="true"] {
  opacity: 0.72;
  transform: rotate(-1deg);
}

@media (prefers-reduced-motion: reduce) {
  .mw-sched-cell,
  .mw-sched-row,
  .mw-sched-chip {
    transition: none;
  }

  .mw-sched-side[data-drawer="true"] {
    animation: none;
  }

  .mw-sched-cell[data-drop-active="true"],
  .mw-sched-row[data-dragging="true"] {
    transform: none;
  }
}

/* Desk v8 Overview: stage axis + three-level stage workbench (docs/design/mockup-v8.html). */
.mw-stage-overview {
  display: flex;
  flex-direction: column;
  gap: var(--mw-s-3);
  min-width: 0;
}

.mw-stage-toolbar {
  display: flex;
  justify-content: flex-end;
}

.mw-stage-layout {
  display: grid;
  grid-template-columns: 12rem minmax(0, 1fr);
  min-height: 0;
  border-radius: var(--mw-r-3);
  box-shadow: 0 0 0 1px var(--mw-line);
  background: var(--mw-card);
  overflow: hidden;
}

.mw-stage-num {
  font-variant-numeric: tabular-nums;
}

.mw-stage-axis {
  display: flex;
  flex-direction: column;
  padding: 0.75rem 0;
  background: var(--mw-fill-1);
  border-right: 1px solid var(--mw-line);
  min-width: 0;
}

.mw-stage-axis-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 2rem;
  padding: 0 1rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--mw-label-3);
}

.mw-stage-axis-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mw-stage-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  height: 2rem;
  padding: 0 1rem;
  border: 0;
  background: transparent;
  color: var(--mw-label);
  font: inherit;
  font-size: 0.8125rem;
  text-align: start;
  cursor: pointer;
  transition: background-color var(--mw-dur-fast) var(--mw-ease);
}

.mw-stage-row:hover {
  background: var(--mw-fill-1);
}

.mw-stage-row[data-current="true"] {
  background: var(--mw-fill-2);
  font-weight: 600;
}

.mw-stage-row[data-current="true"]::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--mw-accent);
}

.mw-stage-row[data-empty="true"] {
  color: var(--mw-label-3);
}

.mw-stage-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Primary number: pending (actionable). Secondary: total, quieter and one step smaller (§8.3). */
.mw-stage-pending {
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  color: var(--mw-label);
}

.mw-stage-pending[data-zero="true"] {
  color: var(--mw-label-3);
}

.mw-stage-total {
  min-width: 1.25rem;
  font-size: 0.6875rem;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  text-align: end;
  color: var(--mw-label-3);
}

.mw-stage-dot {
  width: 0.625rem;
  height: 0.625rem;
  flex: none;
  stroke-width: 1.5;
  fill: none;
  stroke: var(--mw-line-strong);
}

.mw-stage-dot[data-state="done"] {
  fill: var(--mw-ok);
  stroke: var(--mw-ok);
}

.mw-stage-dot[data-state="doing"] {
  stroke: var(--mw-label);
}

.mw-stage-dot-half {
  fill: var(--mw-label);
  stroke: none;
}

.mw-stage-axis-note {
  margin: 0.5rem 0 0;
  padding: 0 1rem;
  font-size: 0.6875rem;
  line-height: 1.5;
  color: var(--mw-label-3);
}

.mw-stage-axis-keys {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.375rem 0.5rem;
  align-items: center;
  margin: auto 0 0;
  padding: 0.75rem 1rem 0.25rem;
  border-top: 1px solid var(--mw-line);
  font-size: 0.6875rem;
  color: var(--mw-label-3);
}

.mw-stage-axis-keys dt,
.mw-stage-axis-keys dd {
  margin: 0;
}

.mw-stage-axis kbd,
.mw-stage-work-hints kbd {
  font-family: inherit;
  font-size: 0.6875rem;
  line-height: 1;
  padding: 0.1875rem 0.3125rem;
  border-radius: var(--mw-r-1);
  background: var(--mw-surface);
  color: var(--mw-label-2);
  box-shadow: 0 0 0 1px var(--mw-line-strong);
  font-variant-numeric: tabular-nums;
}

.mw-stage-work {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 1rem 1.5rem 0;
}

.mw-stage-work-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-height: 2.5rem;
}

.mw-stage-work-head h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.mw-stage-work-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--mw-label-2);
}

.mw-stage-work-meta b {
  font-weight: 600;
  color: var(--mw-label);
}

.mw-stage-sep {
  width: 1px;
  height: 0.75rem;
  background: var(--mw-line-strong);
}

.mw-stage-work-hints {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-inline-start: auto;
  font-size: 0.6875rem;
  color: var(--mw-label-3);
}

.mw-stage-top {
  display: grid;
  /* Two columns only when there is room for both. A fixed 30rem hero leaves the metadata column a
     sliver at typical stage widths, and the card clips it. auto-fit drops to one column instead. */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: 1.25rem;
  align-items: start;
}

.mw-stage-level {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mw-stage-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 1.5rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--mw-label-3);
}

.mw-stage-eyebrow .mw-stage-num {
  color: var(--mw-label-2);
}

.mw-stage-eyebrow-end {
  margin-inline-start: auto;
  font-weight: 400;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-stage-primary {
  border-radius: var(--mw-r-3);
  background: var(--mw-surface);
  box-shadow: 0 0 0 1px var(--mw-line), var(--mw-elev-1);
  overflow: hidden;
}

.mw-stage-primary[data-current="true"] {
  box-shadow: 0 0 0 2px var(--mw-accent), var(--mw-elev-1);
}

.mw-stage-thumb {
  position: relative;
  overflow: hidden;
  background-color: var(--mw-fill-2);
}

.mw-stage-thumb[data-empty="true"] {
  background-image: linear-gradient(var(--mw-line) 1px, transparent 1px), linear-gradient(90deg, var(--mw-line) 1px, transparent 1px);
  background-size: 1.5rem 1.5rem;
  background-position: -1px -1px;
}

.mw-stage-thumb[data-shape="wide"] {
  /* Cap the hero thumbnail: at full stage width a 16:9 box swallows half the screen and pushes
     the inspector out. The design draft puts L1 and its metadata side by side, not stacked. */
  aspect-ratio: 16 / 9;
  max-height: 11rem;
}

.mw-stage-thumb[data-shape="variant"] {
  width: 7.5rem;
  height: 5.625rem;
  border-radius: var(--mw-r-2);
  box-shadow: inset 0 0 0 1px var(--mw-line);
}

.mw-stage-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mw-stage-thumb-note {
  position: absolute;
  left: 0.5rem;
  bottom: 0.5rem;
  padding: 0.125rem 0.375rem;
  border-radius: var(--mw-r-1);
  background: var(--mw-surface);
  box-shadow: 0 0 0 1px var(--mw-line);
  font-size: 0.6875rem;
  color: var(--mw-label-2);
}

.mw-stage-primary-body {
  display: grid;
  /* One column by default: the workbench is narrow (stage minus axis), and a trailing auto column
     for metadata gets clipped at the right edge. Metadata wraps under the actions instead. */
  grid-template-columns: minmax(0, 1fr);
  gap: 0.375rem;
  align-items: center;
  padding: 0.75rem 1rem 0.875rem;
}

.mw-stage-primary-title {
  font-size: 0.9375rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-stage-primary-actions {
  grid-row: 1 / span 2;
  grid-column: 2;
  display: flex;
  gap: 0.5rem;
}

.mw-stage-primary-status {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--mw-label-2);
}

.mw-stage-side {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.mw-stage-variants {
  display: flex;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-x: auto;
}

.mw-stage-variant {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 7.5rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.mw-stage-variant[data-current="true"] .mw-stage-thumb {
  box-shadow: 0 0 0 2px var(--mw-accent);
}

.mw-stage-variant-tag {
  position: absolute;
  right: 0.3125rem;
  bottom: 0.3125rem;
  padding: 0 0.25rem;
  border-radius: var(--mw-r-1);
  background: var(--mw-surface);
  font-size: 0.625rem;
  line-height: 1rem;
  font-variant-numeric: tabular-nums;
  color: var(--mw-label-2);
}

.mw-stage-variant[data-current="true"] .mw-stage-variant-tag {
  color: var(--mw-accent);
  font-weight: 600;
}

.mw-stage-variant-cap {
  font-size: 0.6875rem;
  color: var(--mw-label-3);
}

.mw-stage-kv {
  margin: 0;
}

.mw-stage-kv > div {
  display: flex;
  align-items: center;
  min-height: 2rem;
  border-top: 1px solid var(--mw-line);
}

.mw-stage-kv > div:last-child {
  border-bottom: 1px solid var(--mw-line);
}

.mw-stage-kv dt {
  width: 5rem;
  flex: none;
  color: var(--mw-label-2);
}

.mw-stage-kv dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-stage-owner {
  display: inline-flex;
  align-items: center;
  height: 1.125rem;
  padding: 0 0.375rem;
  border-radius: var(--mw-r-1);
  background: var(--mw-fill-2);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--mw-label-2);
}

.mw-stage-queue {
  margin: 0 0 0.75rem;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--mw-line);
}

.mw-stage-queue-row {
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr) auto 6.5rem 1rem;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  min-height: 2rem;
  padding: 0 0.5rem;
  border: 0;
  border-bottom: 1px solid var(--mw-line);
  background: transparent;
  color: var(--mw-label);
  font: inherit;
  font-size: 0.8125rem;
  text-align: start;
  cursor: pointer;
  transition: background-color var(--mw-dur-fast) var(--mw-ease);
}

.mw-stage-queue-row:hover,
.mw-stage-queue-row[data-current="true"] {
  background: var(--mw-fill-1);
}

.mw-stage-queue-icon,
.mw-stage-queue-go {
  display: grid;
  place-items: center;
  color: var(--mw-label-3);
}

.mw-stage-queue-icon[data-tone="warn"] {
  color: var(--mw-warn);
}

.mw-stage-queue-icon[data-tone="ok"] {
  color: var(--mw-ok);
}

.mw-stage-queue-go .mw-ic {
  transform: rotate(-90deg);
}

.mw-stage-queue-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-stage-queue-name small {
  margin-inline-start: 0.375rem;
  font-size: 0.75rem;
  color: var(--mw-label-3);
}

.mw-stage-queue-row time {
  font-size: 0.75rem;
  text-align: end;
  color: var(--mw-label-2);
}

.mw-stage-quiet {
  margin: 0;
  font-size: 0.75rem;
  color: var(--mw-label-2);
}

.mw-stage-versions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.25rem;
  margin-top: auto;
  border-top: 1px solid var(--mw-line);
  font-size: 0.8125rem;
}

.mw-stage-version-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  height: 1.5rem;
  padding: 0 0.5rem;
  border-radius: var(--mw-r-2);
  background: var(--mw-surface);
  box-shadow: 0 0 0 1px var(--mw-line), var(--mw-elev-1);
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.mw-stage-versions b {
  font-weight: 600;
}

.mw-stage-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.375rem;
  padding: 0 0.5rem;
  border-radius: var(--mw-r-pill);
  box-shadow: inset 0 0 0 1px var(--mw-line-strong);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--mw-warn);
}

.mw-stage-versions-end {
  margin-inline-start: auto;
}

@media (max-width: 64rem) {
  .mw-stage-top {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 48rem) {
  .mw-stage-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .mw-stage-axis {
    border-right: 0;
    border-bottom: 1px solid var(--mw-line);
  }

  .mw-stage-axis-keys {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mw-stage-row,
  .mw-stage-queue-row {
    transition: none;
  }
}
`

interface SharedStyleHolder {
  refCount: number
  el?: HTMLStyleElement
}

declare global {
  // eslint-disable-next-line no-var
  var __YEISME_MUWEAVE_STYLES__: SharedStyleHolder | undefined
}

export function mountMuweaveCoreStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined
  if (!globalThis.__YEISME_MUWEAVE_STYLES__) {
    globalThis.__YEISME_MUWEAVE_STYLES__ = { refCount: 0 }
  }
  const holder = globalThis.__YEISME_MUWEAVE_STYLES__
  if (holder.refCount === 0) {
    for (const stale of document.querySelectorAll(`style[${MUWEAVE_STYLE_ATTR}]`)) {
      stale.remove()
    }
    const el = document.createElement('style')
    el.setAttribute(MUWEAVE_STYLE_ATTR, 'v2')
    el.textContent = MUWEAVE_CORE_CSS
    document.head.appendChild(el)
    holder.el = el
  }
  holder.refCount += 1
  return () => {
    holder.refCount = Math.max(0, holder.refCount - 1)
    if (holder.refCount === 0 && holder.el) {
      holder.el.remove()
      holder.el = undefined
    }
  }
}
