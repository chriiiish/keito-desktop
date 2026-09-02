/**
 * @vitest-environment jsdom
 *
 * A smoke test for the start form: the popover now holds real logic (which category is
 * preselected, what order the dropdown groups appear in), and it is the one screen that
 * cannot be checked by reading a snapshot.
 */
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Snapshot } from "../../electron/service.js";
import type { TimeEntry } from "../core/keito/types.js";

const api = {
  getSnapshot: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  onIdleReturn: vi.fn(() => () => {}),
  onPopoverShown: vi.fn((_handler: () => void) => () => {}),
  switchTo: vi.fn(),
  stopTimer: vi.fn(),
  toggleFavourite: vi.fn(),
  setHidden: vi.fn(),
  closePopover: vi.fn(),
  openWindow: vi.fn(),
  resolveIdle: vi.fn(),
  resumeEntry: vi.fn(),
};
vi.stubGlobal("keito", api);

const { Popover } = await import("./Popover.js");

const pair = (id: string, projectName: string, taskName: string) => {
  const [projectId, taskId] = id.split(":") as [string, string];
  return { id, projectId, projectName, taskId, taskName };
};

const snapshot: Snapshot = {
  keyStatus: "ready",
  identity: null,
  catalog: [
    pair("p_acme:t_dev", "Acme Rebuild", "Development"),
    pair("p_acme:t_qa", "Acme Rebuild", "QA"),
    pair("p_bank:t_dev", "Bank Portal", "Development"),
    pair("p_bank:t_ops", "Bank Portal", "Ops"),
  ],
  recents: ["p_bank:t_dev"],
  favourites: ["p_acme:t_qa"],
  hidden: [],
  today: [],
  yesterday: [],
  workspaceTimezone: "UTC",
  hotkey: "CommandOrControl+Shift+K",
  hotkeyRegistered: true,
  openAtLogin: false,
  canOpenAtLogin: true,
  platform: "darwin",
  appVersion: "0.1.0",
  accountId: "co_9",
  apiKeyHint: "kto_••••••••abcd",
  trayFallback: "task",
  trayPrefix: "none",
  revision: 1,
  timer: { status: "idle" },
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getSnapshot.mockResolvedValue(snapshot);
});

const entry = (id: string, projectId: string, taskId: string, over: Partial<TimeEntry> = {}) => ({
  id,
  project_id: projectId,
  task_id: taskId,
  spent_date: "2026-09-02",
  started_time: "09:00",
  ended_time: "09:30",
  hours: 0.5,
  is_running: false,
  notes: null,
  ...over,
});

describe("the start form", () => {
  it("preselects the first favourite, so Enter alone starts something sensible", async () => {
    render(<Popover />);

    expect(await screen.findByText("QA")).toBeDefined();
  });

  it("groups the dropdown as favourites, recent, then every project", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));

    const headings = screen.getAllByText(/^(Favourites|Recent|All projects)$/);

    expect(headings.map((node) => node.textContent)).toEqual([
      "Favourites",
      "Recent",
      "All projects",
    ]);
  });

  it("lists tasks under their project heading", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));

    const list = screen.getByRole("listbox");

    expect(within(list).getByText("Acme Rebuild")).toBeDefined();
    expect(within(list).getByText("Bank Portal")).toBeDefined();
  });

  it("filters by a string across project and task", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));
    await user.type(screen.getByPlaceholderText(/filter projects and tasks/i), "bank");

    const list = screen.getByRole("listbox");

    expect(within(list).queryByText("Acme Rebuild")).toBeNull();
    expect(within(list).getByText("Bank Portal")).toBeDefined();
  });

  it("closes the dropdown when an option is clicked", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));

    await user.click(within(screen.getByRole("listbox")).getByText("Ops"));

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes the dropdown even when the option clicked is the one already selected", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));

    // "QA" under Acme Rebuild is the preselected favourite.
    await user.click(within(screen.getByRole("listbox")).getAllByText("QA")[0]!);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("favourites a category from inside the dropdown", async () => {
    const user = userEvent.setup();
    api.toggleFavourite.mockResolvedValue(snapshot);
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));

    await user.click(screen.getAllByLabelText(/^Favourite Bank Portal Development$/)[0]!);

    expect(api.toggleFavourite).toHaveBeenCalledWith("p_bank:t_dev");
  });

  it("stops the running timer from an icon button in the header", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      timer: {
        status: "running",
        pair: snapshot.catalog[0]!,
        entryId: "te_1",
        startedAtMs: Date.now(),
        note: "Sprint planning",
      },
    } satisfies Snapshot);
    api.stopTimer.mockResolvedValue(snapshot);
    render(<Popover />);

    await user.click(await screen.findByLabelText("Stop timer"));

    expect(api.stopTimer).toHaveBeenCalledTimes(1);
  });

  it("shows the note on the running timer", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      timer: {
        status: "running",
        pair: snapshot.catalog[0]!,
        entryId: "te_1",
        startedAtMs: Date.now(),
        note: "Sprint planning",
      },
    } satisfies Snapshot);

    render(<Popover />);

    expect(await screen.findByText("Sprint planning")).toBeDefined();
  });

  it("says so when the running timer has no note", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      timer: {
        status: "running",
        pair: snapshot.catalog[0]!,
        entryId: "te_1",
        startedAtMs: Date.now(),
        note: null,
      },
    } satisfies Snapshot);

    render(<Popover />);

    expect(await screen.findByText("No note")).toBeDefined();
  });

  it("starts the selected category with the typed note", async () => {
    api.switchTo.mockResolvedValue({ ...snapshot, error: null });
    render(<Popover />);

    const note = await screen.findByPlaceholderText(/what are you working on/i);
    await userEvent.setup().type(note, "Sprint planning{Enter}");

    expect(api.switchTo).toHaveBeenCalledWith("p_acme:t_qa", "Sprint planning");
  });
});

