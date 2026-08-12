interface IconButtonProps {
  label: string;
}

/**
 * Icon-only button: renders a glyph with visually hidden accessible text, so
 * the overlay's textPreview carries the label (e.g. "Toggle theme") and the
 * source-hint engine can resolve it. The glyph is plain text, so a click on
 * the button or its inner span yields the same preview. The dogfood tests
 * exercise this as an "icon-only control".
 */
export function IconButton({ label }: IconButtonProps) {
  return (
    <button type="button" className="icon-button" aria-label={label}>
      ◐<span className="sr-only">{label}</span>
    </button>
  );
}
