# dsh-balance-strip

A one-line status bar for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI: **account balance, session token counters, and an estimate of what the session has cost so far** — always visible instead of buried in Settings.

![Rendered mock-up of the strip in the dark and light themes](docs/preview.png)

```text
↑ 901k  ↓ 345   ≈$0.0062   ·   Balance ¥42.17   ·   bonus ¥5.00   ·   2 min ago
```

The strip occupies the frame's `shell.bottom` slot — the full-width band underneath the sidebar, conversation, and right panel — so it never covers content and disappears entirely when it has nothing to report.

## What it shows

| Segment | Meaning | Source |
|---|---|---|
| `↑ 901k` | Input tokens of the current session: uncached + cache-read + cache-write | `tokenUsage` session projection |
| `↓ 345` | Output tokens of the current session | `tokenUsage` projection |
| `≈$0.0062` | Estimated spend of the session at list prices | token counts × the model's published price |
| `Balance ¥42.17` | Wallet funds | `account/getBalance` Remote method, polled once a minute |
| `bonus ¥5.00` | Bonus credit, shown only when the wallet has any | same read |
| `2 min ago` | Age of the last successful wallet read | local clock |
| `↻` | Hint that the strip is clickable | — |

Hovering shows the exact numbers, the cache split (`cached 900000`), the model the price came from, and the price basis. Clicking refreshes immediately.

Session counters follow the live projection feed, so they move while the agent works. The wallet is polled once per minute — the Platform returns a snapshot, not a stream.

## Which session

The strip reports on the session the Conversation is showing: switching sessions in the sidebar switches the counters with it. A zero-render occupant of `conversation.session.header.actions` publishes the shown Session id, because the bottom slot itself sits outside the Session scope. When no Session is shown (blank home), the strip falls back to the running session, then to the most recent catalogue row.

## Requirements

- A DeepSeek Harness build with the Web GUI (`dsh web`, or the desktop application). Written and tested against the `0.2.1-rc.5` desktop build.
- The `shell.bottom` slot, `remote.account`, and the `tokenUsage` / `modelSelection` session projections, all of which ship with the standard web composition.
- A signed-in DeepSeek Platform account for the balance part. Token counters and cost work for any provider that reports usage.

## Installation

The plugin is not published on npm; installation is a directory copy plus one Loader row.

### From the DSH plugin market

The plugin is listed in its own market index:

```text
https://raw.githubusercontent.com/aimedweboff-ai/dsh-balance-strip/main/market/index.json
```

