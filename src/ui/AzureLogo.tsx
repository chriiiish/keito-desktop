/**
 * The mark shown beside the note field when Azure DevOps is connected.
 *
 * A plain infinity loop in Azure's blue rather than a trace of Microsoft's logo. It reads
 * as Azure DevOps where it is used — always next to the words, never alone — and it keeps
 * this app out of the business of redistributing somebody else's trademark, which is the
 * same position taken over the Keito name.
 *
 * `currentColor` is deliberately not used: the whole point is that it is recognisable, and
 * a mark that inverted with the theme would stop being the brand colour. It dims via
 * opacity instead, so a broken connection reads as "off" rather than as a different logo.
 */
export function AzureLogo({ className = "" }: { className?: string }): JSX.Element {
  return (
    <svg
      className={`azure-logo ${className}`.trim()}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      role="img"
      aria-label="Azure DevOps"
      focusable="false"
    >
      <path
        fill="#0078D4"
        d="M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L12 10.66 10.48 12h.01L7.8 14.39c-.64.64-1.49.99-2.4.99-1.87 0-3.39-1.51-3.39-3.38S3.53 8.62 5.4 8.62c.91 0 1.76.35 2.44 1.03l1.13 1 1.51-1.34L9.22 8.2C8.2 7.18 6.84 6.62 5.4 6.62 2.42 6.62 0 9.04 0 12s2.42 5.38 5.4 5.38c1.44 0 2.8-.56 3.77-1.53l2.83-2.5.01.01L13.52 12h-.01l2.69-2.39c.64-.64 1.49-.99 2.4-.99 1.87 0 3.39 1.51 3.39 3.38s-1.52 3.38-3.39 3.38c-.9 0-1.76-.35-2.44-1.03l-1.14-1.01-1.51 1.34 1.27 1.12c1.02 1.01 2.37 1.57 3.82 1.57 2.98 0 5.4-2.41 5.4-5.38s-2.42-5.37-5.4-5.37z"
      />
    </svg>
  );
}
