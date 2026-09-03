/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../electron/service.js";

const api = {
  getSnapshot: vi.fn(),
  onSnapshot: vi.fn((_handler: (snapshot: Snapshot) => void) => () => {}),
  listEntries: vi.fn(),
  setHidden: vi.fn(),
  toggleFavourite: vi.fn(),
  setTrayLabel: vi.fn(),
  setHotkey: vi.fn(),
  setOpenAtLogin: vi.fn(),
  setApiKey: vi.fn(),
  setCompanyId: vi.fn(),
  signOut: vi.fn(),
  resetAll: vi.fn(),
  openLog: vi.fn(),
  openExternal: vi.fn(),
  disconnectAzure: vi.fn(),
  connectAzure: vi.fn(),
  setAzureEnabled: vi.fn(),
  openWindow: vi.fn(),
  dismissUpdate: vi.fn(),
  onShowTab: vi.fn((_handler: (tab: string) => void) => () => {}),
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
      "Integrations",
      "About",
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

describe("the hours column while a timer runs", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "te_1",
    project_id: "p_acme",
    task_id: "t_dev",
    spent_date: "2026-09-02",
    started_time: "09:00",
    ended_time: "09:30",
    timer_started_at: null,
    duration_seconds: null,
    hours: 0.5,
    is_running: false,
    notes: null,
    ...over,
  });

  // A running entry reports hours: null, which rendered as an em dash — technically not
  // wrong, and no use at all to someone checking whether the day adds up.
  it("climbs from the start instead of showing a dash", async () => {
    api.listEntries.mockResolvedValue([
      row({
        is_running: true,
        ended_time: null,
        hours: null,
        timer_started_at: new Date(Date.now() - 90 * 60_000).toISOString(),
      }),
    ]);

    render(<ReviewWindow />);
    await screen.findByText("running");

    expect(screen.getByText("1.50")).toBeDefined();
  });

  it("leaves a stopped row reading its recorded hours", async () => {
    api.listEntries.mockResolvedValue([row()]);

    render(<ReviewWindow />);
    await screen.findByText("0.50");

    expect(screen.queryByText("—")).toBeNull();
  });
});

