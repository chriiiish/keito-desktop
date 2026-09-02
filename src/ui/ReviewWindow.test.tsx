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
  setCompanyId: vi.fn(),
  signOut: vi.fn(),
  openLog: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
};
vi.stubGlobal("keito", api);

const { ReviewWindow } = await import("./ReviewWindow.js");

/** A promise the test controls, so "in flight" is a state we can assert during. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

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
  hotkey: "CommandOrControl+Shift+K",
  hotkeyRegistered: true,
  platform: "darwin",
  accountId: "co",
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
  api.listEntries.mockResolvedValue([]);
});

describe("the review window", () => {
  it("has three tabs", async () => {
    render(<ReviewWindow />);

    const tabs = within(await screen.findByRole("navigation")).getAllByRole("button");

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Time Entries",
      "Projects",
      "Keito Connection",
      "Settings",
    ]);
  });

  it("lists projects and their tasks with a toggle under Visible Projects", async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);

    await user.click(await screen.findByRole("button", { name: "Projects" }));

    expect(screen.getByLabelText("Acme Rebuild Development")).toBeDefined();
    expect(screen.getByLabelText("All tasks in Bank Portal")).toBeDefined();
  });

  it("switches a task off from that tab", async () => {
    const user = userEvent.setup();
    api.setHidden.mockResolvedValue(snapshot);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Projects" }));

    await user.click(screen.getByLabelText("Acme Rebuild Development"));

    expect(api.setHidden).toHaveBeenCalledWith(["p_acme:t_dev"], true);
  });

  it("keeps Settings to preferences, with no visibility or connection fields", async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));

    expect(screen.queryByLabelText("Acme Rebuild Development")).toBeNull();
    expect(screen.queryByPlaceholderText("kto_…")).toBeNull();
  });

  it("favourites a task from the Projects tab", async () => {
    const user = userEvent.setup();
    api.toggleFavourite.mockResolvedValue(snapshot);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Projects" }));

    await user.click(screen.getAllByLabelText("Favourite Bank Portal Ops")[0]!);

    expect(api.toggleFavourite).toHaveBeenCalledWith("p_bank:t_ops");
  });

  it("labels an always-shown task simply Favourite or Recent", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      favourites: ["p_acme:t_dev"],
      recents: ["p_bank:t_ops"],
    } satisfies Snapshot);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Projects" }));

    expect(screen.getByText("Favourite")).toBeDefined();
    expect(screen.getByText("Recent")).toBeDefined();
  });

  it("lists favourites on the Projects tab", async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({ ...snapshot, favourites: ["p_acme:t_dev"] } satisfies Snapshot);
    render(<ReviewWindow />);

    await user.click(await screen.findByRole("button", { name: "Projects" }));

    expect(screen.getByText("Acme Rebuild — Development")).toBeDefined();
  });
});

describe("loading time entries", () => {
  it("owns up to the wait while the API responds", async () => {
    const gate = deferred<never[]>();
    api.listEntries.mockReturnValue(gate.promise);
    render(<ReviewWindow />);

    expect(await screen.findByText("Oh my gosh, look at the time")).toBeDefined();
    expect(screen.getByRole("status")).toBeDefined();
    gate.resolve([]);
  });

  it("shows the table once the entries arrive", async () => {
    render(<ReviewWindow />);

    expect(await screen.findByText(/nothing logged today/i)).toBeDefined();
    expect(screen.queryByText("Oh my gosh, look at the time")).toBeNull();
  });

  it("does the same when switching to the week view", async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await screen.findByText(/nothing logged today/i);

    const gate = deferred<never[]>();
    api.listEntries.mockReturnValue(gate.promise);
    await user.click(screen.getByRole("button", { name: "This week" }));

    expect(screen.getByText("Oh my gosh, look at the time")).toBeDefined();
    gate.resolve([]);
  });
});

describe("while a settings action is in flight", () => {
  it("saves the connection only once however many times Enter or the button fires", async () => {
    const user = userEvent.setup();
    const gate = deferred<Snapshot>();
    api.setCompanyId.mockReturnValue(gate.promise);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Keito Connection" }));
    await user.clear(screen.getByLabelText("Company ID"));
    await user.type(screen.getByLabelText("Company ID"), "co_other");

    await user.keyboard("{Enter}{Enter}");

    expect(api.setCompanyId).toHaveBeenCalledTimes(1);
    gate.resolve(snapshot);
  });

  it("locks a visibility toggle until its write comes back", async () => {
    const user = userEvent.setup();
    const gate = deferred<Snapshot>();
    api.setHidden.mockReturnValue(gate.promise);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Projects" }));
    const toggle = screen.getByLabelText("Acme Rebuild Development");

    await user.click(toggle);

    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(api.setHidden).toHaveBeenCalledTimes(1);
    gate.resolve(snapshot);
  });

  it("favourites only once per click", async () => {
    const user = userEvent.setup();
    const gate = deferred<Snapshot>();
    api.toggleFavourite.mockReturnValue(gate.promise);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Projects" }));
    const star = screen.getAllByLabelText("Favourite Bank Portal Ops")[0]!;

    await user.click(star);
    await user.click(star);

    expect(api.toggleFavourite).toHaveBeenCalledTimes(1);
    gate.resolve(snapshot);
  });
});

describe("the shortcut recorder", () => {
  const openSettings = async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    return user;
  };

  it("shows the current shortcut as keys, not as an accelerator string", async () => {
    await openSettings();

    const display = screen.getByLabelText("Current shortcut");

    expect(within(display).getAllByText(/./).map((k) => k.textContent)).toEqual(["⌘", "⇧", "K"]);
  });

  it("records the combination that is actually pressed", async () => {
    const user = await openSettings();
    api.setHotkey.mockResolvedValue(snapshot);

    await user.click(screen.getByRole("button", { name: "Record" }));
    await user.keyboard("{Meta>}{Shift>}j{/Shift}{/Meta}");

    expect(api.setHotkey).toHaveBeenCalledWith("CommandOrControl+Shift+J");
  });

  it("keeps listening while only modifiers are held", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Record" }));
    await user.keyboard("{Meta>}");

    expect(api.setHotkey).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("cancels on Escape without changing anything", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Record" }));
    await user.keyboard("{Escape}");

    expect(api.setHotkey).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record" })).toBeDefined();
  });

  it("says so when the OS refused the shortcut", async () => {
    api.getSnapshot.mockResolvedValue({ ...snapshot, hotkeyRegistered: false } satisfies Snapshot);
    await openSettings();

    expect(screen.getByText(/another application is probably already using it/i)).toBeDefined();
  });
});

describe("the connection tab", () => {
  it("leads with success, not with a disconnect button", async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);

    await user.click(await screen.findByRole("button", { name: "Keito Connection" }));

    expect(screen.getByText("You’re connected!")).toBeDefined();
  });

  it("shows the stored company id and a masked key, never the key itself", async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Keito Connection" }));

    expect((screen.getByLabelText("Company ID") as HTMLInputElement).value).toBe("co");
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("kto_••••••••abcd");
  });

  it("updates the company id alone without asking for the key again", async () => {
    const user = userEvent.setup();
    api.setCompanyId.mockResolvedValue(snapshot);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Keito Connection" }));

    await user.clear(screen.getByLabelText("Company ID"));
    await user.type(screen.getByLabelText("Company ID"), "co_other");
    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(api.setCompanyId).toHaveBeenCalledWith("co_other");
    expect(api.setApiKey).not.toHaveBeenCalled();
  });

  it("sends a genuinely new key through setApiKey", async () => {
    const user = userEvent.setup();
    api.setApiKey.mockResolvedValue(snapshot);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Keito Connection" }));

    await user.clear(screen.getByLabelText("API key"));
    await user.type(screen.getByLabelText("API key"), "kto_brand_new");
    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(api.setApiKey).toHaveBeenCalledWith("kto_brand_new", "co");
  });

  it("opens on the connection tab when there is no working key", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      keyStatus: "missing",
      apiKeyHint: null,
    } satisfies Snapshot);

    render(<ReviewWindow />);

    expect(await screen.findByRole("button", { name: "Connect" })).toBeDefined();
  });
});
