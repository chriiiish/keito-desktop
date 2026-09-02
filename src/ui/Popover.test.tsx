/**
 * @vitest-environment jsdom
 *
 * A smoke test for the start form: the popover now holds real logic (which category is
 * preselected, what order the dropdown groups appear in), and it is the one screen that
 * cannot be checked by reading a snapshot.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../electron/service.js";

const api = {
  getSnapshot: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  onIdleReturn: vi.fn(() => () => {}),
  switchTo: vi.fn(),
  stopTimer: vi.fn(),
  toggleFavourite: vi.fn(),
  closePopover: vi.fn(),
  openWindow: vi.fn(),
  resolveIdle: vi.fn(),
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
  ],
  recents: ["p_bank:t_dev"],
  favourites: ["p_acme:t_qa"],
  workspaceTimezone: "UTC",
  hotkey: "X",
  accountId: "co_9",
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

describe("the start form", () => {
  it("offers every category in one dropdown, favourites first", async () => {
    render(<Popover />);

    const select = await screen.findByLabelText(/category/i);
    const groups = within(select).getAllByRole("group");

    expect(groups.map((group) => group.getAttribute("label"))).toEqual([
      "Favourites",
      "Recent",
      "All categories",
    ]);
  });

  it("preselects the first suggestion, so Enter alone starts something sensible", async () => {
    render(<Popover />);

    const select = (await screen.findByLabelText(/category/i)) as HTMLSelectElement;

    expect(select.value).toBe("p_acme:t_qa"); // the favourite
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
    const { userEvent } = await import("@testing-library/user-event");
    api.switchTo.mockResolvedValue({ ...snapshot, error: null });
    render(<Popover />);

    const note = await screen.findByPlaceholderText(/what are you working on/i);
    await userEvent.setup().type(note, "Sprint planning{Enter}");

    expect(api.switchTo).toHaveBeenCalledWith("p_acme:t_qa", "Sprint planning");
  });
});
