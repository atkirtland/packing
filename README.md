# Possessions inventory

A LighterPack-style Obsidian DataviewJS view with quantities, weights, hierarchical tags, event-dependent locations, photos, filters and preparation reminders.

## Files

- `packinglist.csv` is the only inventory: item details, quantities, ownership, care notes and review questions.
- `events.json` defines setup inheritance and preparation reminders; it is not another item catalog.
- `packinglist.md`, `view.js` and `view.css` display the inventory. This README and `tests/` document and check the view.

## Open the view

Enable Dataview's **Enable JavaScript Queries** setting. Open `packinglist.md`, which uses:

```dataviewjs
await dv.view("bin/packing", {
  csv: "bin/packing/packinglist.csv",
  events: "bin/packing/events.json",
  event: "current"
});
```

Paths are relative to the vault root. Keep `view.js` and `view.css` together. Click **Refresh CSV** after editing data or setup configuration. Filters and sorting are temporary; the view does not edit files.

The data files can live anywhere inside the vault, independently of the view and each other. Move them to your chosen folders and change `csv` and `events` in `packinglist.md`, for example:

```dataviewjs
await dv.view("bin/packing", {
  csv: "Private/Inventory/packinglist.csv",
  events: "Private/Travel/events.json",
  event: "current"
});
```

If `events` is omitted, the view looks for `events.json` beside the CSV. Set `events: false` to disable configuration loading. Paths outside the vault are not supported.

The `.gitignore` excludes files named `packinglist.csv` and `events.json` anywhere in this repository. Keep these files locally; they are not required to publish the reusable view. If you give your private files other names inside this repository, add their paths to `.gitignore` too. Keep personal notes such as `remaining.md` excluded locally through `.git/info/exclude`. Review the files staged for your first commit with `git diff --cached` before publishing.

## CSV columns

All fields are optional. Quote CSV fields containing commas, quotation marks or newlines; double embedded quotation marks.

| Column | Meaning |
| --- | --- |
| `name` | Item or counting-unit name. |
| `description`, `brand` | Model, capacity or other details. |
| `weight` | Per-unit weight: g, kg, oz or lb; bare numbers default to grams. |
| `quantity` | Nonnegative count, default 1. A pair or bundle can be one unit; document that in the name or notes. |
| `tags` | Tags separated by semicolons; JSON arrays also work. |
| `status` | Defaults to owned. Other values such as wishlist or uncertain can be filtered. |
| `link`, `photo` | HTTP(S) or Obsidian vault references. |
| `notes` | Care instructions, uncertainty and other item details. |

Missing weights remain unknown. Capacities, dosages and package sizes are not object weights. Container rows count only the container's own weight; contents have separate rows. Split quantities into rows only for distinct physical stock, never duplicate the same possession for different setups.

## Tags

Store the most specific path. Parents are inferred for filtering: `group/clothing/socks` already belongs to `group/clothing`. Tags are case-sensitive; lowercase hyphenated paths are recommended.

- `group/<classification>/...`: usually one or two meaningful classifications. Storage bags and suitcase names belong in event locations, not duplicate group tags.
- `event/<setup>/<place>/<subplace>/...`: membership and location for that setup.
- `event/<setup>`: membership with no specified location.
- `omit/<setup>`: exclude the row from that setup and descendants.
- `consumable`: an item used up and replenished.
- `old`: no longer owned. Visible greyed out in **Owned + old**, excluded from all totals. `status=old` also works.

Add tag filters repeatedly to intersect branches. Tag filters use stored tags; choose the **Event** selector for inherited membership. Grouping by a tag branch drills into its next segment and counts overlapping memberships once.

A storage container's own tags do not automatically apply to its contents. Every item needs its own location path. Separate root setups also need explicit membership; merely sharing a location does not imply inclusion.

## Setup inheritance and instructions

`events.json` contains objects keyed by setup name:

```json
{
  "base-setup": {
    "instructions": ["Charge devices before leaving."]
  },
  "winter-setup": {
    "extends": "base-setup",
    "notes": "Check the forecast."
  }
}
```

Each setup has at most one parent. A row inherits its nearest ancestor's membership and location unless the child explicitly includes, moves or excludes it:

- Child `event/...` tags replace inherited locations.
- Child membership without a location clears the inherited location.
- `omit/<setup>` excludes the item; a descendant can explicitly re-include it.
- If the same setup includes and omits an item, omission wins and a warning appears.
- An explicit child inclusion identical to its inherited arrangement is redundant and should be removed.

Inheritance applies only between configured setups, not to physical containment. Named setups handle conditions such as winter or luxurious travel; there is no conditional expression engine or per-event quantity override.

Instructions and notes appear above the inventory and inherit from parent to child. Keep preparation reminders here; keep actual item descriptions and care instructions in the CSV. Invalid inheritance warns and disables configuration for that load; explicit CSV membership remains usable.

## Options and checks

The wrapper can also set `title`, `unit` (g, kg, oz, lb), `defaultWeightUnit`, `photos`, `tags` (initial AND filters), `groupByTag`, `status`, and `events` (alternate vault-relative config path, or false to disable it).

With Node installed, run `node tests/view.test.mjs` and `node tests/import.test.mjs`. Tests exercise the actual view with a small DOM substitute. Import checks use fictional data in `tests/fixtures/`; neither suite reads your personal inventory. Both suites and their fixtures can be published.
