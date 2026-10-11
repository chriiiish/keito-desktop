interface CategoryLinesProps {
  /** The client-visible or internal note, when this context shows one at all. */
  note?: string | null | undefined;
  task: string;
  project: string;
  clientName?: string | undefined;
}

/**
 * The one shared shape for "what is this row about": a bold headline, then supporting
 * detail beneath it. A note leads when there is one — the running timer, and the popover's
 * today/yesterday rows. Everywhere else (the picker trigger, the entries table) never has a
 * note to show, which renders identically to a note-first context with nothing typed: the
 * task leads instead, and there is no third line pretending a note is there when it is not.
 */
export function CategoryLines({ note, task, project, clientName }: CategoryLinesProps): JSX.Element {
  const trimmedNote = note?.trim();
  const detail = clientName ? `${clientName}: ${project}` : project;

  if (trimmedNote) {
    return (
      <>
        <strong title={trimmedNote}>{trimmedNote}</strong>
        <span>{task}</span>
        <span>{detail}</span>
      </>
    );
  }

  return (
    <>
      <strong>{task}</strong>
      <span>{detail}</span>
    </>
  );
}