describe("the window title", () => {
  const show = async (over: Partial<Snapshot> = {}) => {
    // Set deliberately wrong first, so a passing assertion cannot be a leftover from the
    // previous test in this document.
    document.title = "not set";
    api.getSnapshot.mockResolvedValue({ ...snapshot, ...over } satisfies Snapshot);
    render(<ReviewWindow />);
    await screen.findByRole("navigation");
  };

  it("names the workspace once connected", async () => {
    await show();

    expect(document.title).toBe("Keito Timer - Acme");
  });

  it("stays plain until a key works", async () => {
    await show({ keyStatus: "missing", identity: null });

    expect(document.title).toBe("Keito Timer");
  });

  // A rejected key still carries the identity from when it worked; naming a workspace the
  // app can no longer reach would be a small lie in the one place always on screen.
  it("drops the name again when the key stops working", async () => {
    await show({ keyStatus: "rejected" });

    expect(document.title).toBe("Keito Timer");
  });

  it("does not trail a separator when there is no workspace name", async () => {
    await show({ identity: { userId: "u", name: "Chris", accountId: "co", accountName: "  " } });

    expect(document.title).toBe("Keito Timer");
  });

  it("follows the workspace when the snapshot changes", async () => {
    const user = userEvent.setup();
    await show({ keyStatus: "missing", identity: null, apiKeyHint: null, accountId: null });
    expect(document.title).toBe("Keito Timer");

    api.setApiKey.mockResolvedValue(snapshot);
    await user.type(screen.getByLabelText("API key"), "kto_new");
    await user.type(screen.getByLabelText("Company ID"), "co_123");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(document.title).toBe("Keito Timer - Acme");
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

describe("the about tab", () => {
  const openAbout = async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "About" }));
    return user;
  };

  it("says the project is open source", async () => {
    await openAbout();

    expect(screen.getByText(/free and open source/i)).toBeDefined();
  });

  it("opens the repository in the real browser, not in the app", async () => {
    const user = await openAbout();
    api.openExternal.mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: /browse the source/i }));

    expect(api.openExternal).toHaveBeenCalledWith("https://github.com/chriiiish/keito-desktop");
  });

  it("links to issues and pull requests as well", async () => {
    const user = await openAbout();
    api.openExternal.mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: /report a bug/i }));

    expect(api.openExternal).toHaveBeenCalledWith(
      "https://github.com/chriiiish/keito-desktop/issues",
    );
  });

  it("offers the tip jar", async () => {
    const user = await openAbout();
    api.openExternal.mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: /^☕ Buy me a/i }));

    expect(api.openExternal).toHaveBeenCalledWith("https://buymeacoffee.com/chris.lloyd");
  });

  it("makes clear the app is free", async () => {
    await openAbout();

    expect(screen.getByText(/Keito Timer is free\./i)).toBeDefined();
  });

  it("leads with the licence, then money, then code, then what you are running", async () => {
    // Ordered by how many people can act on the ask: the tip jar is one click, a pull
    // request is an afternoon. The build details are not a contribution at all — they are
    // what you copy into a bug report — so they come last.
    await openAbout();

    const headings = screen.getAllByRole("heading", { level: 2 });

    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Licence",
      "Say thanks",
      "Open source",
      "About this build",
    ]);
  });

  it("says it is unaffiliated with Keito, under the licence heading", async () => {
    // What this app is and what you may do with it are the same question, so the
    // disclaimer sits with the licence rather than in a section of its own.
    await openAbout();

    expect(screen.getByText(/not an official Keito product/i)).toBeDefined();
  });

  it("shows the build version, so a bug report can name it", async () => {
    await openAbout();

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

describe("the connection tab before it works", () => {
  const disconnected = {
    ...snapshot,
    keyStatus: "missing",
    identity: null,
    apiKeyHint: null,
    accountId: null,
  } satisfies Snapshot;

  const open = async (over: Partial<Snapshot> = {}) => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({ ...disconnected, ...over } satisfies Snapshot);
    render(<ReviewWindow />);
    await screen.findByRole("button", { name: "Connect" });
    return user;
  };

  it("welcomes you", async () => {
    await open();

    expect(screen.getByRole("heading", { name: "Welcome to Keito Timer" })).toBeDefined();
  });

  // Most people setting this up cannot issue themselves a key, so the instruction names
  // who can rather than only describing the field.
  it("says who to ask and what to ask for", async () => {
    await open();

    const steps = screen.getByRole("list");
    expect(steps.textContent).toMatch(/administrator/i);
    expect(steps.textContent).toMatch(/write-enabled/i);
    expect(steps.textContent).toMatch(/Company ID/i);
  });

  // Startup first, then the key: the switch is one tap and the key is an errand, so
  // putting the errand first is how a welcome turns into a wall.
  it("puts the startup switch ahead of the key", async () => {
    await open();

    const toggle = screen.getByLabelText("Run at startup");
    const apiKey = screen.getByLabelText("API key");

    expect(toggle.compareDocumentPosition(apiKey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers to run at startup while someone is here anyway", async () => {
    await open();

    expect(screen.getByText(/Start Keito Timer when you (log|sign) in/)).toBeDefined();
    expect(screen.getByLabelText("Run at startup")).toBeDefined();
  });

  // Windows signs in, macOS logs in. The matcher above accepts either; this is the one
  // that would notice if the platform switch were dropped and everyone got "log in".
  it("uses each platform's word for it", async () => {
    await open();
    expect(screen.getByText(/when you log in/)).toBeDefined();

    cleanup();
    await open({ platform: "win32" });
    expect(screen.getByText(/when you sign in/)).toBeDefined();
  });

  it("sets it from there", async () => {
    const user = await open();
    api.setOpenAtLogin.mockResolvedValue({ ...disconnected, openAtLogin: true } satisfies Snapshot);

    await user.click(screen.getByLabelText("Run at startup"));

    expect(api.setOpenAtLogin).toHaveBeenCalledWith(true);
  });

  // Hiding the step instead reads as a missing feature — which is exactly how it was
  // reported. Settings shows the same switch disabled with a reason; so does this.
  it("keeps the step when the login item is unavailable, disabled and explained", async () => {
    const user = await open({ canOpenAtLogin: false });

    const toggle = screen.getByLabelText("Run at startup");
    expect(screen.getByText(/Start Keito Timer when you (log|sign) in/)).toBeDefined();
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/development build/i)).toBeDefined();

    await user.click(toggle);
    expect(api.setOpenAtLogin).not.toHaveBeenCalled();
  });

  it("still numbers both steps when it cannot be offered", async () => {
    await open({ canOpenAtLogin: false });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("drops both once the key works", async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Keito Connection" }));

    expect(screen.getByText("You’re connected!")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Welcome to Keito Timer" })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByLabelText("Run at startup")).toBeNull();
  });
});

describe("run at startup", () => {
  const openSettings = async (over: Partial<Snapshot> = {}) => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue({ ...snapshot, ...over } satisfies Snapshot);
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    return user;
  };

  it("is off when the OS reports no login item", async () => {
    await openSettings();

    expect((screen.getByLabelText("Run at startup") as HTMLInputElement).checked).toBe(false);
  });

  // The switch reflects what the OS says, not a preference we wrote. Someone can turn the
  // login item off in System Settings, and the next snapshot has to show that.
  it("is on when the OS reports one", async () => {
    await openSettings({ openAtLogin: true });

    expect((screen.getByLabelText("Run at startup") as HTMLInputElement).checked).toBe(true);
  });

  it("asks to be launched at login", async () => {
    const user = await openSettings();
    api.setOpenAtLogin.mockResolvedValue({ ...snapshot, openAtLogin: true } satisfies Snapshot);

    await user.click(screen.getByLabelText("Run at startup"));

    expect(api.setOpenAtLogin).toHaveBeenCalledWith(true);
  });

  it("and to stop", async () => {
    const user = await openSettings({ openAtLogin: true });
    api.setOpenAtLogin.mockResolvedValue(snapshot);

    await user.click(screen.getByLabelText("Run at startup"));

    expect(api.setOpenAtLogin).toHaveBeenCalledWith(false);
  });

  // macOS names a login item after the bundle that registered it, and in development that
  // bundle is Electron.app — so the switch would create an item called "Electron" that
  // outlives the dev session. There is no renaming it; Electron's overrides are win32.
  it("is unavailable in a development run, and says why", async () => {
    const user = await openSettings({ canOpenAtLogin: false });

    const toggle = screen.getByLabelText("Run at startup");
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Electron binary rather than Keito Timer/)).toBeDefined();

    await user.click(toggle);
    expect(api.setOpenAtLogin).not.toHaveBeenCalled();
  });

  // Same guard as every other write: two events in one tick must not both fire.
  it("cannot be double-fired while the write is in flight", async () => {
    const user = await openSettings();
    const gate = deferred<Snapshot>();
    api.setOpenAtLogin.mockReturnValue(gate.promise);

    const toggle = screen.getByLabelText("Run at startup");
    await user.click(toggle);
    expect(toggle.hasAttribute("disabled")).toBe(true);
    await user.click(toggle);

    expect(api.setOpenAtLogin).toHaveBeenCalledTimes(1);
    gate.resolve(snapshot);
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

describe("connecting", () => {
  const disconnected = {
    ...snapshot,
    keyStatus: "missing",
    identity: null,
    apiKeyHint: null,
    accountId: null,
  } satisfies Snapshot;

  const connect = async () => {
    const user = userEvent.setup();
    api.getSnapshot.mockResolvedValue(disconnected);
    api.setApiKey.mockResolvedValue(snapshot);
    render(<ReviewWindow />);
    await screen.findByRole("button", { name: "Connect" });
    return user;
  };

  const fillAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText("API key"), "kto_new");
    await user.type(screen.getByLabelText("Company ID"), "co_123");
    await user.click(screen.getByRole("button", { name: "Connect" }));
  };

  it("opens on Time Entries once a key is accepted", async () => {
    const user = await connect();

    await fillAndSubmit(user);

    expect(await screen.findByText(/nothing logged today/i)).toBeDefined();
  });

  // Every tab shows the connection form until a key works, but the click was
  // still recorded — so whatever a new user poked at while setting up became
  // the page they landed on afterwards.
  it("still opens on Time Entries when another tab was clicked while disconnected", async () => {
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "About" }));

    await fillAndSubmit(user);

    expect(await screen.findByText(/nothing logged today/i)).toBeDefined();
    expect(screen.queryByText(/free and open source/i)).toBeNull();
  });

  it("leaves the tabs alone once connected", async () => {
    const user = await connect();
    await fillAndSubmit(user);
    await screen.findByText(/nothing logged today/i);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeDefined();
  });
});