In DSH open **Plugins → Discover**, add that URL through **Add index source** (or the market menu's **Manage index sources…**), pick the *aimedweboff-ai plugins* market, and press **Install** on the Balance strip card. Discover needs the `plugin-market` and `ui-plugin-market` rows, which ship with DSH but stay out of the default profile; [`market/README.md`](market/README.md) shows the two-row insert that enables them.

### 1. Copy the package into your profile

```powershell
# Windows (PowerShell)
git clone https://github.com/aimedweboff-ai/dsh-balance-strip.git $env:TEMP\dsh-balance-strip
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item -Recurse -Force "$env:TEMP\dsh-balance-strip" "$profile\node_modules\dsh-balance-strip"
```

```bash
# macOS / Linux
git clone https://github.com/aimedweboff-ai/dsh-balance-strip.git /tmp/dsh-balance-strip
cp -R /tmp/dsh-balance-strip ~/.dsh/profiles/desktop/node_modules/dsh-balance-strip
```

If your profile lives elsewhere, use that path instead — `DSH_HOME` points at the directory that contains `profiles/`.

### 2. Mount the bundle

The package ships [`cordis.patch.yml`](cordis.patch.yml), so installing it as a bundle registers its Loader row by itself: **Plugins → Add plugin** with the directory, or `plugin_manager` `install_bundle` with the absolute package directory. Nothing else to edit.

A directory copy that was not installed as a bundle needs the row appended to `~/.dsh/profiles/desktop/cordis.patch.yml` (create the file with `[]` when it does not exist), which is exactly what the shipped patch contains:

```yaml
- insert:
    - id: balance-strip
      name: dsh-balance-strip
```

### 3. Restart DeepSeek Harness

Client bundles are read at startup, so a full restart of the application is required — reloading the page is not enough.

### Verify

After the restart the strip appears above the bottom edge of the window once the account is signed in or a session reports usage. If it does not, open **Settings → Plugins** and look for a `dsh-balance-strip` row reporting a load failure; the console also names the missing bundle.

## Update

```powershell
git -C $env:TEMP\dsh-balance-strip pull
Copy-Item -Recurse -Force "$env:TEMP\dsh-balance-strip\*" "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-balance-strip"
```

Restart afterwards. The `cordis.patch.yml` entry stays as it is.

## Uninstall

Delete `node_modules/dsh-balance-strip` from the profile, remove the `balance-strip` insert from `cordis.patch.yml`, restart.

## Pricing

The cost figure is an estimate from a price table in [`lib/client.js`](lib/client.js), mirrored from the model catalogue shipped inside DSH (`@earendil-works/pi-ai`), in **USD per 1M tokens**:

| Model | input | cacheRead | cacheWrite | output |
|---|---|---|---|---|
| `deepseek-flash` | 0.30 | 0.006 | 0 | 1.20 |
| `deepseek-v4-pro` | 1.32 | 0.044 | 0 | 3.96 |

```text
cost = (uncachedInput × input + cacheRead × cacheRead
        + cacheWrite × cacheWrite + output × output) / 1 000 000
```

An unknown model falls back to `deepseek-flash`. The table is intentionally a few lines of code rather than a settings page: change it in place and restart when DeepSeek changes prices. Model ids come from the session's `modelSelection` projection, so switching models mid-session reprices the whole session total — the number is a running estimate, not an invoice.

## How it works

The package has two halves, in the usual DSH shape:

- `lib/index.js` — the host half: a no-op `apply()` so the package shows up as an ordinary Loader row.
- `lib/client.js` — the browser half: declares `dsh.client` in `package.json`, registers one component into the `shell.bottom` slot, and waits for the `slots`, `locale`, `remote.account`, and `sessions` services.

```js
ctx.slots.inject("shell.bottom", () => ctx.slots.register({
  name: "shell.bottom",
  id: "balance-strip",
  order: 10,
  inject: () => ({ copy, readBalance, readUsage, subscribeUsage }),
}, BalanceStrip));
```

Balance comes from `ctx.remote.account.getBalance()` — the same Remote method the Account settings page uses, with the required client metadata (build version, active language, UTC offset). Usage comes from `ctx.sessions.list`: the strip picks the active session, reads its `tokenUsage` projection, and subscribes to the store for live updates. Money is derived locally, so no extra host API is needed.

Copy exists in English, Russian, and Chinese and follows the interface language.

## Limitations

- Cost is an estimate at list prices, not the amount DeepSeek billed. Wallet movements and bonus grants remain authoritative in **Settings → Account**.
- Input tokens include cache reads, so the input figure looks large; cache reads are much cheaper than fresh input, which is why the split is in the tooltip.
- Usage comes from provider reports. A provider that reports none leaves the counters at zero.
- The wallet needs a signed-in Platform account; with a third-party API key the strip shows tokens and cost only.
- The plugin creates no sessions, sends no model requests, and stores nothing.

## Development

```bash
npm test        # node test/smoke.mjs
```

The smoke test loads the bundle through a stub module loader, checks the slot registration, and folds one synthetic session snapshot into the strip's numbers, including the cost arithmetic.

`make-preview.py` regenerates `docs/preview.png` with Pillow.

## License

MIT © 2026 aimedweboff-ai

---

Русская версия: [README.ru.md](README.ru.md)