/** A promise the test controls, so "in flight" is a state we can act during. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("the popover before it is connected", () => {
  const show = async (keyStatus: Snapshot["keyStatus"]) => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({ ...snapshot, keyStatus, identity: null } satisfies Snapshot);
    render(<Popover />);
    await screen.findByRole("heading");
    return user;
  };

  it("welcomes a first run and offers a way in", async () => {
    await show("missing");

    expect(screen.getByRole("heading", { name: "Welcome to Keito Timer" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Get started" })).toBeDefined();
    // No start form until there is something to start against.
    expect(screen.queryByPlaceholderText(/what are you working on/i)).toBeNull();
  });

  it("opens the window from there", async () => {
    const user = await show("missing");

    await user.click(screen.getByRole("button", { name: "Get started" }));

    expect(api.openWindow).toHaveBeenCalledTimes(1);
  });

  // Someone who set this up once does not need welcoming; they need telling that the key
  // they had has stopped working, and that nothing is being recorded meanwhile.
  it("says something else when the key was rejected", async () => {
    await show("rejected");

    expect(screen.getByRole("heading", { name: "Keito needs you again" })).toBeDefined();
    expect(screen.getByText(/stopped working/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Fix the connection" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
  });
});

describe("focus", () => {
  it("puts the caret in the note field when it first opens", async () => {
    render(<Popover />);

    const note = await screen.findByPlaceholderText(/what are you working on/i);

    expect(document.activeElement).toBe(note);
  });

  it("focuses the note again each time the popover is shown, since the window is reused", async () => {
    render(<Popover />);
    const note = await screen.findByPlaceholderText(/what are you working on/i);
    (screen.getByLabelText("Category") as HTMLElement).focus();
    expect(document.activeElement).not.toBe(note);

    // The main process announces every show; the renderer never remounts.
    const onShown = api.onPopoverShown.mock.calls.at(-1)![0];
    act(() => onShown());

    expect(document.activeElement).toBe(note);
  });
});

describe("while an action is in flight", () => {
  it("starts only one timer however many times Enter is pressed", async () => {
    const user = userEvent.setup();
    const gate = deferred<Snapshot>();
    api.switchTo.mockReturnValue(gate.promise);
    render(<Popover />);
    const note = await screen.findByPlaceholderText(/what are you working on/i);

    await user.type(note, "Sprint planning");
    await user.keyboard("{Enter}{Enter}{Enter}");

    expect(api.switchTo).toHaveBeenCalledTimes(1);
    gate.resolve({ ...snapshot, error: null });
  });

  it("turns the start button into a spinner and refuses further clicks", async () => {
    const user = userEvent.setup();
    const gate = deferred<Snapshot>();
    api.switchTo.mockReturnValue(gate.promise);
    render(<Popover />);

    await user.click(await screen.findByLabelText("Start timer"));

    const button = screen.getByLabelText("Start timer");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(within(button).getByRole("status")).toBeDefined();
    gate.resolve({ ...snapshot, error: null });
  });

  it("stops only once however many times Stop is clicked", async () => {
    const user = userEvent.setup();
    const gate = deferred<Snapshot>();
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [entry("te_1", "p_acme", "t_dev", { is_running: true, ended_time: null })],
    } satisfies Snapshot);
    api.stopTimer.mockReturnValue(gate.promise);
    render(<Popover />);
    const stop = await screen.findByLabelText(/^Stop Development$/);

    await user.click(stop);
    await user.click(stop);
    await user.click(stop);

    expect(api.stopTimer).toHaveBeenCalledTimes(1);
    gate.resolve(snapshot);
  });

  it("resumes only once however many times the play button is clicked", async () => {
    const user = userEvent.setup();
    const gate = deferred<Snapshot>();
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [entry("te_1", "p_acme", "t_dev")],
    } satisfies Snapshot);
    api.resumeEntry.mockReturnValue(gate.promise);
    render(<Popover />);
    const play = await screen.findByLabelText(/^Resume Development$/);

    await user.click(play);
    await user.click(play);

    expect(api.resumeEntry).toHaveBeenCalledTimes(1);
    gate.resolve(snapshot);
  });
});

describe("keyboard use of the category picker", () => {
  const openWithArrow = async () => {
    const user = userEvent.setup();
    render(<Popover />);
    (await screen.findByRole("button", { name: "Category" })).focus();
    await user.keyboard("{ArrowDown}");
    return user;
  };

  it("opens on the down arrow when the trigger has focus", async () => {
    await openWithArrow();

    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("opens on the up arrow too", async () => {
    const user = userEvent.setup();
    render(<Popover />);
    (await screen.findByRole("button", { name: "Category" })).focus();

    await user.keyboard("{ArrowUp}");

    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("moves the highlight with the arrow keys", async () => {
    const user = await openWithArrow();
    const filter = screen.getByPlaceholderText(/filter projects and tasks/i);
    const first = filter.getAttribute("aria-activedescendant");

    await user.keyboard("{ArrowDown}");

    expect(filter.getAttribute("aria-activedescendant")).not.toBe(first);
  });

  it("selects the highlighted option with Enter", async () => {
    const user = await openWithArrow();
    const highlighted = screen
      .getByPlaceholderText(/filter projects and tasks/i)
      .getAttribute("aria-activedescendant");

    await user.keyboard("{Enter}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Category" }).getAttribute("aria-activedescendant")).toBeNull();
    expect(highlighted).toBeTruthy();
  });

  it("hands focus to the note once a category is chosen", async () => {
    const user = await openWithArrow();

    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(screen.getByPlaceholderText(/what are you working on/i));
  });

  it("does not start a timer when Enter is used to pick a category", async () => {
    const user = await openWithArrow();

    await user.keyboard("{Enter}");

    expect(api.switchTo).not.toHaveBeenCalled();
  });
});

/**
 * "All projects" repeats what is already pinned above it, on purpose. Those repeats are
 * the *same* Pair object, so anything deriving a row's position from the object rather
 * than from where it is rendered collapses the two — which is what made arrowing through
 * the list lose the highlight, double it, or land somewhere else entirely.
 */
