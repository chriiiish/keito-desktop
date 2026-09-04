/** A row's position within the list that holds it, in pixels. */
export interface Row {
  /** Distance from the top of the list's scrollable content. */
  top: number;
  height: number;
}

/** What the list can currently see. */
export interface Viewport {
  scrollTop: number;
  /** Visible height, not content height. */
  height: number;
}

/**
 * Where a list must scroll to so a row is fully visible, or null if it already is.
 *
 * Arithmetic rather than `scrollIntoView`, for two reasons. It scrolls the one element
 * that should move, where `scrollIntoView` walks up and may scroll an ancestor as well —
 * in a popover that is a window jumping under the cursor. And it is a pure function, so
 * the behaviour is tested rather than eyeballed: jsdom has no layout, so a component test
 * of this would assert against zeroes and prove nothing.
 *
 * Returns the smallest scroll that works — the row is brought to whichever edge it left,
 * rather than centred — so holding the arrow key walks the list one row at a time instead
 * of leaping half a page per press.
 */
export function scrollTopFor(row: Row, view: Viewport): number | null {
  const rowBottom = row.top + row.height;
  const viewBottom = view.scrollTop + view.height;

  let next: number;
  if (row.top < view.scrollTop) {
    next = row.top;
  } else if (rowBottom > viewBottom) {
    // A row taller than the list can never fit inside it. Aligning its bottom would put
    // its top — where the text is — off the screen, so show the top and let the rest go.
    next = row.height > view.height ? row.top : rowBottom - view.height;
  } else {
    return null;
  }

  // Already there: say so, rather than handing back a scroll that changes nothing.
  return next === view.scrollTop ? null : next;
}
