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
		const CLIENT_VERSION = "0.2.4";
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
		/**
		 * The shipped catalog quotes USD, while the Chinese platform bills in
		 * yuan. A model with no CNY row below derives one at this rate; add an
		 * exact CNY list price here when it differs from the converted one.
		 */
		const USD_TO_CNY = 7.2;
		/** Exact yuan list prices per 1M tokens; an entry replaces the conversion. */
		const PRICES_CNY = {};
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
				estimate: "оценка по прайсу DeepSeek, {currency} за 1M токенов",
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
				estimate: "estimated from DeepSeek list prices, {currency} per 1M tokens",
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
				estimate: "按 DeepSeek 价目估算，{currency} / 百万 token",
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
		 * Distinct currencies the account holds, in wallet order.
		 * @param {object|null} value - account balance payload.
		 * @returns {string[]} currency codes, empty when the payload carries none.
		 */
		function walletCurrencies(value) {
			const currencies = [];
			const wallets = [...(value?.value ?? []), ...(value?.bonusWallets ?? [])];
			for (const wallet of wallets) {
				const currency = wallet?.currency;
				if (typeof currency === "string" && currency !== "" && !currencies.includes(currency)) {
					currencies.push(currency);
				}
			}
			return currencies;
		}

		/**
		 * Join one spend per currency into a single label.
		 * @param {Array<{ cost: number|null, currency: string }>} spends - computed spends.
		 * @returns {string} `$0.768 / ¥5.53`, empty when nothing is priced.
		 */
		function formatSpends(spends) {
			return spends
				.filter((spend) => spend.cost !== null)
				.map((spend) => formatMoney(spend.cost, spend.currency))
				.join(" / ");
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
		 * Price row of one model in the currency the wallet uses.
		 * @param {string} model - model id, empty when unknown.
		 * @param {string} currency - `USD` or `CNY`.
		 * @returns {object|null} per-1M-token prices, null when no model is priced.
		 */
		function priceOf(model, currency) {
			const usd = PRICES[model] ?? PRICES[FALLBACK_MODEL] ?? null;
			if (usd === null) return null;
			if (currency !== "CNY") return usd;
			return PRICES_CNY[model] ?? PRICES_CNY[FALLBACK_MODEL] ?? {
				input: usd.input * USD_TO_CNY,
				output: usd.output * USD_TO_CNY,
				cacheRead: usd.cacheRead * USD_TO_CNY,
				cacheWrite: usd.cacheWrite * USD_TO_CNY,
			};
		}

		/**
		 * Approximate spend of one session in the wallet's own currency.
		 * @param {{ uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number }} usage - token totals.
		 * @param {string} model - model id, empty when unknown.
		 * @param {string} currency - `USD` or `CNY`.
		 * @returns {{ cost: number|null, model: string, currency: string, price: object|null }} cost and the price row used.
		 */
		function costOf(usage, model, currency = "USD") {
			const price = priceOf(model, currency);
			if (price === null || usage === undefined || usage === null) {
				return { cost: null, model, currency, price };
			}
			const input = (usage.uncachedInputTokens ?? 0) * price.input;
			const cacheRead = (usage.cacheReadTokens ?? 0) * price.cacheRead;
			const cacheWrite = (usage.cacheWriteTokens ?? 0) * price.cacheWrite;
			const output = (usage.outputTokens ?? 0) * price.output;
			return { cost: (input + cacheRead + cacheWrite + output) / 1e6, model, currency, price };
		}

		/**
		 * Money formatting in one currency: four decimals below a cent, two from
		 * a unit up.
		 * @param {number} value - amount.
		 * @param {string} currency - `USD` or `CNY`.
		 * @returns {string} `$0.0021` or `¥0.0151`.
		 */
		function formatMoney(value, currency = "USD") {
			const symbol = SYMBOLS[currency] ?? currency + " ";
			if (!Number.isFinite(value)) return "";
			if (value === 0) return symbol + "0";
			if (value < 0.0001) return "<" + symbol + "0.0001";
			if (value < 0.01) return symbol + value.toFixed(4);
			if (value < 1) return symbol + value.toFixed(3);
			return symbol + value.toFixed(2);
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
		 * The Session the Conversation is showing right now. The strip lives in
		 * the root-scoped bottom slot and cannot see the Session scope, so a
		 * zero-render occupant of the session header reports it here.
		 */
		const viewedSession = (() => {
			let current = null;
			const listeners = new Set();
			const publish = () => {
				for (const listener of listeners) listener();
			};
			return {
				get: () => current,
				report: (id) => {
					if (id === current) return;
					current = id;
					publish();
				},
				release: (id) => {
					if (current !== id) return;
					current = null;
					publish();
				},
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			};
		})();

		/**
		 * Zero-render Session-scope occupant: it exists only to report which
		 * Session the Conversation shows, so the strip follows a switch.
		 * @param {object} props - slot props; `sessionId` names the shown Session.
		 * @returns {null} renders nothing.
		 */
		function SessionReporter(props) {
			const sessionId = props.sessionId;
			useEffect(() => {
				viewedSession.report(sessionId);
				return () => viewedSession.release(sessionId);
			}, [sessionId]);
			return null;
		}

		/**
		 * Pick the Session the strip reports on: the one the Conversation
		 * shows, else the running one, else the most recent catalogue row.
		 * @param {object} snapshot - ClientSessions list snapshot.
		 * @param {string|null} preferId - Session the Conversation is showing.
		 * @returns {{ id: string, title: string, values: object }|null} chosen row.
		 */
		function activeSessionOf(snapshot, preferId) {
			if (!snapshot) return null;
			const byId = snapshot.byId ?? {};
			if (preferId !== undefined && preferId !== null) {
				const row = byId[preferId];
				if (row !== undefined) {
					const projected = snapshot.projectionsBySession?.[preferId]?.values;
					const values = projected ?? row.projectionValues ?? {};
					return { id: preferId, title: row.title ?? row.displayTitle ?? "", values };
				}
				const onlyProjected = snapshot.projectionsBySession?.[preferId];
				if (onlyProjected !== undefined) {
					return { id: preferId, title: "", values: onlyProjected.values ?? {} };
				}
			}
			if (!Array.isArray(snapshot.ids) || snapshot.ids.length === 0) return null;
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
		 * @param {string|null} preferId - Session the Conversation is showing.
		 * @returns {object|null} usage view, null when the session reports none.
		 */
		function usageOf(snapshot, preferId) {
			const session = activeSessionOf(snapshot, preferId);
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
			return {
				sessionId: session.id,
				title: session.title,
				model,
				uncachedInputTokens: usage.uncachedInputTokens ?? 0,
				cacheReadTokens: usage.cacheReadTokens ?? 0,
				cacheWriteTokens: usage.cacheWriteTokens ?? 0,
				outputTokens: output,
				input,
				output,
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
								currencies: walletCurrencies(value),
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

			// Spend follows the currencies the account actually holds: one amount
			// per wallet currency, so a CNY+USD account sees both.
			const currencies = wallet.currencies !== undefined && wallet.currencies.length > 0
				? wallet.currencies
				: ["USD"];
			const spends = usage === null ? [] : currencies.map((code) => costOf(usage, usage.model, code));

			const children = [];
			if (usage !== null) {
				children.push(
					h("span", { key: "in" }, "↑ "),
					h("span", { key: "in-value", style: STRONG_STYLE }, formatTokens(usage.input)),
					h("span", { key: "out" }, "↓ "),
					h("span", { key: "out-value", style: STRONG_STYLE }, formatTokens(usage.output)),
				);
				if (spends.length > 0) {
					children.push(h("span", { key: "cost" }, "· "));
					children.push(
						h(
							"span",
							{ key: "cost-value", style: STRONG_STYLE },
							"≈" + formatSpends(spends),
						),
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
					title: tooltipOf(usage, spends, wallet, copy),
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
		 * Hover text: exact counts, cache split, one cost per wallet currency,
		 * and the price basis.
		 * @param {object|null} usage - session usage view.
		 * @param {Array<{ cost: number|null, currency: string }>} spends - cost per currency.
		 * @param {object} wallet - wallet state.
		 * @param {object} copy - localized strings.
		 * @returns {string} multi-line tooltip.
		 */
		function tooltipOf(usage, spends, wallet, copy) {
			const lines = [];
			if (usage !== null) {
				lines.push(copy.session + ": " + (usage.title === "" ? usage.sessionId : usage.title));
				lines.push(
					copy.in + ": " + usage.uncachedInputTokens + " (" + copy.cached + " " + usage.cacheReadTokens + ")",
				);
				lines.push(copy.out + ": " + usage.outputTokens);
				const priced = spends.filter((spend) => spend.cost !== null);
				if (priced.length > 0) {
					const model = usage.model === "" ? FALLBACK_MODEL : usage.model;
					lines.push(
						copy.cost + ": ≈" + formatSpends(priced) + " · " + copy.model + " " + model,
					);
					lines.push(
						copy.estimate.replace("{currency}", priced.map((spend) => spend.currency).join("/")),
					);
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
					return usageOf(list.getSnapshot(), viewedSession.get());
				} catch {
					return null;
				}
			};
			const subscribeUsage = (listener) => {
				const stops = [];
				const list = listOf();
				if (list !== null && typeof list.subscribe === "function") {
					const stop = list.subscribe(listener);
					if (typeof stop === "function") stops.push(stop);
				}
				stops.push(viewedSession.subscribe(listener));
				return () => {
					for (const stop of stops) stop();
				};
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
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: "balance-strip-session",
						order: 100,
					},
					SessionReporter,
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
		exports.SessionReporter = SessionReporter;
		exports.apply = apply;
		exports.inject = inject;
		/** Pure helpers, exposed for the plugin's own smoke test. */
		exports.internals = {
			activeSessionOf,
			costOf,
			formatMoney,
			formatSpends,
			formatTokens,
			formatWallets,
			priceOf,
			usageOf,
			viewedSession,
			walletCurrencies,
		};
		return module.exports;
	},
});
