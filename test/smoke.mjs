import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Smoke test for the browser half: it registers through the DSH module loader,
 * declares both slot occupants, and turns a synthetic catalogue into the
 * numbers the strip renders — including the Session the user switched to.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const require = createRequire(path.join(pluginDir, "package.json"));

const registrations = new Map();
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

const { usageOf, viewedSession, costOf, formatSpends, formatTokens, formatMoney, isPeak, walletCurrencies } = exports.internals;

const snapshot = {
  ids: ["s-idle", "s-running"],
  byId: {
    "s-idle": { id: "s-idle", running: false, title: "idle chat" },
    "s-running": { id: "s-running", running: true, title: "working chat" },
  },
  projectionsBySession: {
    "s-idle": {
      values: {
        tokenUsage: {
          uncachedInputTokens: 10,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        modelSelection: { lastUsed: { provider: "deepseek-account", model: "deepseek-v4-pro" } },
      },
    },
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

// Without a reported Session the strip falls back to the running one.
const fallback = usageOf(snapshot, null);
if (fallback.sessionId !== "s-running") throw new Error("running session not preferred");
if (fallback.input !== 901200) throw new Error("input total mismatch: " + fallback.input);
if (fallback.output !== 345) throw new Error("output mismatch: " + fallback.output);

// Official prices are [off-peak, peak]; these instants pin each tariff.
const PEAK = new Date("2026-11-27T02:00:00Z"); // Friday, 01:00–04:00 UTC
const OFF_PEAK = new Date("2026-11-27T05:00:00Z"); // Friday, between windows
if (isPeak(PEAK) !== true) throw new Error("peak window not recognised");
if (isPeak(OFF_PEAK) !== false) throw new Error("off-peak window misread");
if (isPeak(new Date("2026-11-28T02:00:00Z")) !== false) throw new Error("Saturday read as peak");
if (isPeak(new Date("2026-11-30T09:59:00Z")) !== true) throw new Error("peak end misread");

// Peak USD: 1200 uncached × 0.3 + 900k cache × 0.006 + 345 out × 1.2.
const peakUsd = costOf(fallback, fallback.model, "USD", PEAK);
const expectedPeak = (1200 * 0.3 + 900000 * 0.006 + 345 * 1.2) / 1e6;
if (Math.abs(peakUsd.cost - expectedPeak) > 1e-9) {
  throw new Error("peak USD mismatch: " + peakUsd.cost + " vs " + expectedPeak);
}
if (peakUsd.price.peak !== true) throw new Error("peak flag missing");

// Off-peak halves every bucket: 1200 × 0.15 + 900k × 0.003 + 345 × 0.6.
const offUsd = costOf(fallback, fallback.model, "USD", OFF_PEAK);
const expectedOff = (1200 * 0.15 + 900000 * 0.003 + 345 * 0.6) / 1e6;
if (Math.abs(offUsd.cost - expectedOff) > 1e-9) throw new Error("off-peak USD mismatch: " + offUsd.cost);

// Yuan has its own official list: peak 2 / 0.04 / 8, off-peak 1 / 0.02 / 4.
const peakCny = costOf(fallback, fallback.model, "CNY", PEAK);
const expectedCnyPeak = (1200 * 2 + 900000 * 0.04 + 345 * 8) / 1e6;
if (Math.abs(peakCny.cost - expectedCnyPeak) > 1e-9) throw new Error("peak CNY mismatch: " + peakCny.cost);
if (formatMoney(peakCny.cost, "CNY") !== "¥0.041") {
  throw new Error("CNY formatting mismatch: " + formatMoney(peakCny.cost, "CNY"));
}
const offCny = costOf(fallback, fallback.model, "CNY", OFF_PEAK);
const expectedCnyOff = (1200 * 1 + 900000 * 0.02 + 345 * 4) / 1e6;
if (Math.abs(offCny.cost - expectedCnyOff) > 1e-9) throw new Error("off-peak CNY mismatch: " + offCny.cost);
if (formatMoney(peakUsd.cost) !== "$0.0062") throw new Error("USD formatting mismatch");

// A wallet that holds both currencies shows the spend in both, wallet order first.
const wallets = {
  status: "ready",
  value: [{ currency: "USD", balance: "7.82" }, { currency: "CNY", balance: "9.02" }],
  bonusWallets: [{ currency: "USD", balance: "0.00" }],
};
const currencies = walletCurrencies(wallets);
if (currencies.join(",") !== "USD,CNY") throw new Error("wallet currencies wrong: " + currencies.join(","));
const spends = currencies.map((code) => costOf(fallback, fallback.model, code, PEAK));
const spendText = formatSpends(spends);
if (spendText !== "$0.0062 / ¥0.041") throw new Error("multi-currency spend wrong: " + spendText);

// The Session the Conversation shows wins over the running one.
const shown = usageOf(snapshot, "s-idle");
if (shown.sessionId !== "s-idle") throw new Error("shown session not preferred: " + shown.sessionId);
if (shown.input !== 10 || shown.output !== 2) throw new Error("shown session numbers wrong");
if (shown.model !== "deepseek-v4-pro") throw new Error("shown session model wrong");

// An uncatalogued Session whose projections are already known still answers.
const uncatalogued = usageOf({ ids: [], byId: {}, projectionsBySession: snapshot.projectionsBySession }, "s-idle");
if (uncatalogued === null || uncatalogued.sessionId !== "s-idle") throw new Error("uncatalogued session lost");

// The reporter store publishes and releases identity-safely.
let notified = 0;
const stop = viewedSession.subscribe(() => {
  notified += 1;
});
viewedSession.report("s-idle");
if (viewedSession.get() !== "s-idle" || notified !== 1) throw new Error("report did not publish");
viewedSession.release("s-running");
if (viewedSession.get() !== "s-idle") throw new Error("foreign release cleared the view");
viewedSession.release("s-idle");
if (viewedSession.get() !== null || notified !== 2) throw new Error("release did not publish");
stop();

if (usageOf({ ids: [], byId: {} }, null) !== null) throw new Error("empty catalogue must yield null");
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
      registrations.set(definition.name, definition);
      return () => {};
    },
  },
};

await exports.apply(ctx);

const strip = registrations.get("shell.bottom");
const reporter = registrations.get("conversation.session.header.actions");
if (strip === undefined) throw new Error("strip not registered");
if (strip.id !== "balance-strip") throw new Error("wrong slot id: " + strip.id);
if (reporter === undefined) throw new Error("session reporter not registered");
if (reporter.id !== "balance-strip-session") throw new Error("wrong reporter id: " + reporter.id);
if (typeof exports.SessionReporter !== "function") throw new Error("reporter component missing");

const props = strip.inject();
const balance = await props.readBalance();
if (balance.value[0].balance !== "42.17") throw new Error("balance read failed");

viewedSession.report("s-idle");
const live = props.readUsage();
if (live.sessionId !== "s-idle") throw new Error("readUsage ignored the shown session");

let fired = 0;
const unsubscribe = props.subscribeUsage(() => {
  fired += 1;
});
viewedSession.report("s-running");
unsubscribe();
if (fired === 0) throw new Error("strip not notified by a session switch");

console.log(
  "ok: " + fallback.input + " in, peak " + spendText + ", off-peak " +
    formatMoney(offUsd.cost) + " / " + formatMoney(offCny.cost, "CNY"),
);