describe("walking the category picker with the arrow keys", () => {
  const open = async () => {
    const user = userEvent.setup();
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));
    return user;
  };

  const options = () => screen.getAllByRole("option");
  const highlighted = () => options().filter((option) => option.className.includes("cursor"));

  it("gives every row an id of its own, repeats included", async () => {
    await open();

    const ids = options().map((option) => option.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps exactly one row highlighted at every step down the list", async () => {
    const user = await open();
    const total = options().length;
    expect(total).toBeGreaterThan(4); // favourites and recents repeat below, so there are repeats to trip on

    for (let step = 0; step < total; step++) {
      expect(highlighted()).toHaveLength(1);
      await user.keyboard("{ArrowDown}");
    }
  });

  it("and back up again", async () => {
    const user = await open();
    const total = options().length;
    for (let step = 0; step < total; step++) await user.keyboard("{ArrowDown}");

    for (let step = 0; step < total; step++) {
      expect(highlighted()).toHaveLength(1);
      await user.keyboard("{ArrowUp}");
    }
  });

  it("points aria-activedescendant at the row it actually highlighted", async () => {
    const user = await open();
    const filter = screen.getByPlaceholderText(/filter projects and tasks/i);

    for (let step = 0; step < 4; step++) {
      await user.keyboard("{ArrowDown}");
      expect(filter.getAttribute("aria-activedescendant")).toBe(highlighted()[0]?.id);
    }
  });

  it("starts a repeated task from its row under All projects, and closes", async () => {
    const user = await open();
    // The QA task is favourited, so it appears twice; the lower one is the repeat.
    const qaRows = options().filter((option) => option.textContent?.includes("QA"));
    expect(qaRows.length).toBe(2);

    await user.click(qaRows[1]!);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Category" }).textContent).toContain("QA");
  });
});

