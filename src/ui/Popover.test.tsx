/**
 * @vitest-environment jsdom
 *
 * A smoke test for the start form: the popover now holds real logic (which category is
 * preselected, what order the dropdown groups appear in), and it is the one screen that
 * cannot be checked by reading a snapshot.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Snapshot } from "../../electron/service.js";
import type { TimeEntry } from "../core/keito/types.js";

const api = {
  getSnapshot: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  onIdleReturn: vi.fn(() => () => {}),
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
  workspaceTimezone: "UTC",
  hotkey: "CommandOrControl+Shift+K",
  hotkeyRegistered: true,
  platform: "darwin",
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