const withUpdate = (over: Partial<NonNullable<Snapshot["update"]>> = {}) => ({
  ...snapshot,
  update: {
    version: "0.4.0",
    tag: "v0.4.0",
    name: "0.4.0",
    url: "https://github.com/chriiiish/keito-desktop/releases/tag/v0.4.0",
    publishedAt: "2026-09-03T00:00:00Z",
    notes: "## Download\n\nboilerplate the tab replaces\n\n## What's Changed\n* fix: fixed the thing by @chriiiish in https://github.com/x/pull/1",
    dismissed: false,
    ...over,
  },
});

describe("the update tab", () => {
  it("is not in the tab bar when there is nothing to update to", async () => {
    api.getSnapshot.mockResolvedValue(snapshot);
    render(<ReviewWindow />);
    await screen.findByRole("button", { name: "Time Entries" });

    expect(screen.queryByRole("button", { name: /Update Available/ })).toBeNull();
  });

  it("appears once a newer release is found", async () => {
    api.getSnapshot.mockResolvedValue(withUpdate());
    render(<ReviewWindow />);

    expect(await screen.findByRole("button", { name: /Update Available/ })).toBeDefined();
  });

  it("shows both versions, so it is clear what the jump is", async () => {
    api.getSnapshot.mockResolvedValue(withUpdate());
    render(<ReviewWindow />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Update Available/ }));

    expect(screen.getByText(/Keito Timer 0\.4\.0 is available/)).toBeDefined();
    expect(screen.getByText(/You are running 0\.1\.0/)).toBeDefined();
  });

  it("sends the download to the release page for that version", async () => {
    api.getSnapshot.mockResolvedValue(withUpdate());
    render(<ReviewWindow />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Update Available/ }));
    await user.click(screen.getByRole("button", { name: /Download 0\.4\.0/ }));

    expect(api.openExternal).toHaveBeenCalledWith(
      "https://github.com/chriiiish/keito-desktop/releases/tag/v0.4.0",
    );
  });

  it("says plainly that it does not update itself", async () => {
    // These builds are ad-hoc signed, so there is no auto-updater and never silently
    // will be. A user who downloads and then waits for something to happen is the
    // failure this sentence exists to prevent.
    api.getSnapshot.mockResolvedValue(withUpdate());
    render(<ReviewWindow />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Update Available/ }));

    expect(screen.getByText(/does not update itself/)).toBeDefined();
  });

  it("stays available after the popover notice is dismissed", async () => {
    // Dismissing quietens the timer; it does not decide the release is unfindable.
    api.getSnapshot.mockResolvedValue(withUpdate({ dismissed: true }));
    render(<ReviewWindow />);

    expect(await screen.findByRole("button", { name: /Update Available/ })).toBeDefined();
  });

  it("shows what changed, without the download boilerplate the body leads with", async () => {
    api.getSnapshot.mockResolvedValue(withUpdate());
    render(<ReviewWindow />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Update Available/ }));

    expect(screen.getByText("fix: fixed the thing")).toBeDefined();
    expect(screen.queryByText(/boilerplate the tab replaces/)).toBeNull();
  });

  it("omits the notes heading for a release with no changelog to show", async () => {
    api.getSnapshot.mockResolvedValue(withUpdate({ notes: null }));
    render(<ReviewWindow />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Update Available/ }));

    expect(screen.queryByText("What changed")).toBeNull();
  });

  it("falls back to the entries tab if the update goes away while it is open", async () => {
    // Installing the update removes the tab. A window sitting on it must land somewhere
    // real rather than render an empty pane.
    api.getSnapshot.mockResolvedValue(withUpdate());
    const { rerender } = render(<ReviewWindow />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Update Available/ }));
    expect(screen.getByText(/Keito Timer 0\.4\.0 is available/)).toBeDefined();

    // The snapshot the window is holding is replaced by a broadcast, so drive the
    // subscription the same way the main process would.
    const push = api.onSnapshot.mock.calls[0]![0];
    await act(async () => push(snapshot));
    rerender(<ReviewWindow />);

    expect(screen.queryByText(/Keito Timer 0\.4\.0 is available/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Update Available/ })).toBeNull();
  });

  it("ignores a tab id it does not render, rather than blanking the window", async () => {
    // show-tab arrives over IPC as an arbitrary string. An unknown id would otherwise
    // leave no pane rendered and nothing highlighted, and no tab button can set that
    // state, so there would be no way to click out of it.
    api.getSnapshot.mockResolvedValue(withUpdate());
    render(<ReviewWindow />);
    await screen.findByRole("button", { name: /Update Available/ });

    const show = api.onShowTab.mock.calls[0]![0];
    await act(async () => show("nonsense"));

    expect(screen.getByRole("button", { name: "Time Entries" }).className).toContain("on");
  });

  it("selects the tab when the main process asks for it", async () => {
    // How the popover notice gets here: an event, not Snapshot state.
    api.getSnapshot.mockResolvedValue(withUpdate());
    render(<ReviewWindow />);
    await screen.findByRole("button", { name: /Update Available/ });

    const show = api.onShowTab.mock.calls[0]![0];
    await act(async () => show("update"));

    expect(screen.getByText(/Keito Timer 0\.4\.0 is available/)).toBeDefined();
  });
});