describe("hidden categories", () => {
  it("leaves a switched-off category out of the dropdown", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({ ...snapshot, hidden: ["p_bank:t_ops"] } satisfies Snapshot);
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));

    expect(within(screen.getByRole("listbox")).queryByText("Ops")).toBeNull();
  });

  it("still shows a switched-off category that is a favourite", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      favourites: ["p_bank:t_ops"],
      hidden: ["p_bank:t_ops"],
    } satisfies Snapshot);
    render(<Popover />);
    await user.click(await screen.findByRole("button", { name: "Category" }));

    expect(within(screen.getByRole("listbox")).getAllByText(/Ops/).length).toBeGreaterThan(0);
  });
});

describe("today's entries", () => {
  it("says so when nothing has been logged yet", async () => {
    render(<Popover />);

    expect(await screen.findByText(/nothing logged yet today/i)).toBeDefined();
  });

  it("lists what has been worked on, labelled by note where there is one", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [
        entry("te_1", "p_acme", "t_dev", { notes: "Sprint planning" }),
        entry("te_2", "p_bank", "t_dev"),
      ],
    } satisfies Snapshot);

    render(<Popover />);

    expect(await screen.findByText("Sprint planning")).toBeDefined();
    // No note, so it falls back to the task name.
    expect(screen.getAllByText("Development").length).toBeGreaterThan(0);
  });

  it("resumes an entry from its play button", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [entry("te_1", "p_acme", "t_dev", { notes: "Sprint planning" })],
    } satisfies Snapshot);
    api.resumeEntry.mockResolvedValue({ ...snapshot, error: null });
    render(<Popover />);

    await userEvent.setup().click(await screen.findByLabelText(/^Resume Development$/));

    expect(api.resumeEntry).toHaveBeenCalledWith("te_1");
  });

  it("offers to stop the running entry rather than resume it", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [entry("te_1", "p_acme", "t_dev", { is_running: true, ended_time: null })],
    } satisfies Snapshot);

    render(<Popover />);

    expect(await screen.findByLabelText(/^Stop Development$/)).toBeDefined();
    expect(screen.queryByLabelText(/^Resume Development$/)).toBeNull();
  });

  it("stops the timer from today's list", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [entry("te_1", "p_acme", "t_dev", { is_running: true, ended_time: null })],
    } satisfies Snapshot);
    api.stopTimer.mockResolvedValue(snapshot);
    render(<Popover />);

    await userEvent.setup().click(await screen.findByLabelText(/^Stop Development$/));

    expect(api.stopTimer).toHaveBeenCalled();
  });

  it("still offers resume on entries that are not running", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [
        entry("te_1", "p_acme", "t_dev", { is_running: true, ended_time: null }),
        entry("te_2", "p_bank", "t_ops"),
      ],
    } satisfies Snapshot);

    render(<Popover />);

    expect(await screen.findByLabelText(/^Resume Ops$/)).toBeDefined();
  });
});

/**
 * Yesterday's rows cannot use the restart endpoint: it continues the entry it is given,
 * which would file today's work under yesterday's date.
 */
