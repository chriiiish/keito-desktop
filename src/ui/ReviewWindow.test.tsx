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
  resetAll: vi.fn(),
  openLog: vi.fn(),
  openExternal: vi.fn(),
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
  appVersion: "0.1.0",
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
      "Contribute",
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

describe("collapsing projects", () => {
  const openProjects = async (next?: Partial<Snapshot>) => {
    const user = userEvent.setup();
    if (next) api.getSnapshot.mockResolvedValue({ ...snapshot, ...next } satisfies Snapshot);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Projects" }));
    return user;
  };

  // An empty `hidden` means nobody has switched anything off yet, so there is
  // nothing to have tidied away — and the whole list is what a first visit is for.
  it("starts expanded when nothing has been switched off", async () => {
    await openProjects();

    expect(screen.getByRole("button", { name: "Acme Rebuild" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeDefined();
  });

  it("starts collapsed once anything has been switched off", async () => {
    await openProjects({ hidden: ["p_bank:t_ops"] });

    expect(screen.getByRole("button", { name: "Acme Rebuild" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Expand all" })).toBeDefined();
  });

  it("opens and closes one project at a time", async () => {
    const user = await openProjects({ hidden: ["p_bank:t_ops"] });
    const acme = screen.getByRole("button", { name: "Acme Rebuild" });

    await user.click(acme);

    expect(acme.getAttribute("aria-expanded")).toBe("true");
    // The other one is unaffected.
    expect(screen.getByRole("button", { name: "Bank Portal" }).getAttribute("aria-expanded")).toBe("false");

    await user.click(acme);
    expect(acme.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands everything, then offers to collapse it again", async () => {
    const user = await openProjects({ hidden: ["p_bank:t_ops"] });

    await user.click(screen.getByRole("button", { name: "Expand all" }));

    expect(screen.getByRole("button", { name: "Acme Rebuild" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Bank Portal" }).getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(screen.getByRole("button", { name: "Acme Rebuild" }).getAttribute("aria-expanded")).toBe("false");
  });

  // A filter that answered with collapsed headers would look like it found nothing.
  it("opens what a filter matches", async () => {
    const user = await openProjects({ hidden: ["p_bank:t_ops"] });

    await user.type(screen.getByPlaceholderText("Filter projects and tasks…"), "Ops");

    expect(screen.getByRole("button", { name: "Bank Portal" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Bank Portal Ops")).toBeDefined();
  });

  // Filtering forces matches open, so the header cannot honour a click. Left live it
  // would look inert while quietly rewriting what you find on clearing the filter.
  it("cannot be collapsed while a filter is holding it open", async () => {
    const user = await openProjects({ hidden: ["p_bank:t_ops"] });
    const filter = screen.getByPlaceholderText("Filter projects and tasks…");
    await user.type(filter, "Ops");

    const bank = screen.getByRole("button", { name: "Bank Portal" });
    expect(bank.hasAttribute("disabled")).toBe(true);
    await user.click(bank);
    expect(bank.getAttribute("aria-expanded")).toBe("true");

    // Clearing the filter leaves it as it was, not secretly toggled underneath.
    await user.clear(filter);
    expect(screen.getByRole("button", { name: "Bank Portal" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  // Visibility is stored as exclusions, so a project added to the workspace later is
  // shown until someone switches it off. An allow-list would make it invisible instead.
  it("shows a project that appeared after the preferences were written", async () => {
    await openProjects({
      hidden: ["p_bank:t_ops"],
      catalog: [...snapshot.catalog, pair("p_new:t_new", "Brand New", "Discovery")],
    });

    expect(screen.getByRole("button", { name: "Brand New" })).toBeDefined();
    const toggle = screen.getByLabelText("All tasks in Brand New") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
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

describe("the menu bar label settings", () => {
  const openSettings = async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    return user;
  };

  it("offers radio buttons rather than dropdowns", async () => {
    await openSettings();

    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: /just the note/i })).toBeDefined();
  });

  it("checks the options currently in effect", async () => {
    await openSettings();

    expect((screen.getByRole("radio", { name: /just the note/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /show the task/i }) as HTMLInputElement).checked).toBe(true);
  });

  it("shows what each option would produce", async () => {
    await openSettings();

    expect(screen.getByRole("radio", { name: /project, then the note/i })).toBeDefined();
    expect(screen.getByText("Acme Rebuild: Sprint planning")).toBeDefined();
  });

  it("updates the preview as soon as a radio changes, not when the write returns", async () => {
    const user = await openSettings();
    // Never resolves: the preview must not be waiting on it.
    api.setTrayLabel.mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByRole("radio", { name: /task, then the note/i }));

    expect(screen.getByTestId("tray-preview").textContent).toBe("Development: Sprint planning");
  });

  it("saves both settings together so one cannot clobber the other", async () => {
    const user = await openSettings();
    api.setTrayLabel.mockResolvedValue(snapshot);

    await user.click(screen.getByRole("radio", { name: /show the project/i }));

    expect(api.setTrayLabel).toHaveBeenCalledWith({ prefix: "none", fallback: "project" });
  });
});

describe("the contribute tab", () => {
  const openContribute = async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Contribute" }));
    return user;
  };

  it("says the project is open source", async () => {
    await openContribute();

    expect(screen.getByText(/free and open source/i)).toBeDefined();
  });

  it("opens the repository in the real browser, not in the app", async () => {
    const user = await openContribute();
    api.openExternal.mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: /browse the source/i }));

    expect(api.openExternal).toHaveBeenCalledWith("https://github.com/chriiiish/keito-desktop");
  });

  it("links to issues and pull requests as well", async () => {
    const user = await openContribute();
    api.openExternal.mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: /report a bug/i }));

    expect(api.openExternal).toHaveBeenCalledWith(
      "https://github.com/chriiiish/keito-desktop/issues",
    );
  });

  it("offers the tip jar", async () => {
    const user = await openContribute();
    api.openExternal.mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: /buy me a coffee/i }));

    expect(api.openExternal).toHaveBeenCalledWith("https://buymeacoffee.com/chris.lloyd");
  });

  it("makes clear the app stays free", async () => {
    await openContribute();

    expect(screen.getByText(/free, and will stay that way/i)).toBeDefined();
  });

  it("shows the build version, so a bug report can name it", async () => {
    await openContribute();

    expect(screen.getByText("0.1.0")).toBeDefined();
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

describe("the danger zone", () => {
  const openSettings = async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    return user;
  };

  const cleared = {
    ...snapshot,
    keyStatus: "missing",
    apiKeyHint: null,
    identity: null,
    favourites: [],
    accountId: null,
  } satisfies Snapshot;

  it("sits at the bottom of the settings page under its own heading", async () => {
    await openSettings();

    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Clear all configuration…" })).toBeDefined();
  });

  // The whole point of the two steps: the first click must not destroy anything.
  it("asks before clearing anything", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Clear all configuration…" }));

    expect(api.resetAll).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Yes, clear everything" })).toBeDefined();
  });

  it("names what it is about to delete rather than asking to confirm in the abstract", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Clear all configuration…" }));

    const warning = screen.getByText(/hidden categories/);
    expect(warning.textContent).toMatch(/API key/);
    expect(warning.textContent).toMatch(/favourites/);
    expect(warning.textContent).toMatch(/shortcut/);
  });

  it("clears everything once confirmed", async () => {
    const user = await openSettings();
    api.resetAll.mockResolvedValue(cleared);

    await user.click(screen.getByRole("button", { name: "Clear all configuration…" }));
    await user.click(screen.getByRole("button", { name: "Yes, clear everything" }));

    expect(api.resetAll).toHaveBeenCalledTimes(1);
  });

  it("routes to the connection tab afterwards, because the key is gone", async () => {
    const user = await openSettings();
    api.resetAll.mockResolvedValue(cleared);

    await user.click(screen.getByRole("button", { name: "Clear all configuration…" }));
    await user.click(screen.getByRole("button", { name: "Yes, clear everything" }));

    expect(await screen.findByRole("button", { name: "Connect" })).toBeDefined();
  });

  it("backs out on cancel, leaving the configuration alone", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Clear all configuration…" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.resetAll).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clear all configuration…" })).toBeDefined();
  });

  // Two clicks in one tick would otherwise both fire — see AsyncButton's ref guard.
  it("cannot be double-fired while the reset is in flight", async () => {
    const user = await openSettings();
    const gate = deferred<Snapshot>();
    api.resetAll.mockReturnValue(gate.promise);

    await user.click(screen.getByRole("button", { name: "Clear all configuration…" }));
    const confirm = screen.getByRole("button", { name: "Yes, clear everything" });
    await user.click(confirm);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    await user.click(confirm);

    expect(api.resetAll).toHaveBeenCalledTimes(1);
    gate.resolve(cleared);
  });
});
