# Plugin market index

This directory publishes the format-1 index that lists aimedweboff-ai plugins for the DeepSeek Harness plugin market.

Index URL:

```text
https://raw.githubusercontent.com/aimedweboff-ai/dsh-balance-strip/main/market/index.json
```

## Adding it to DSH

Open **Plugins → Discover**. With no source configured the tab shows **Add index source**; otherwise use the market menu and **Manage index sources…**. Paste the URL above and confirm. The market then appears as *aimedweboff-ai plugins* and lists `dsh-balance-strip`.

The same list can be seeded from the profile instead, in `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: plugin-market
      name: '@deepseek-ai/dsh-plugin-market'
      config:
        indexes:
          - https://raw.githubusercontent.com/aimedweboff-ai/dsh-balance-strip/main/market/index.json
    - id: ui-plugin-market
      name: '@deepseek-ai/dsh-client-ui-plugin-market'
```

`plugin-market` is the Host service that fetches and validates indexes; `ui-plugin-market` is the Discover tab. Both ship with DSH but stay out of the default profile, which is why the two rows are inserted here.

## Format

The document follows format 1 of the DSH plugin market index: one `plugins` entry per package, each with one or more exact SemVer versions, and every version pinned to a source — `npm` (`name@version`) or `git` (repository URL plus a 40-hex commit, optionally a package `path`). DSH validates the document with `@deepseek-ai/dsh-plugin-market-index` and builds the install spec from the pinned commit, never from a branch.

For this repository the package sits at the root, so the entry pins the commit of `dsh-balance-strip` and omits `path`:

```json
{
  "name": "dsh-balance-strip",
  "versions": [
    {
      "version": "0.2.0",
      "publishTimestamp": 1795594560,
      "source": {
        "type": "git",
        "url": "https://github.com/aimedweboff-ai/dsh-balance-strip",
        "commit": "<40-hex>"
      },
      "engines": { "dsh": ">=0.1.7-0" }
    }
  ]
}
```

## Releasing a new version

1. Bump `version` in `package.json`, commit, and tag if you like.
2. Add an entry to `versions` with that exact version, the commit that contains it, and that commit's Unix timestamp.
3. Keep older entries: DSH offers them on the entry page, and a pinned commit stays installable.

Validate before pushing — DSH refuses the whole document on the first rule violation and reports the JSON path:

```bash
node -e "import('@deepseek-ai/dsh-plugin-market-index').then(m => m.parseMarketIndex(require('./market/index.json'), 'https://raw.githubusercontent.com/aimedweboff-ai/dsh-balance-strip/main/market/index.json'))"
```

That command needs the validator installed next to the repository; inside a DSH checkout it is already present.

