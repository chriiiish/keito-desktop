/**
 * The changed-things out of a GitHub release body.
 *
 * The release workflow writes its own body — a download table and first-launch
 * instructions — and `generate_release_notes: true` appends GitHub's "What's Changed"
 * list underneath. Only that last part is a changelog. The rest tells a user on the
 * download page how to install, which is not what someone already running the app and
 * looking at an update notice wants to read, and it is a Markdown table this window has
 * no intention of rendering.
 *
 * Returns a plain list of lines rather than Markdown: the tab shows them as text, because
 * turning a remote release body into markup is a bigger commitment than a notice needs.
 * An empty list means "nothing worth showing" and the tab simply omits the section.
 */

const CHANGED_HEADING = /^#{1,6}\s*What['’]s Changed\s*$/i;
const HEADING = /^#{1,6}\s/;
/** GitHub's own footer, which is a link rather than a change. */
const FULL_CHANGELOG = /^\*\*Full Changelog\*\*/i;
const BULLET = /^\s*[*-]\s+/;
/**
 * GitHub appends " by @someone in <pull request url>" to every generated line. The URL is
 * not something this window can open usefully and the author is on the release page, so
 * the line reads better as just the change.
 */
const ATTRIBUTION = /\s+by\s+@[\w-]+\s+in\s+\S+\s*$/;

export function releaseHighlights(body: string | null | undefined): string[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);

  const start = lines.findIndex((line) => CHANGED_HEADING.test(line.trim()));
  if (start === -1) return [];

  const highlights: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    // The section ends at the next heading or at GitHub's compare link, whichever comes
    // first — "New Contributors" is a real heading that would otherwise be swept in.
    if (HEADING.test(line) || FULL_CHANGELOG.test(line)) break;
    if (!BULLET.test(line)) continue;

    const text = line.replace(BULLET, "").replace(ATTRIBUTION, "").trim();
    if (text) highlights.push(text);
  }
  return highlights;
}