describe("yesterday's entries", () => {
  const yesterdayEntry = (over: Partial<TimeEntry> = {}) =>
    entry("te_y", "p_bank", "t_ops", { spent_date: "2026-09-01", notes: "Migration", ...over });

  const withYesterday = (over: Partial<Snapshot> = {}) =>
    ({ ...snapshot, yesterday: [yesterdayEntry()], ...over }) satisfies Snapshot;

  it("lists them under their own heading", async () => {
    api.getSnapshot.mockResolvedValue(withYesterday());

    render(<Popover />);

    expect(await screen.findByText("Yesterday")).toBeDefined();
    expect(screen.getByText("Migration")).toBeDefined();
  });

  // The two buttons sit in the same column doing different things, so the icon is the
  // only thing distinguishing them before you press one.
  it("marks them fast-forward, not play, to set them apart from today's", async () => {
    api.getSnapshot.mockResolvedValue(withYesterday({ today: [entry("te_t", "p_acme", "t_dev")] }));

    render(<Popover />);

    const forward = await screen.findByLabelText(/^Start Ops again today$/);
    const resume = screen.getByLabelText(/^Resume Development$/);
    expect(forward.textContent).toBe("▶▶");
    expect(resume.textContent).toBe("▶");
  });

  // Each day used to own its own `flex: 1; overflow-y: auto`, so two days meant two short
  // panes splitting the space between them and scrolling separately.
  it("puts both days in one scroller rather than one each", async () => {
    api.getSnapshot.mockResolvedValue(withYesterday({ today: [entry("te_t", "p_acme", "t_dev")] }));

    render(<Popover />);
    await screen.findByText("Yesterday");

    const scrollers = document.querySelectorAll(".recent");
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]!.querySelectorAll(".day")).toHaveLength(2);
    // Both headings live inside that one container, not beside it.
    expect(scrollers[0]!.querySelectorAll(".day-heading")).toHaveLength(2);
  });

  it("leaves the heading out when there is nothing behind you", async () => {
    render(<Popover />);
    await screen.findByText("Today");

    expect(screen.queryByText("Yesterday")).toBeNull();
  });

  it("starts a new entry today rather than restarting yesterday's", async () => {
    api.getSnapshot.mockResolvedValue(withYesterday());
    api.switchTo.mockResolvedValue(snapshot);
    render(<Popover />);

    await userEvent.setup().click(await screen.findByLabelText(/^Start Ops again today$/));

    expect(api.switchTo).toHaveBeenCalledWith("p_bank:t_ops", "Migration");
    expect(api.resumeEntry).not.toHaveBeenCalled();
  });

  it("carries no note across when the old entry had none", async () => {
    api.getSnapshot.mockResolvedValue(withYesterday({ yesterday: [yesterdayEntry({ notes: null })] }));
    api.switchTo.mockResolvedValue(snapshot);
    render(<Popover />);

    await userEvent.setup().click(await screen.findByLabelText(/^Start Ops again today$/));

    expect(api.switchTo).toHaveBeenCalledWith("p_bank:t_ops", undefined);
  });

  it("closes the popover once the new timer is running", async () => {
    api.getSnapshot.mockResolvedValue(withYesterday());
    api.switchTo.mockResolvedValue(snapshot);
    render(<Popover />);

    await userEvent.setup().click(await screen.findByLabelText(/^Start Ops again today$/));

    expect(api.closePopover).toHaveBeenCalled();
  });

  // Today's rows keep the restart endpoint, so a day still holds one row per task.
  it("leaves today's rows resuming the entry they already have", async () => {
    api.getSnapshot.mockResolvedValue(withYesterday({ today: [entry("te_t", "p_acme", "t_dev")] }));
    api.resumeEntry.mockResolvedValue(snapshot);
    render(<Popover />);

    await userEvent.setup().click(await screen.findByLabelText(/^Resume Development$/));

    expect(api.resumeEntry).toHaveBeenCalledWith("te_t");
    expect(api.switchTo).not.toHaveBeenCalled();
  });

  it("cannot start one whose project has since been archived", async () => {
    api.getSnapshot.mockResolvedValue(
      withYesterday({
        yesterday: [entry("te_gone", "p_gone", "t_gone", { spent_date: "2026-09-01" })],
      }),
    );

    render(<Popover />);

    const play = await screen.findByLabelText(/^Start Unknown task again today$/);
    expect(play.hasAttribute("disabled")).toBe(true);
  });
});
