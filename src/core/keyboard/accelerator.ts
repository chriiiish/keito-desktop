/**
 * Converts a recorded key press into an Electron accelerator, and back into something
 * readable. Pure, so the tricky part — which is the key naming — is tested rather than
 * discovered by a shortcut mysteriously not registering.
 */

export interface RecordedKey {
  /** Physical key, e.g. "KeyK". Layout-independent, unlike `key`. */
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Electron's names for keys that aren't simply a letter or digit. */
const NAMED: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Enter: "Return",
  NumpadEnter: "Return",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;

  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;

  const fn = /^F([1-9]|1\d|2[0-4])$/.exec(code);
  if (fn) return `F${fn[1]}`;

  return NAMED[code] ?? null;
}

/**
 * `null` means "not a usable shortcut yet" — a modifier held on its own, Escape (which
 * cancels recording), or a bare key. A global shortcut with no modifier would swallow that
 * key in every other application, so it is refused rather than offered.
 */
export function toAccelerator(event: RecordedKey, platform: string): string | null {
  if (event.code === "Escape") return null;

  const name = keyName(event.code);
  if (!name) return null;

  const parts: string[] = [];
  const primary = platform === "darwin" ? event.metaKey : event.ctrlKey;
  const secondary = platform === "darwin" ? event.ctrlKey : event.metaKey;

  // CommandOrControl resolves to Command on macOS and Control elsewhere, so a shortcut
  // recorded on one platform still means the same gesture on another.
  if (primary) parts.push("CommandOrControl");
  if (secondary) parts.push(platform === "darwin" ? "Control" : "Super");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  if (parts.length === 0) return null;
  return [...parts, name].join("+");
}

const MAC_SYMBOLS: Record<string, string> = {
  CommandOrControl: "⌘",
  Command: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

const OTHER_LABELS: Record<string, string> = {
  CommandOrControl: "Ctrl",
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

/** The accelerator split into chips, named the way the platform's users expect. */
export function formatAccelerator(accelerator: string, platform: string): string[] {
  const labels = platform === "darwin" ? MAC_SYMBOLS : OTHER_LABELS;
  return accelerator
    .split("+")
    .filter(Boolean)
    .map((part) => labels[part] ?? part);
}