describe("the update tab without a working key", () => {
  const noKey = (over: Partial<Snapshot> = {}) => ({
    ...withUpdate(),
    keyStatus: "missing" as const,
    ...over,
  });

  it("is still reachable, since it needs nothing from Keito", async () => {
    // Every other tab falls back to the connection form. This one does not: a user whose
    // key has just stopped working is exactly who might want the newer version.
    api.getSnapshot.mockResolvedValue(noKey());
    render(<ReviewWindow />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Update Available/ }));

    expect(screen.getByText(/Keito Timer 0\.4\.0 is available/)).toBeDefined();
  });

  it("leaves every other tab falling back to the connection form", async () => {
    api.getSnapshot.mockResolvedValue(noKey());
    render(<ReviewWindow />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Projects" }));

    expect(screen.queryByText(/Keito Timer 0\.4\.0 is available/)).toBeNull();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDefined();
  });
});

describe("the licence on the about tab", () => {
  const openAboutTab = async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "About" }));
    return user;
  };

  it("names the licence, since a GPL app that never says so invites misunderstanding", async () => {
    await openAboutTab();

    expect(screen.getByText(/GNU General Public License v3\.0/)).toBeDefined();
  });

  it("says plainly that using it at work is allowed", async () => {
    // The common misreading of copyleft is that it bans commercial use. It does not, and
    // for a timesheet app almost every user is billing someone.
    await openAboutTab();

    expect(screen.getByText(/including work you bill for/i)).toBeDefined();
  });

  it("opens the licence on GitHub rather than in the app", async () => {
    const user = await openAboutTab();
    api.openExternal.mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: /read the licence/i }));

    expect(api.openExternal).toHaveBeenCalledWith(
      "https://github.com/chriiiish/keito-desktop/blob/main/LICENSE",
    );
  });
});

