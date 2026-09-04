/**
 * @vitest-environment jsdom
 *
 * A smoke test for the start form: the popover now holds real logic (which category is
 * preselected, what order the dropdown groups appear in), and it is the one screen that
 * cannot be checked by reading a snapshot.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Snapshot } from "../../electron/service.js";
import type { TimeEntry } from "../core/keito/types.js";

const api = {
  getSnapshot: vi.fn(),
  onSnapshot: vi.fn((_handler: (snapshot: Snapshot) => void) => () => {}),
  onIdleReturn: vi.fn(() => () => {}),
  onPopoverShown: vi.fn((_handler: () => void) => () => {}),
  switchTo: vi.fn(),
  stopTimer: vi.fn(),
  toggleFavourite: vi.fn(),
  setHidden: vi.fn(),
  closePopover: vi.fn(),
  openWindow: vi.fn(),
  openExternal: vi.fn(),
  dismissUpdate: vi.fn(),
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
  update: null,
  azure: {
    enabled: false,
    status: "off" as const,
    organisationUrl: null,
    hasToken: false,
    workItems: [],
    error: null,
  },
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
  const show = async (keyStatus: Snapshot["keyStatus"], over: Partial<Snapshot> = {}) => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      keyStatus,
      identity: null,
      ...over,
    } satisfies Snapshot);
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

  // A Windows user has no menu bar to look at.
  it("names the place this platform actually puts it", async () => {
    await show("missing");
    expect(screen.getByText(/from the menu bar/)).toBeDefined();

    cleanup();
    await show("missing", { platform: "win32" });
    expect(screen.getByText(/from the tray/)).toBeDefined();
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
describe("a running row's duration", () => {
  const runningFor = (minutes: number) =>
    entry("te_run", "p_acme", "t_dev", {
      is_running: true,
      ended_time: null,
      hours: null,
      timer_started_at: new Date(Date.now() - minutes * 60_000).toISOString(),
    });

  // The reported bug: a running entry reports hours: null, and formatting that as a
  // number rendered every running timer as 0:00.
  it("counts from the start rather than showing zero", async () => {
    api.getSnapshot.mockResolvedValue({ ...snapshot, today: [runningFor(30)] } satisfies Snapshot);

    render(<Popover />);
    await screen.findByLabelText(/^Stop Development$/);

    expect(screen.getByText("0:30")).toBeDefined();
    expect(screen.queryByText("0:00")).toBeNull();
  });

  it("goes past the hour properly", async () => {
    api.getSnapshot.mockResolvedValue({ ...snapshot, today: [runningFor(95)] } satisfies Snapshot);

    render(<Popover />);
    await screen.findByLabelText(/^Stop Development$/);

    expect(screen.getByText("1:35")).toBeDefined();
  });

  it("still reads a stopped entry from its recorded hours", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [entry("te_done", "p_acme", "t_dev", { hours: 2.5 })],
    } satisfies Snapshot);

    render(<Popover />);
    await screen.findByLabelText(/^Resume Development$/);

    expect(screen.getByText("2:30")).toBeDefined();
  });

  // Yesterday's list is fed by the same formatter, and a timer left running overnight is
  // exactly the case that would otherwise read 0:00 on the wrong day.
  it("does the same for a timer left running from yesterday", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      yesterday: [runningFor(45)],
    } satisfies Snapshot);

    render(<Popover />);
    await screen.findByText("Yesterday");

    expect(screen.getByText("0:45")).toBeDefined();
  });
});

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

const available = (over: Partial<NonNullable<Snapshot["update"]>> = {}) => ({
  ...snapshot,
  update: {
    version: "0.4.0",
    tag: "v0.4.0",
    name: "0.4.0",
    url: "https://github.com/chriiiish/keito-desktop/releases/tag/v0.4.0",
    publishedAt: "2026-09-03T00:00:00Z",
    notes: "Fixed the thing.",
    dismissed: false,
    ...over,
  },
});

describe("the update notice", () => {
  it("says nothing at all when there is no newer release", async () => {
    render(<Popover />);
    await screen.findByText("QA");

    expect(screen.queryByText(/Update available/)).toBeNull();
  });

  it("names the release that is waiting", async () => {
    api.getSnapshot.mockResolvedValue(available());
    render(<Popover />);

    expect(await screen.findByText("0.4.0")).toBeDefined();
    expect(screen.getByText(/Update available/)).toBeDefined();
  });

  it("opens the window on the update tab rather than a browser", async () => {
    // The decision was to keep the user in the app: the tab has the notes and the
    // download link, so the notice is a way in rather than a shortcut past it.
    api.getSnapshot.mockResolvedValue(available());
    render(<Popover />);

    await userEvent.setup().click(await screen.findByText(/Update available/));

    expect(api.openWindow).toHaveBeenCalledWith("update");
    expect(api.openExternal).not.toHaveBeenCalled();
  });

  it("stays quiet once this version has been dismissed", async () => {
    api.getSnapshot.mockResolvedValue(available({ dismissed: true }));
    render(<Popover />);
    await screen.findByText("QA");

    expect(screen.queryByText(/Update available/)).toBeNull();
  });

  it("dismisses on the cross", async () => {
    api.getSnapshot.mockResolvedValue(available());
    api.dismissUpdate.mockResolvedValue(available({ dismissed: true }));
    render(<Popover />);

    await userEvent.setup().click(await screen.findByLabelText("Dismiss update notice"));

    expect(api.dismissUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Update available/)).toBeNull();
  });
});

describe("a task worked on more than once in a day", () => {
  // Switching away and back is POST /time_entries, which creates a *new* entry rather
  // than continuing the old one. So the same task worked on twice is two entries, and
  // while the second is running it reports hours: null — which is how the day's earlier
  // work came to vanish from the popover.
  const twice = (over: Partial<TimeEntry> = {}) => [
    entry("te_2", "p_acme", "t_dev", {
      notes: "Sprint planning",
      hours: null,
      ended_time: null,
      is_running: true,
      timer_started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      ...over,
    }),
    entry("te_1", "p_acme", "t_dev", { notes: "Sprint planning", hours: 0.5 }),
  ];

  it("shows it once, with everything spent on it today added up", async () => {
    api.getSnapshot.mockResolvedValue({ ...snapshot, today: twice() } satisfies Snapshot);

    render(<Popover />);

    // 30 minutes logged plus 10 running, on one row rather than two rows of a fraction.
    expect(await screen.findByText("0:40")).toBeDefined();
    expect(screen.queryByText("0:30")).toBeNull();
    expect(screen.getAllByText("Sprint planning")).toHaveLength(1);
  });

  it("resumes the newest stretch, not the first one of the day", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: twice({ is_running: false, hours: 0.25, ended_time: "10:15" }),
    } satisfies Snapshot);
    api.resumeEntry.mockResolvedValue(snapshot);
    render(<Popover />);

    await userEvent.setup().click(await screen.findByLabelText(/^Resume Development$/));

    expect(api.resumeEntry).toHaveBeenCalledWith("te_2");
  });

  it("keeps the same task apart when the notes differ", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: [
        entry("te_2", "p_acme", "t_dev", { notes: "Code review" }),
        entry("te_1", "p_acme", "t_dev", { notes: "Sprint planning" }),
      ],
    } satisfies Snapshot);

    render(<Popover />);

    expect(await screen.findByText("Code review")).toBeDefined();
    expect(screen.getByText("Sprint planning")).toBeDefined();
  });

  it("counts earlier stretches on the header clock too", async () => {
    // Otherwise the header and the row for the very same task disagree, both ticking.
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      today: twice(),
      timer: {
        status: "running",
        pair: snapshot.catalog[0]!,
        entryId: "te_2",
        startedAtMs: Date.now() - 10 * 60_000,
        note: "Sprint planning",
      },
    } satisfies Snapshot);

    render(<Popover />);

    // 00:40:00 rather than 00:10:00 — the half hour before the current stretch counts.
    expect(await screen.findByText(/^00:40:0\d$/)).toBeDefined();
  });
});

describe("the note field with Azure DevOps", () => {
  const workItems = [
    {
      id: 1234,
      title: "Fix the login redirect",
      project: "Acme Web",
      state: "Active",
      changedDate: "2026-09-03T11:00:00Z",
    },
    {
      id: 1240,
      title: "Login page copy",
      project: "Acme Web",
      state: "New",
      changedDate: "2026-09-03T10:00:00Z",
    },
    {
      id: 88,
      title: "Rework the timesheet export",
      project: "Acme Billing",
      state: "Active",
      changedDate: "2026-09-02T09:00:00Z",
    },
  ];

  const connected = (over: Partial<Snapshot["azure"]> = {}): Snapshot => ({
    ...snapshot,
    azure: {
      enabled: true,
      status: "connected",
      organisationUrl: "https://dev.azure.com/acme",
      hasToken: true,
      workItems,
      error: null,
      ...over,
    },
  });

  it("shows no mark and no listbox when the integration is off", async () => {
    render(<Popover />);
    await screen.findByText("QA");

    expect(screen.queryByLabelText("Azure DevOps")).toBeNull();
    expect(screen.getByPlaceholderText("What are you working on?")).toBeDefined();
  });

  it("leaves Enter starting the timer when no tickets are offered", async () => {
    // The whole loop of this app is type a note, press Enter. An integration nobody
    // switched on must not put a step in front of it.
    const user = userEvent.setup();
    api.switchTo.mockResolvedValue(snapshot);
    render(<Popover />);

    await user.type(await screen.findByPlaceholderText("What are you working on?"), "Just a note{Enter}");

    expect(api.switchTo).toHaveBeenCalledWith("p_acme:t_qa", "Just a note");
  });

  it("says what the mark means on hover", async () => {
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);

    const mark = await screen.findByRole("button", { name: /azure devops work items/i });
    expect(mark.getAttribute("title")).toBe("Connected to Azure DevOps");
  });

  it("shows the Azure mark once connected", async () => {
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);

    expect(await screen.findByLabelText("Azure DevOps")).toBeDefined();
  });

  it("opens the assigned tickets on the down arrow", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);

    await user.click(await screen.findByPlaceholderText(/What are you working on/));
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("listbox")).toBeDefined();
    expect(screen.getByText("Fix the login redirect")).toBeDefined();
  });

  it("highlights the first option when the list opens", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);

    await user.click(await screen.findByPlaceholderText(/What are you working on/));
    await user.keyboard("{ArrowDown}");

    const options = screen.getAllByRole("option");
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("highlights the first option when the mark opens the list", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);

    await user.click(await screen.findByRole("button", { name: /show your azure devops work items/i }));

    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("does not move the highlight when the list opens under the pointer", async () => {
    // A list rendered beneath a stationary mouse fires mouseenter on whatever row lands
    // under it. That was picking the second option the moment the list opened.
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);
    await user.click(await screen.findByPlaceholderText(/What are you working on/));
    await user.keyboard("{ArrowDown}");

    fireEvent.mouseEnter(screen.getAllByRole("option")[1]!);

    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("still follows the mouse when the mouse actually moves", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);
    await user.click(await screen.findByPlaceholderText(/What are you working on/));
    await user.keyboard("{ArrowDown}");

    fireEvent.mouseMove(screen.getAllByRole("option")[1]!);

    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("goes back to the first option as the filter changes", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);
    const input = await screen.findByPlaceholderText(/What are you working on/);

    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.type(input, "login");

    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("filters the tickets as you type", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);

    await user.type(await screen.findByPlaceholderText(/What are you working on/), "timesheet");

    expect(screen.getByText("Rework the timesheet export")).toBeDefined();
    expect(screen.queryByText("Fix the login redirect")).toBeNull();
  });

  it("keeps the most recently updated first while filtering", async () => {
    // Matching decides what is offered, never the order. Ranking by how well something
    // matched meant the list reshuffled with every keystroke.
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);

    await user.type(await screen.findByPlaceholderText(/What are you working on/), "login");

    const shown = screen.getAllByRole("option").map((row) => row.textContent);
    expect(shown[0]).toContain("Fix the login redirect");
    expect(shown[1]).toContain("Login page copy");
  });

  it("finds a ticket by its number", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);

    await user.type(await screen.findByPlaceholderText(/What are you working on/), "1234");

    expect(screen.getByText("Fix the login redirect")).toBeDefined();
    expect(screen.queryByText("Login page copy")).toBeNull();
  });

  it("puts the ticket in the note as number and title", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);
    const input = await screen.findByPlaceholderText(/What are you working on/);

    await user.type(input, "timesheet");
    await user.keyboard("{Enter}");

    expect((input as HTMLInputElement).value).toBe("88: Rework the timesheet export");
  });

  it("picks with Enter rather than starting the timer, so the next Enter starts it", async () => {
    // Enter means "pick" only while the list is open. This is the one keystroke the
    // integration takes over, and it hands it straight back.
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    api.switchTo.mockResolvedValue(snapshot);
    render(<Popover />);
    const input = await screen.findByPlaceholderText(/What are you working on/);

    await user.type(input, "timesheet");
    await user.keyboard("{Enter}");
    expect(api.switchTo).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(api.switchTo).toHaveBeenCalledWith("p_acme:t_qa", "88: Rework the timesheet export");
  });

  it("closes the list on Escape and keeps what was typed", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);
    const input = await screen.findByPlaceholderText(/What are you working on/);

    await user.type(input, "login");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("login");
    // Escape closed the list, not the popover.
    expect(api.closePopover).not.toHaveBeenCalled();
  });

  it("survives arrowing down while nothing matches", async () => {
    // Arrowing down with an empty list moved the highlight to matches.length - 1, which is
    // -1, and a clamp that only looks *past* the end of the list cannot see that. Typing
    // resets the cursor, so the way it persists is a list that refills without a keystroke
    // — which is exactly what the ten-minute refresh does.
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    render(<Popover />);
    const input = await screen.findByPlaceholderText(/What are you working on/);

    await user.type(input, "zzzznothing");
    await user.keyboard("{ArrowDown}");

    // A refresh brings in a work item that does match what is already typed.
    const push = api.onSnapshot.mock.calls[0]![0];
    await act(async () => {
      push(
        connected({
          workItems: [
            {
              id: 99,
              title: "zzzznothing to see here",
              project: "Acme Web",
              state: "Active",
              changedDate: "2026-09-03T12:00:00Z",
            },
          ],
        }),
      );
    });

    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("still lets you type a note that is not a ticket at all", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(connected());
    api.switchTo.mockResolvedValue(snapshot);
    render(<Popover />);

    await user.type(
      await screen.findByPlaceholderText(/What are you working on/),
      "Reviewing a pull request",
    );
    await user.keyboard("{Enter}");

    expect(api.switchTo).toHaveBeenCalledWith("p_acme:t_qa", "Reviewing a pull request");
  });

  it("offers nothing while the connection is broken", async () => {
    // A stale list behind a connection that has stopped working would suggest tickets it
    // cannot refresh.
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(
      connected({ status: "error", workItems: [], error: "Token expired" }),
    );
    render(<Popover />);

    await user.type(await screen.findByPlaceholderText("What are you working on?"), "login");

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("browsing the work item list", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: 100 + i,
    title: `Work item ${100 + i}`,
    project: i % 2 === 0 ? "Acme Web" : "Acme Billing",
    state: "Active",
    changedDate: `2026-09-03T${String(23 - (i % 24)).padStart(2, "0")}:00:00Z`,
  }));

  const withItems = (items: typeof many) =>
    ({
      ...snapshot,
      azure: {
        enabled: true,
        status: "connected" as const,
        organisationUrl: "https://dev.azure.com/acme",
        hasToken: true,
        workItems: items,
        error: null,
      },
    }) satisfies Snapshot;

  it("shows the project rather than the work item type", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(withItems(many.slice(0, 2)));
    render(<Popover />);

    await user.click(await screen.findByPlaceholderText(/What are you working on/));
    await user.keyboard("{ArrowDown}");

    expect(screen.getByText("Acme Web")).toBeDefined();
    expect(screen.getByText("Acme Billing")).toBeDefined();
  });

  it("offers every assigned item rather than a shortlist, and scrolls", async () => {
    // The down arrow is the only way to browse what is assigned to you, so cutting the
    // list to a handful would hide most of it.
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(withItems(many));
    render(<Popover />);

    await user.click(await screen.findByPlaceholderText(/What are you working on/));
    await user.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("option")).toHaveLength(40);
  });

  it("opens the list when the Azure mark is clicked", async () => {
    // The mark is the most obvious thing to click when you want to see your tickets.
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(withItems(many.slice(0, 3)));
    render(<Popover />);

    await user.click(await screen.findByRole("button", { name: /show your azure devops work items/i }));

    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("closes it again on a second click", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(withItems(many.slice(0, 3)));
    render(<Popover />);
    const mark = await screen.findByRole("button", { name: /show your azure devops work items/i });

    await user.click(mark);
    await user.click(screen.getByRole("button", { name: /hide your azure devops work items/i }));

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps the caret in the note after the mark is clicked", async () => {
    // Clicking the mark is a way into the list, not a way out of the field you were typing
    // in — the next keystroke has to go where it would have gone anyway.
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(withItems(many.slice(0, 3)));
    render(<Popover />);

    await user.click(await screen.findByRole("button", { name: /show your azure devops work items/i }));

    expect(document.activeElement).toBe(screen.getByPlaceholderText(/What are you working on/));
  });
});
