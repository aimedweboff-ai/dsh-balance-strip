import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Smoke test for the browser half: it registers through the DSH module loader,
 * exposes the expected slot registration, and turns one synthetic session
 * snapshot into the numbers the strip renders.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const require = createRequire(path.join(pluginDir, "package.json"));

let registered;
let entry;

globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      entry = value;
    },
  },
};

await import("file:///" + path.join(pluginDir, "lib", "client.js").replace(/\\/g, "/"));
if (entry === undefined) throw new Error("client bundle did not register a module");
if (entry.id !== "dsh-balance-strip") throw new Error("unexpected module id: " + entry.id);

const react = {
  createElement: (...args) => ({ type: args[0], props: args[1] }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: () => ({ current: true }),
};
const exports = entry.factory((id) => {
  if (id === "react") return react;
  throw new Error("unexpected module request: " + id);
});

const { usageOf, formatTokens, formatMoney } = exports.internals;

const snapshot = {
  ids: ["s-idle", "s-running"],
  byId: {
    "s-idle": { id: "s-idle", running: false, title: "idle chat" },
    "s-running": { id: "s-running", running: true, title: "working chat" },
  },
  projectionsBySession: {
    "s-running": {
      values: {
        tokenUsage: {
          uncachedInputTokens: 1200,
          outputTokens: 345,
          cacheReadTokens: 900000,
          cacheWriteTokens: 0,
        },
        modelSelection: { lastUsed: { provider: "deepseek-account", model: "deepseek-flash" } },
      },
    },
  },
};

const usage = usageOf(snapshot);
if (usage.sessionId !== "s-running") throw new Error("running session not preferred");
if (usage.input !== 901200) throw new Error("input total mismatch: " + usage.input);
if (usage.output !== 345) throw new Error("output mismatch: " + usage.output);

const expectedCost = (1200 * 0.3 + 900000 * 0.006 + 345 * 1.2) / 1e6;
if (Math.abs(usage.cost - expectedCost) > 1e-9) {
  throw new Error("cost mismatch: " + usage.cost + " vs " + expectedCost);
}
if (usageOf({ ids: [], byId: {} }) !== null) throw new Error("empty catalogue must yield null");
if (formatTokens(999) !== "999" || formatTokens(12345) !== "12k" || formatTokens(2500000) !== "2.50M") {
  throw new Error("token formatting mismatch");
}
if (formatMoney(0.006174) !== "$0.0062") throw new Error("money formatting mismatch");

const ctx = {
  remote: {
    account: {
      getBalance: async () => ({
        ok: true,
        value: {
          status: "ready",
          value: [{ currency: "CNY", balance: "42.17" }],
          bonusWallets: [{ currency: "CNY", balance: "5" }],
        },
      }),
    },
  },
  locale: { getSnapshot: () => ({ active: "en" }) },
  sessions: {
    list: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
  },
  slots: {
    inject: (_name, callback) => callback(),
    register: (definition) => {
      registered = definition;
      return () => {};
    },
  },
};

await exports.apply(ctx);
if (registered === undefined) throw new Error("nothing registered");
if (registered.name !== "shell.bottom") throw new Error("wrong slot: " + registered.name);
if (registered.id !== "balance-strip") throw new Error("wrong slot id: " + registered.id);

const props = registered.inject();
const balance = await props.readBalance();
if (balance.value[0].balance !== "42.17") throw new Error("balance read failed");
if (props.readUsage().cost === null) throw new Error("usage read failed");
props.subscribeUsage(() => {});

console.log("ok: " + usage.input + " input, " + usage.output + " output, ≈" + formatMoney(usage.cost));