describe("the integrations tab", () => {
  const openIntegrations = async () => {
    const user = userEvent.setup();
    render(<ReviewWindow />);
    await user.click(await screen.findByRole("button", { name: "Integrations" }));
    return user;
  };

  const azure = (over: Partial<Snapshot["azure"]> = {}): Snapshot => ({
    ...snapshot,
    azure: {
      enabled: false,
      status: "off",
      organisationUrl: null,
      hasToken: false,
      workItems: [],
      error: null,
      ...over,
    },
  });

  it("keeps the form out of the way until the integration is switched on", async () => {
    api.getSnapshot.mockResolvedValue(azure());
    await openIntegrations();

    expect(screen.getByText("Azure DevOps")).toBeDefined();
    expect(screen.queryByLabelText(/personal access token/i)).toBeNull();
  });

  it("names the scopes exactly as Azure DevOps does, and which is optional", async () => {
    // A security team refusing User Profile (Read) should cost the user one text field,
    // not the feature — so the page has to say which is which. The names have to match
    // the checkboxes on the token form character for character, or the user is hunting
    // for a scope that is not called that.
    api.getSnapshot.mockResolvedValue(azure({ enabled: true, status: "needs-token" }));
    await openIntegrations();

    expect(screen.getByText("Work Items (Read)")).toBeDefined();
    expect(screen.getByText("User Profile (Read)")).toBeDefined();
    expect(screen.getByText(/optional/i)).toBeDefined();
  });

  it("says where the optional scope is hiding", async () => {
    // Azure DevOps collapses the scope list, and User Profile is not in the short one —
    // without this the instruction reads as naming a scope that does not exist.
    api.getSnapshot.mockResolvedValue(azure({ enabled: true, status: "needs-token" }));
    await openIntegrations();

    expect(screen.getByText("Show all scopes")).toBeDefined();
  });

  it("says plainly that it only ever reads", async () => {
    api.getSnapshot.mockResolvedValue(azure({ enabled: true, status: "needs-token" }));
    await openIntegrations();

    expect(screen.getByText(/only ever reads/i)).toBeDefined();
  });

  it("does not ask for a URL until one is actually needed", async () => {
    // The common case is a token that finds its own organisation; asking up front would
    // make one thing look like two.
    api.getSnapshot.mockResolvedValue(azure({ enabled: true, status: "needs-token" }));
    await openIntegrations();

    expect(screen.queryByLabelText(/organisation url/i)).toBeNull();
  });

  it("asks for the URL once discovery has failed", async () => {
    api.getSnapshot.mockResolvedValue(
      azure({
        enabled: true,
        status: "error",
        error: "Could not work out your organisation from that token. Enter your Azure DevOps URL below and press Connect again.",
      }),
    );
    await openIntegrations();

    expect(screen.getByLabelText(/organisation url/i)).toBeDefined();
    expect(screen.getByText(/Enter your Azure DevOps URL/)).toBeDefined();
  });

  it("connects with the token typed in", async () => {
    api.getSnapshot.mockResolvedValue(azure({ enabled: true, status: "needs-token" }));
    api.connectAzure.mockResolvedValue(azure({ enabled: true, status: "connected" }));
    const user = await openIntegrations();

    await user.type(screen.getByLabelText(/personal access token/i), "pat_secret");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(api.connectAzure).toHaveBeenCalledWith("pat_secret", undefined);
  });

  it("cannot connect with an empty token", async () => {
    api.getSnapshot.mockResolvedValue(azure({ enabled: true, status: "needs-token" }));
    await openIntegrations();

    expect(screen.getByRole("button", { name: "Connect" }).hasAttribute("disabled")).toBe(true);
  });

  it("says which organisation it is connected to", async () => {
    api.getSnapshot.mockResolvedValue(
      azure({
        enabled: true,
        status: "connected",
        hasToken: true,
        organisationUrl: "https://dev.azure.com/acme",
        workItems: [
          { id: 1, title: "One", project: "Acme Web", state: "Active", changedDate: null },
        ],
      }),
    );
    await openIntegrations();

    expect(screen.getByText(/Connected — acme/)).toBeDefined();
    expect(screen.getByText(/1 work item assigned to you/)).toBeDefined();
  });

  it("offers to forget the token once one is stored", async () => {
    api.getSnapshot.mockResolvedValue(
      azure({ enabled: true, status: "connected", hasToken: true }),
    );
    api.disconnectAzure.mockResolvedValue(azure());
    const user = await openIntegrations();

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(api.disconnectAzure).toHaveBeenCalledTimes(1);
  });

  it("never shows the stored token back, only that there is one", async () => {
    // The renderer is never given the token, the same as the Keito key.
    api.getSnapshot.mockResolvedValue(
      azure({ enabled: true, status: "connected", hasToken: true }),
    );
    await openIntegrations();

    const field = screen.getByLabelText(/personal access token/i) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.type).toBe("password");
    expect(field.placeholder).toMatch(/a token is stored/i);
  });

  it("switches the integration on from the toggle", async () => {
    api.getSnapshot.mockResolvedValue(azure());
    api.setAzureEnabled.mockResolvedValue(azure({ enabled: true, status: "needs-token" }));
    const user = await openIntegrations();

    await user.click(screen.getByRole("checkbox", { name: "Azure DevOps" }));

    expect(api.setAzureEnabled).toHaveBeenCalledWith(true);
  });
});
