import { describe, expect, it } from "vitest";
import { formatAccelerator, toAccelerator } from "./accelerator.js";

const press = (over: Partial<Parameters<typeof toAccelerator>[0]> = {}) => ({
  code: "KeyK",
  key: "k",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("toAccelerator", () => {
  it("turns a modifier combination into an Electron accelerator", () => {
    expect(toAccelerator(press({ metaKey: true, shiftKey: true }), "darwin")).toBe(
      "CommandOrControl+Shift+K",
    );
  });

  it("treats Ctrl off a Mac the way Command works on one, so shortcuts stay portable", () => {
    expect(toAccelerator(press({ ctrlKey: true, shiftKey: true }), "win32")).toBe(
      "CommandOrControl+Shift+K",
    );
  });

  it("keeps Control distinct from Command when both could apply", () => {
    expect(toAccelerator(press({ ctrlKey: true }), "darwin")).toBe("Control+K");
  });

  it("orders modifiers consistently however they were held", () => {
    expect(toAccelerator(press({ shiftKey: true, altKey: true, metaKey: true }), "darwin")).toBe(
      "CommandOrControl+Alt+Shift+K",
    );
  });

  it("names digits, function keys and arrows the way Electron does", () => {
    expect(toAccelerator(press({ code: "Digit4", metaKey: true }), "darwin")).toBe("CommandOrControl+4");
    expect(toAccelerator(press({ code: "F7", metaKey: true }), "darwin")).toBe("CommandOrControl+F7");
    expect(toAccelerator(press({ code: "ArrowUp", metaKey: true }), "darwin")).toBe("CommandOrControl+Up");
    expect(toAccelerator(press({ code: "Space", metaKey: true }), "darwin")).toBe("CommandOrControl+Space");
  });

  it("ignores a modifier pressed on its own — there is nothing to record yet", () => {
    expect(toAccelerator(press({ code: "ShiftLeft", key: "Shift", shiftKey: true }), "darwin")).toBeNull();
    expect(toAccelerator(press({ code: "MetaLeft", key: "Meta", metaKey: true }), "darwin")).toBeNull();
  });

  it("refuses a bare key, which would swallow that key everywhere on the system", () => {
    expect(toAccelerator(press(), "darwin")).toBeNull();
  });

  it("refuses Escape, which cancels recording instead", () => {
    expect(toAccelerator(press({ code: "Escape", metaKey: true }), "darwin")).toBeNull();
  });
});

describe("formatAccelerator", () => {
  it("uses the Mac symbols people actually read", () => {
    expect(formatAccelerator("CommandOrControl+Alt+Shift+K", "darwin")).toEqual(["⌘", "⌥", "⇧", "K"]);
  });

  it("spells the modifiers out elsewhere", () => {
    expect(formatAccelerator("CommandOrControl+Shift+K", "win32")).toEqual(["Ctrl", "Shift", "K"]);
  });

  it("passes through anything it does not recognise rather than dropping it", () => {
    expect(formatAccelerator("Super+F5", "linux")).toEqual(["Super", "F5"]);
  });
});
