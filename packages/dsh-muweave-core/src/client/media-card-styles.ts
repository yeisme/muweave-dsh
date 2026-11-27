export const mediaCardStyles = `
.mw-media-card-media:has(> .mw-empty-action) {
  aspect-ratio: auto;
  margin: 0;
  border-radius: 0;
  background: transparent;
}

.mw-media-card-media > .mw-empty-action {
  border-bottom: 1px solid var(--mw-line);
}

.mw-empty-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mw-s-2, 0.5rem);
  width: 100%;
  min-height: 3.5rem;
  padding: var(--mw-s-3, 0.75rem);
  color: var(--mw-label-2, #555);
  font-size: 0.75rem;
  text-align: center;
}

.mw-empty-action progress {
  width: min(100%, 12rem);
  min-height: 0.25rem;
  accent-color: var(--mw-accent);
}

.mw-media-thumbnail {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mw-media-card-media > .mw-media-thumbnail {
  transition: transform 180ms var(--mw-ease-out);
}

.mw-media-card-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mw-s-1);
}

.mw-media-card[data-selected="true"] {
  outline: 2px solid var(--mw-accent);
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .mw-media-card-media > .mw-media-thumbnail {
    transition: none;
  }

  .mw-media-card:hover .mw-media-card-media > .mw-media-thumbnail {
    transform: none;
  }
}
`
