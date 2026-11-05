import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n, {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  NAMESPACES,
  currentLocale,
  isSupportedLocale,
  readStoredLocale,
  resources,
  setLocale,
  translate,
} from "./index";

function storageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function collectKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("i18n", () => {
  let storage: ReturnType<typeof storageStub>;

  beforeEach(async () => {
    storage = storageStub();
    vi.stubGlobal("window", { localStorage: storage });
    await setLocale("zh-CN");
    storage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to Simplified Chinese when nothing is stored", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(readStoredLocale()).toBe("zh-CN");
    expect(translate("app.subtitle")).toBe("内存调试工作台");
  });

  it("uses the documented localStorage key", async () => {
    expect(LOCALE_STORAGE_KEY).toBe("pwnviz.locale");
    await setLocale("en-US");
    expect(storage.getItem("pwnviz.locale")).toBe("en-US");
    expect(readStoredLocale()).toBe("en-US");
  });

  it("switches languages without a reload", async () => {
    expect(translate("toolbar:run")).toBe("运行");
    await setLocale("en-US");
    expect(currentLocale()).toBe("en-US");
    expect(translate("toolbar:run")).toBe("Run");
    expect(translate("panels:stack.title")).toBe("Stack memory");
    await setLocale("zh-CN");
    expect(translate("panels:stack.title")).toBe("栈内存");
    expect(i18n.language).toBe("zh-CN");
  });

  it("rejects unsupported stored values", () => {
    expect(isSupportedLocale("fr-FR")).toBe(false);
    storage.setItem(LOCALE_STORAGE_KEY, "fr-FR");
    expect(readStoredLocale()).toBe("zh-CN");
  });

  it("keeps zh-CN and en-US key sets identical for every namespace", () => {
    for (const namespace of NAMESPACES) {
      const zh = collectKeys(
        (resources["zh-CN"] as Record<string, unknown>)[namespace],
      ).sort();
      const en = collectKeys(
        (resources["en-US"] as Record<string, unknown>)[namespace],
      ).sort();
      expect(en, `namespace ${namespace}`).toEqual(zh);
    }
  });

  it("never contains empty translations or leaked raw keys", () => {
    const leakedKey = new RegExp(`^(${NAMESPACES.join("|")})\\.[a-zA-Z0-9_.]+$`);
    for (const locale of ["zh-CN", "en-US"] as const) {
      for (const namespace of NAMESPACES) {
        const walk = (value: unknown, path: string): void => {
          if (typeof value === "string") {
            expect(value.trim(), `${locale}/${namespace}/${path}`).not.toBe("");
            // A value that is itself a namespaced key means a missing
            // translation leaked through i18next.
            expect(value, `${locale}/${namespace}/${path}`).not.toMatch(leakedKey);
            return;
          }
          if (typeof value !== "object" || value === null) return;
          for (const [key, child] of Object.entries(
            value as Record<string, unknown>,
          )) {
            walk(child, path ? `${path}.${key}` : key);
          }
        };
        walk((resources[locale] as Record<string, unknown>)[namespace], "");
      }
    }
  });

  it("keeps PWN technical identifiers untranslated", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const stack = (resources[locale] as Record<string, unknown>).panels as {
        stack: Record<string, string>;
        registers: Record<string, string>;
      };
      expect(stack.stack.title).toBeTruthy();
      const common = resources[locale].common as { changed: string };
      expect(common.changed).toBeTruthy();
    }
    // Register names and mnemonics are data, never resource values that change.
    expect(translate("panels:registers.title")).not.toContain("RIP");
    expect(
      (resources["zh-CN"].panels as { registers: { footers?: unknown } }).registers,
    ).toBeTruthy();
  });
});
