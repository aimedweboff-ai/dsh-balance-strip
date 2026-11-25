window.__ModuleLoader__.load({
	id: "dsh-balance-strip",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const { useCallback, useEffect, useRef, useState } = React;
		const h = React.createElement;

		/** Refresh cadence of the account wallet while the page stays open. */
		const POLL_MS = 60 * 1000;
		/** How often the "N min ago" label is recomputed. */
		const CLOCK_MS = 15 * 1000;
		/** Client identity reported with every account read; must be non-empty. */
		const CLIENT_VERSION = "0.2.0";
		/** Wallet currencies the Platform returns. */
		const SYMBOLS = { CNY: "¥", USD: "$" };
		/**
		 * Published model prices in USD per 1M tokens, mirrored from the model
		 * catalog this build ships (@earendil-works/pi-ai providers/data).
		 * Edit here when DeepSeek changes prices or a new model is added.
		 */
		const PRICES = {
			"deepseek-flash": { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
			"deepseek-v4-pro": { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
		};
		/** Model whose prices an unknown route falls back to. */
		const FALLBACK_MODEL = "deepseek-flash";

		const COPY = {
			ru: {
				balance: "Баланс",
				bonus: "бонус",
				refresh: "Обновить баланс и расход сессии",
				justNow: "только что",
				minAgo: (n) => n + " мин назад",
				hourAgo: (n) => n + " ч назад",
				stale: "нет связи",
				in: "входящие",
				out: "исходящие",
				cached: "из кэша",
				cost: "стоимость",
				model: "модель",
				session: "сессия",
				estimate: "оценка по прайсу DeepSeek, USD за 1M токенов",
			},
			en: {
				balance: "Balance",
				bonus: "bonus",
				refresh: "Refresh balance and session spend",
				justNow: "just now",
				minAgo: (n) => n + " min ago",
				hourAgo: (n) => n + " h ago",
				stale: "offline",
				in: "input",
				out: "output",
				cached: "cached",
				cost: "cost",
				model: "model",
				session: "session",
				estimate: "estimated from DeepSeek list prices, USD per 1M tokens",
			},
			zh: {
				balance: "余额",
				bonus: "赠送",
				refresh: "刷新余额与会话花费",
				justNow: "刚刚",
				minAgo: (n) => n + " 分钟前",
				hourAgo: (n) => n + " 小时前",
				stale: "离线",
				in: "输入",
				out: "输出",
				cached: "缓存",
				cost: "花费",
				model: "模型",
				session: "会话",
				estimate: "按 DeepSeek 价目估算，美元 / 百万 token",
			},
		};

		/**
		 * Copy for one interface language, falling back to English.
		 * @param {string} language - active interface language code.
		 * @returns {object} localized strings.
		 */
		function copyOf(language) {
			const base = String(language || "en").toLowerCase().split(/[-_]/)[0];
			return COPY[base] ?? COPY.en;
		}

		/**
		 * Render one Platform wallet amount with its currency mark.
		 * @param {{ currency: string, balance: string }} wallet - raw wallet.
		 * @returns {string} display amount, e.g. `¥42.17`.
		 */
		function formatWallet(wallet) {
			const symbol = SYMBOLS[wallet.currency] ?? wallet.currency + " ";
			const value = Number(wallet.balance);
			if (!Number.isFinite(value)) return symbol + String(wallet.balance);
			if (value === 0) return symbol + "0.00";
			if (Math.abs(value) < 0.01) return symbol + "<0.01";
			return symbol + value.toFixed(2);
		}

		/**
		 * Join every wallet of one currency list into one display string.
		 * @param {Array<{ currency: string, balance: string }>} wallets - wallet list.
		 * @returns {string} amounts separated by commas, empty when none.
		 */
		function formatWallets(wallets) {
			if (!Array.isArray(wallets) || wallets.length === 0) return "";
			return wallets.map(formatWallet).join(" · ");
		}

		/**
		 * Compact token count for a one-line strip.
		 * @param {number} value - raw token count.
		 * @returns {string} `345`, `1.2k`, `1.23M`.
		 */
		function formatTokens(value) {
			const n = Number(value);
			if (!Number.isFinite(n) || n <= 0) return "0";
			if (n < 1000) return String(Math.round(n));
			if (n < 1e6) {
				const thousands = n / 1000;
				return (thousands < 10 ? thousands.toFixed(1) : String(Math.round(thousands))) + "k";
			}
			return (n / 1e6).toFixed(2) + "M";
		}

		/**
		 * Approximate USD cost of one session's provider-reported usage.
		 * @param {{ uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number }} usage - token totals.
		 * @param {string} model - model id, empty when unknown.
		 * @returns {{ cost: number|null, model: string, price: object|null }} cost and the price row used.
		 */
		function costOf(usage, model) {
			const price = PRICES[model] ?? PRICES[FALLBACK_MODEL] ?? null;
			if (price === null || usage === undefined || usage === null) return { cost: null, model, price };
			const input = (usage.uncachedInputTokens ?? 0) * price.input;
			const cacheRead = (usage.cacheReadTokens ?? 0) * price.cacheRead;
			const cacheWrite = (usage.cacheWriteTokens ?? 0) * price.cacheWrite;
			const output = (usage.outputTokens ?? 0) * price.output;
			return { cost: (input + cacheRead + cacheWrite + output) / 1e6, model, price };
		}

		/**
		 * Money formatting: four decimals below a cent, two from a dollar up.
		 * @param {number} value - USD amount.
		 * @returns {string} `$0.0021`.
		 */
		function formatMoney(value) {
			if (!Number.isFinite(value)) return "";
			if (value === 0) return "$0";
			if (value < 0.01) return "$" + value.toFixed(4);
			if (value < 1) return "$" + value.toFixed(3);
			return "$" + value.toFixed(2);
		}

		/**
		 * Relative age of the last successful wallet read.
		 * @param {number} at - epoch milliseconds.
		 * @param {number} now - epoch milliseconds.
		 * @param {object} copy - localized strings.
		 * @returns {string} human age label.
		 */
		function ageLabel(at, now, copy) {
			const seconds = Math.max(0, Math.round((now - at) / 1000));
			if (seconds < 45) return copy.justNow;
			const minutes = Math.round(seconds / 60);
			if (minutes < 60) return copy.minAgo(minutes);
			return copy.hourAgo(Math.round(minutes / 60));
		}

		/**
		 * Pick the session the strip reports on: the running one, else the most
		 * recently active row of the catalogue.
		 * @param {object} snapshot - ClientSessions list snapshot.
		 * @returns {{ id: string, title: string, values: object }|null} chosen row.
		 */
		function activeSessionOf(snapshot) {
			if (!snapshot || !Array.isArray(snapshot.ids) || snapshot.ids.length === 0) return null;
			const byId = snapshot.byId ?? {};
			let chosen = null;
			for (const id of snapshot.ids) {
				const row = byId[id];
				if (row !== undefined && row.running === true) {
					chosen = row;
					break;
				}
			}
			if (chosen === null) chosen = byId[snapshot.ids[0]] ?? null;
			if (chosen === null) return null;
			const projected = snapshot.projectionsBySession?.[chosen.id]?.values;
			const values = projected ?? chosen.projectionValues ?? {};
			return { id: chosen.id, title: chosen.title ?? chosen.displayTitle ?? "", values };
		}

		/**
		 * Session spend and tokens from one list snapshot.
		 * @param {object} snapshot - ClientSessions list snapshot.
		 * @returns {object|null} usage view, null when the session reports none.
		 */
		function usageOf(snapshot) {
			const session = activeSessionOf(snapshot);
			if (session === null) return null;
			const usage = session.values.tokenUsage;
			if (usage === undefined || usage === null) return null;
			const model = session.values.modelSelection?.lastUsed?.model
				?? session.values.modelSelection?.next?.model
				?? "";
			const input = (usage.uncachedInputTokens ?? 0)
				+ (usage.cacheReadTokens ?? 0)
				+ (usage.cacheWriteTokens ?? 0);
			const output = usage.outputTokens ?? 0;
			const { cost, price } = costOf(usage, model);
			return {
				sessionId: session.id,
				title: session.title,
				model,
				price,
				input,
				output,
				uncachedInput: usage.uncachedInputTokens ?? 0,
				cachedInput: usage.cacheReadTokens ?? 0,
				cacheWrite: usage.cacheWriteTokens ?? 0,
				cost,
			};
		}

		const BAR_STYLE = {
			insetInline: 0,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			gap: "8px",
			boxSizing: "border-box",
			minHeight: "26px",
			padding: "0 12px",
			borderTop: "0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25))",
			color: "var(--dsw-alias-label-tertiary, #8a8a8a)",
			font: "inherit",
			fontSize: "12px",
			lineHeight: "18px",
			userSelect: "none",
			cursor: "pointer",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis",
		};

		const STRONG_STYLE = {
			color: "var(--dsw-alias-label-primary, #111)",
			fontVariantNumeric: "tabular-nums",
			fontWeight: 500,
		};

		const WARN_STYLE = { color: "var(--dsw-alias-label-warning, #b26a00)" };

		/**
		 * Bottom-strip chip: account wallet, session tokens, and estimated
		 * session spend. The wallet refreshes on a timer or a click; session
		 * usage follows the live projection feed.
		 * @param {object} props - slot props supplied by `inject`.
		 * @returns {object|null} the strip, or null while nothing is known.
		 */
		function BalanceStrip(props) {
			const copy = props.copy;
			const readBalance = props.readBalance;
			const readUsage = props.readUsage;
			const subscribeUsage = props.subscribeUsage;
			const [wallet, setWallet] = useState({ status: "loading" });
			const [usage, setUsage] = useState(null);
			const [attempt, setAttempt] = useState(0);
			const [clock, setClock] = useState(() => Date.now());
			const mounted = useRef(true);

			useEffect(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);

			useEffect(() => {
				let cancelled = false;
				const run = async () => {
					try {
						const value = await readBalance();
						if (cancelled || !mounted.current) return;
						if (value && value.status === "ready") {
							setWallet({
								status: "ready",
								at: Date.now(),
								wallets: formatWallets(value.value),
								bonus: formatWallets(value.bonusWallets),
							});
							return;
						}
						setWallet((previous) =>
							previous.status === "ready" || previous.status === "stale"
								? { ...previous, status: "stale" }
								: { status: "unavailable" },
						);
					} catch {
						if (cancelled || !mounted.current) return;
						setWallet((previous) =>
							previous.status === "ready" || previous.status === "stale"
								? { ...previous, status: "stale" }
								: { status: "unavailable" },
						);
					}
				};
				void run();
				const timer = setInterval(() => void run(), POLL_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [readBalance, attempt]);

			useEffect(() => {
				const update = () => setUsage(readUsage());
				update();
				return subscribeUsage(update);
			}, [readUsage, subscribeUsage, attempt]);

			useEffect(() => {
				const timer = setInterval(() => setClock(Date.now()), CLOCK_MS);
				return () => clearInterval(timer);
			}, []);

			const refresh = useCallback(() => {
				setClock(Date.now());
				setAttempt((value) => value + 1);
			}, []);

			const hasWallet = wallet.status === "ready" || wallet.status === "stale";
			if (!hasWallet && usage === null) return null;

			const children = [];
			if (usage !== null) {
				children.push(
					h("span", { key: "in" }, "↑ "),
					h("span", { key: "in-value", style: STRONG_STYLE }, formatTokens(usage.input)),
					h("span", { key: "out" }, "↓ "),
					h("span", { key: "out-value", style: STRONG_STYLE }, formatTokens(usage.output)),
				);
				if (usage.cost !== null) {
					children.push(h("span", { key: "cost" }, "· "));
					children.push(
						h("span", { key: "cost-value", style: STRONG_STYLE }, "≈" + formatMoney(usage.cost)),
					);
				}
				children.push(h("span", { key: "sep" }, "·"));
			}
			if (hasWallet) {
				children.push(h("span", { key: "balance" }, copy.balance + " "));
				children.push(
					h(
						"span",
						{ key: "amount", style: STRONG_STYLE },
						wallet.wallets === "" ? "—" : wallet.wallets,
					),
				);
				if (wallet.bonus !== "") {
					children.push(
						h("span", { key: "bonus-label" }, "· " + copy.bonus + " "),
						h("span", { key: "bonus", style: STRONG_STYLE }, wallet.bonus),
					);
				}
				children.push(h("span", { key: "age" }, "· " + ageLabel(wallet.at, clock, copy)));
				if (wallet.status === "stale") {
					children.push(h("span", { key: "stale", style: WARN_STYLE }, "· " + copy.stale));
				}
			}
			children.push(h("span", { key: "refresh", style: { opacity: 0.7 } }, "↻"));

			return h(
				"div",
				{
					style: BAR_STYLE,
					role: "status",
					title: tooltipOf(usage, wallet, copy),
					onClick: refresh,
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							refresh();
						}
					},
					tabIndex: 0,
				},
				children,
			);
		}

		/**
		 * Hover text: exact counts, cache split, model, and the price basis.
		 * @param {object|null} usage - session usage view.
		 * @param {object} wallet - wallet state.
		 * @param {object} copy - localized strings.
		 * @returns {string} multi-line tooltip.
		 */
		function tooltipOf(usage, wallet, copy) {
			const lines = [];
			if (usage !== null) {
				lines.push(copy.session + ": " + (usage.title === "" ? usage.sessionId : usage.title));
				lines.push(
					copy.in + ": " + usage.uncachedInput + " (" + copy.cached + " " + usage.cachedInput + ")",
				);
				lines.push(copy.out + ": " + usage.output);
				if (usage.cost !== null) {
					const model = usage.model === "" ? FALLBACK_MODEL : usage.model;
					lines.push(copy.cost + ": ≈" + formatMoney(usage.cost) + " · " + copy.model + " " + model);
					lines.push(copy.estimate);
				}
			}
			if (wallet.status === "ready" || wallet.status === "stale") {
				lines.push(copy.balance + ": " + (wallet.wallets === "" ? "—" : wallet.wallets));
				if (wallet.bonus !== "") lines.push(copy.bonus + ": " + wallet.bonus);
			}
			lines.push(copy.refresh);
			return lines.join("\n");
		}

		/** Client services this browser half waits for. */
		const inject = ["slots", "locale", "remote", "remote.account", "sessions"];

		/**
		 * Register the strip in the frame's full-width bottom slot.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const readBalance = async () => {
				const account = ctx.remote.account;
				if (account === undefined || typeof account.getBalance !== "function") return null;
				const result = await account.getBalance({
					version: CLIENT_VERSION,
					locale: copyLanguage(ctx),
					timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
				});
				if (!result.ok) throw new Error(result.error?.code ?? "account balance failed");
				return result.value;
			};
			const listOf = () => {
				try {
					return ctx.sessions?.list ?? null;
				} catch {
					return null;
				}
			};
			const readUsage = () => {
				const list = listOf();
				if (list === null || typeof list.getSnapshot !== "function") return null;
				try {
					return usageOf(list.getSnapshot());
				} catch {
					return null;
				}
			};
			const subscribeUsage = (listener) => {
				const list = listOf();
				if (list === null || typeof list.subscribe !== "function") return () => {};
				const unsubscribe = list.subscribe(listener);
				return typeof unsubscribe === "function" ? unsubscribe : () => {};
			};
			ctx.slots.inject("shell.bottom", () =>
				ctx.slots.register(
					{
						name: "shell.bottom",
						id: "balance-strip",
						order: 10,
						inject: () => ({
							copy: copyOf(copyLanguage(ctx)),
							readBalance,
							readUsage,
							subscribeUsage,
						}),
					},
					BalanceStrip,
				),
			);
		}

		/**
		 * Active interface language sampled at call time.
		 * @param ctx - client root context.
		 * @returns {string} language code, `en` when unavailable.
		 */
		function copyLanguage(ctx) {
			try {
				return ctx.locale.getSnapshot().active ?? "en";
			} catch {
				return "en";
			}
		}

		exports.BalanceStrip = BalanceStrip;
		exports.apply = apply;
		exports.inject = inject;
		/** Pure helpers, exposed for the plugin's own smoke test. */
		exports.internals = { activeSessionOf, costOf, formatMoney, formatTokens, formatWallets, usageOf };
		return module.exports;
	},
});
