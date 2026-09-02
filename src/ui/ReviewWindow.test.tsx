/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../electron/service.js";

const api = {
  getSnapshot: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  listEntries: vi.fn(),
  setHidden: vi.fn(),
  toggleFavourite: vi.fn(),
  setTrayLabel: vi.fn(),
  setHotkey: vi.fn(),
  setApiKey: vi.fn(),
  signOut: vi.fn(),
  openLog: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
};
vi.stubGlobal("keito", api);

const { ReviewWindow } = await import("./ReviewWindow.js");

const pair = (id: string, projectName: string, taskName: string) => {
  const [projectId, taskId] = id.split(":") as [string, string];
  return { id, projectId, projectName, taskId, taskName };
};

const snapshot: Snapshot = {
  keyStatus: "ready",
  identity: { userId: "u", name: "Chris", accountId: "co", accountName: "Acme" },
  catalog: [pair("p_acme:t_dev", "Acme Rebuild", "Development"), pair("p_bank:t_ops", "Bank Portal", "Ops")],
  recents: [],
  favourites: [],
  hidden: [],
  today: [],
  workspaceTimezone: "UTC",
  hotkey: "X",
  accountId: "co",
  trayFallback: "task",
  trayPrefix: "none",
  revision: 1,
  timer: { status: "idle" },
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getSnapshot.mockResolvedValue(snapshot);
  api.listEntries.mockResolvedValue([]);
});

describe("the review window", () => {
  it("has three tabs", async () => {
    render(<ReviewWindow />);

    const tabs = within(await screen.findByRole("navigation")).getAllByRole("button");

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Entries",
      "Visible Projects",
      "Settings",
    ]);
  });

  it("lists projects and their tasks with a toggle under Visible Projects", async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);

    await user.click(await screen.findByRole("button", { name: "Visible Projects" }));

    expect(screen.getByLabelText("Acme Rebuild Development")).toBeDefined();
    expect(screen.getByLabelText("All tasks in Bank Portal")).toBeDefined();
  });

  it("switches a task off from that tab", async () => {
    const user = userEvent.setup();
    api.setHidden.mockResolvedValue(snapshot);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Visible Projects" }));

    await user.click(screen.getByLabelText("Acme Rebuild Development"));

    expect(api.setHidden).toHaveBeenCalledWith(["p_acme:t_dev"], true);
  });

  it("no longer keeps visibility inside Settings", async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));

    expect(screen.queryByLabelText("Acme Rebuild Development")).toBeNull();
  });

  it("forces Settings when there is no working key, since nothing else can work", async () => {
    api.getSnapshot.mockResolvedValue({ ...snapshot, keyStatus: "missing" } satisfies Snapshot);

    render(<ReviewWindow />);

    expect(await screen.findByPlaceholderText("kto_…")).toBeDefined();
  });
});
