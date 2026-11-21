// Reusable Obsidian DataviewJS view. Load the containing folder with dv.view().
await (async () => {
  const options = input ?? {};
  const csvPath = String(options.csv ?? "bin/packing/packinglist.csv").replace(/^\/+/, "");
  const eventsPath = options.events === false ? "" : String(options.events ?? `${csvPath.slice(0, csvPath.lastIndexOf("/") + 1)}events.json`).replace(/^\/+/, "");
  const units = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
  const palette = ["#5d9b88", "#799cc5", "#c8a465", "#af85b4", "#d18c78", "#84a86a", "#8391ba", "#b4a278"];
  const root = document.createElement("div");
  root.className = "possessions-view";
  dv.container.appendChild(root);
  const state = { search: "", category: "", tag: "", tags: parseTags(Array.isArray(options.tags) ? JSON.stringify(options.tags) : String(options.tags ?? "")),
    status: options.status === undefined ? "owned" : String(options.status).toLowerCase(),
    event: cleanTag(String(options.event ?? "")).replace(/^event\//, ""), place: "",
    group: options.groupByTag ? `tag:${cleanTag(String(options.groupByTag))}` : "event-location",
    sort: "source", unit: units[options.unit] ? options.unit : "g", photos: options.photos !== false };
  let items = [], warnings = [], loading = false, eventNotes = {}, notesError = "", setupChains = new Map();

  function el(tag, className, text, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    if (parent) parent.appendChild(node);
    return node;
  }
  function button(text, parent, handler, className = "") {
    const node = el("button", className, text, parent);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }
  function number(value) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value); }
  function weight(value) { return `${number(value / units[state.unit])} ${state.unit}`; }
  function current(rows) { return rows.filter(item => !item.old); }
  function total(rows) { return current(rows).reduce((sum, item) => sum + (item.grams ?? 0) * item.quantity, 0); }
  function count(rows) { return current(rows).reduce((sum, item) => sum + item.quantity, 0); }
  function unknown(rows) { return current(rows).filter(item => item.grams === null && item.quantity > 0).length; }
  function cleanTag(tag) { return tag.trim().replace(/^#+/, "").split("/").map(part => part.trim()).filter(Boolean).join("/"); }
  function within(tag, parent) { return tag === parent || tag.startsWith(`${parent}/`); }
  function ancestors(tag) { return tag.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/")); }
  // Child-first chain: the nearest explicit inclusion or exclusion wins.
  function arrangement(item, setup) {
    for (const name of setupChains.get(setup) ?? [setup]) {
      if (item.tags.includes(`omit/${name}`)) return null;
      const branch = `event/${name}`;
      const tags = item.tags.filter(tag => within(tag, branch));
      if (tags.length) return { source: name, paths: [...new Set(tags.filter(tag => tag.startsWith(`${branch}/`)).map(tag => tag.slice(branch.length + 1)))].sort() };
    }
    return null;
  }
  function locations(item) {
    return state.event ? arrangement(item, state.event)?.paths ?? [] : [];
  }
  function locationText(item) { return state.event ? locations(item).join(" + ") || "Location unspecified" : "Select an event"; }
  function groupKey(item) {
    if (state.group === "event-location") return state.event ? locationText(item) : "All possessions";
    if (!state.group.startsWith("tag:")) return item[state.group];
    const branch = state.group.slice(4);
    const children = [...new Set(item.tags.filter(tag => within(tag, branch)).map(tag =>
      tag === branch ? `${branch} (direct)` : tag.split("/").slice(0, branch.split("/").length + 1).join("/")))].sort();
    // A combination group keeps overlapping tags from double-counting inventory.
    return children.length ? children.join(" + ") : `No #${branch} tag`;
  }

  // Preserve strings (notably JSON tag arrays) and support quoted commas/newlines.
  function parseCSV(source) {
    source = source.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false, closed = false;
    function pushField() { row.push(field.trim()); field = ""; closed = false; }
    function pushRow() { pushField(); if (row.some(value => value !== "")) rows.push(row); row = []; }
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else field += char;
      } else if (char === ',' ) pushField();
      else if (char === '\n' || char === '\r') {
        pushRow(); if (char === '\r' && source[i + 1] === '\n') i++;
      } else if (char === '"' && field.trim() === "" && !closed) { field = ""; quoted = true; }
      else if (closed && !/\s/.test(char)) throw new Error("Unexpected text after a quoted CSV field.");
      else if (!closed) field += char;
    }
    if (quoted) throw new Error("Unclosed quoted CSV field.");
    pushRow();
    if (!rows.length) return [];
    const headers = rows.shift().map(key => key.toLowerCase().replace(/[\s-]+/g, "_"));
    if (headers.some(key => !key) || new Set(headers).size !== headers.length) throw new Error("CSV headers must be nonempty and unique.");
    return rows.map((values, index) => {
      if (values.length > headers.length) throw new Error(`CSV record ${index + 2} has too many fields. Quote fields containing commas.`);
      return Object.fromEntries(headers.map((key, i) => [key, values[i] ?? ""]));
    });
  }
  function parseTags(value) {
    if (!value) return [];
    let tags;
    if (value.startsWith("[")) {
      tags = JSON.parse(value);
      if (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string")) throw new Error("tags must be a JSON array of strings");
    } else tags = value.split(/[;,|\s]+/);
    return [...new Set(tags.map(cleanTag).filter(Boolean))];
  }
  function normalize(row, index) {
    const name = row.name || row.item || row.description || `Unnamed item ${index + 1}`;
    function warn(message) { warnings.push(`${name}: ${message}`); }
    const rawQuantity = row.quantity || row.qty;
    let quantity = rawQuantity ? Number(rawQuantity) : 1;
    if (!Number.isFinite(quantity) || quantity < 0) { warn("invalid quantity; using 1"); quantity = 1; }
    let grams = null;
    const rawWeight = row.weight || row.weight_g;
    if (rawWeight) {
      const match = rawWeight.match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(g|kg|oz|lb|lbs)?$/i);
      const unit = (match?.[2] || row.unit || row.weight_unit || options.defaultWeightUnit || "g").toLowerCase().replace(/^lbs$/, "lb");
      if (match && units[unit] && Number.isFinite(Number(match[1]) * units[unit])) grams = Number(match[1]) * units[unit];
      else warn(`invalid weight “${rawWeight}”; left unknown`);
    }
    let tags = [];
    try { tags = parseTags(row.tags); } catch (error) { warn(error.message); }
    return { name, description: row.name || row.item ? row.description : "", brand: row.brand || "", grams, quantity,
      category: row.category || "Uncategorized", tags, status: tags.includes("old") ? "old" : (row.status || "owned").toLowerCase(),
      old: tags.includes("old") || (row.status || "").toLowerCase() === "old",
      link: row.link || row.url || "", photo: row.photo || row.image || "", notes: row.notes || "", index };
  }
  function external(value) {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
  }
  function localPath(value) {
    let path = value.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    // Schemes are never treated as vault paths.
    return /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//") ? null : path;
  }
  function itemLink(parent, item) {
    const url = external(item.link);
    const path = localPath(item.link);
    if (!item.link || (!url && !path)) { el("span", "pv-name", item.name, parent); return; }
    const link = el("a", "pv-name", item.name, parent);
    if (url) { link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
    else {
      link.href = "#";
      link.addEventListener("click", event => { event.preventDefault(); dv.app.workspace.openLinkText(path, csvPath, event.ctrlKey || event.metaKey); });
    }
  }
  function photo(parent, item) {
    if (!state.photos || !item.photo) return;
    let src = external(item.photo);
    if (!src) {
      const path = localPath(item.photo);
      const file = path && dv.app.metadataCache.getFirstLinkpathDest(path, csvPath);
      if (file) src = dv.app.vault.getResourcePath(file);
    }
    if (!src) return;
    const img = el("img", "pv-photo", undefined, parent);
    img.alt = item.name;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.src = src;
    img.addEventListener("error", () => img.remove(), { once: true });
  }

  const header = el("div", "pv-header", undefined, root);
  const heading = el("div", "", undefined, header);
  el("div", "pv-eyebrow", "PERSONAL INVENTORY", heading);
  el("h2", "", options.title || "Possessions", heading);
  const refresh = button("Refresh CSV", header, () => load());
  const status = el("div", "pv-status", "", root);
  status.setAttribute("role", "status");
  const toolbar = el("div", "pv-toolbar", undefined, root);
  const searchLabel = el("label", "pv-search", "Search", toolbar);
  const search = el("input", "", undefined, searchLabel);
  search.type = "search";
  search.placeholder = "Items, brands, tags…";
  search.addEventListener("input", () => { state.search = search.value; render(); });
  function select(label, key, choices) {
    const wrapper = el("label", "", label, toolbar);
    const node = el("select", "", undefined, wrapper);
    function setChoices(values) {
      node.replaceChildren();
      for (const [value, text] of values) { const option = el("option", "", text, node); option.value = value; }
      node.value = state[key];
    }
    setChoices(choices);
    node.addEventListener("change", () => {
      if (key === "tag") {
        if (node.value && !state.tags.includes(node.value)) state.tags.push(node.value);
        node.value = "";
      } else {
        state[key] = node.value;
        if (key === "event") {
          state.place = "";
          state.group = "event-location";
          groupSelect.node.value = state.group;
          updatePlaces();
        }
      }
      render();
    });
    return { node, setChoices };
  }
  const eventSelect = select("Event", "event", [["", "All events"]]);
  const placeSelect = select("Location in event", "place", [["", "All locations"]]);
  const categoryFilter = select("Category", "category", [["", "All categories"]]);
  const tagFilter = select("Add tag filter (AND)", "tag", [["", "Choose tag…"]]);
  const statusFilter = select("Status", "status", [["", "All statuses"], ["owned", "owned"]]);
  const groupSelect = select("Group by", "group", [["event-location", "Location in event"], ["category", "Category"]]);
  select("Sort", "sort", [["source", "CSV order"], ["name", "Name"], ["weight", "Total weight ↓"], ["quantity", "Quantity ↓"]]);
  select("Weight unit", "unit", Object.keys(units).map(unit => [unit, unit]));
  const photosLabel = el("label", "pv-check", "", toolbar);
  const photos = el("input", "", undefined, photosLabel);
  photos.type = "checkbox"; photos.checked = state.photos;
  photosLabel.appendChild(document.createTextNode("Photos"));
  photos.addEventListener("change", () => { state.photos = photos.checked; render(); });
  const activeTags = el("div", "pv-active-tags", undefined, root);
  activeTags.setAttribute("aria-label", "Active tag filters");
  const instructions = el("section", "pv-instructions", undefined, root);
  const body = el("div", "pv-body", undefined, root);
  function updatePlaces() {
    const paths = [...new Set(items.flatMap(item => locations(item).flatMap(ancestors)))].sort((a, b) => a.localeCompare(b));
    if (state.place && !paths.includes(state.place)) paths.push(state.place);
    placeSelect.setChoices([["", "All locations"], ...paths.map(path => [path, path])]);
    placeSelect.node.disabled = !state.event;
  }
  function toggleTag(tag) {
    state.tags = state.tags.includes(tag) ? state.tags.filter(value => value !== tag) : [...state.tags, tag];
    render();
  }

  function render() {
    instructions.replaceChildren();
    const chain = state.event ? setupChains.get(state.event) ?? [state.event] : [];
    const notes = [...new Set([...chain].reverse().map(name => eventNotes[name]?.notes).filter(Boolean))];
    const reminders = [...new Set([...chain].reverse().flatMap(name => eventNotes[name]?.instructions ?? []))];
    if (state.event && (notes.length || reminders.length || chain.length > 1)) {
      el("h3", "", `${state.event} — instructions`, instructions);
      if (chain.length > 1) el("p", "pv-caption", `Setup chain: ${[...chain].reverse().join(" → ")}`, instructions);
      for (const text of notes) el("p", "pv-instruction-text", text, instructions);
      if (reminders.length) {
        const list = el("ul", "", undefined, instructions);
        for (const text of reminders) el("li", "pv-instruction-text", text, list);
      }
    }
    if (notesError) el("p", "pv-warnings", notesError, instructions);
    activeTags.replaceChildren();
    for (const tag of state.tags) {
      const chip = button(`#${tag} ×`, activeTags, () => toggleTag(tag), "pv-tag");
      chip.setAttribute("aria-label", `Remove filter #${tag}`);
    }
    if (state.tags.length) button("Clear tags", activeTags, () => { state.tags = []; render(); }, "pv-tag");
    body.replaceChildren();
    if (!items.length) { el("p", "pv-empty", "Your inventory is empty. Add rows to the CSV, then refresh.", body); return; }
    const query = state.search.toLocaleLowerCase().trim();
    const filtered = items.filter(item => (!state.category || item.category === state.category) && (!state.status || item.status === state.status || (state.status === "owned" && item.old)) &&
      (!state.event || arrangement(item, state.event)) &&
      (!state.place || locations(item).some(path => within(path, state.place))) &&
      state.tags.every(parent => item.tags.some(tag => within(tag, parent))) &&
      (!query || [item.name, item.description, item.brand, item.category, item.status, item.notes, ...item.tags].join(" ").toLocaleLowerCase().includes(query)));
    const summary = el("div", "pv-summary", undefined, body);
    for (const [label, value] of [["Items", number(count(filtered))], ["Entries", number(current(filtered).length)], ["Known weight", weight(total(filtered))], ["Entries without weight", number(unknown(filtered))]]) {
      const card = el("div", "pv-stat", undefined, summary);
      el("strong", "", value, card); el("span", "", label, card);
    }
    el("p", "pv-caption", `Showing ${filtered.length} of ${items.length} entries · weights include quantity · totals reflect filters`, body);
    if (filtered.some(item => item.old)) el("p", "pv-caption", "Greyed-out old items are excluded from all totals and the chart.", body);
    if (state.event) el("p", "pv-caption", `Locations for ${state.event} · ${filtered.filter(item => !locations(item).length).length} entries without an assigned location`, body);
    if (!filtered.length) { el("p", "pv-empty", "No matching possessions. Adjust the search or filters.", body); return; }
    const grouped = new Map();
    for (const item of filtered) { const key = groupKey(item); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(item); }
    const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
    const chart = el("div", "pv-chart", undefined, body);
    const knownTotal = total(filtered);
    const quantityTotal = count(filtered);
    const denominator = knownTotal || quantityTotal;
    const donut = el("div", "pv-donut", undefined, chart);
    donut.setAttribute("role", "img");
    donut.setAttribute("aria-label", `Distribution by ${state.group}, based on ${knownTotal ? "known weight" : "quantity"}. Values listed alongside.`);
    let start = 0;
    const stops = groups.map(([, rows], index) => {
      const end = start + (denominator ? (knownTotal ? total(rows) : count(rows)) / denominator * 100 : 0);
      const stop = `${palette[index % palette.length]} ${start}% ${end}%`; start = end; return stop;
    });
    donut.style.background = denominator ? `conic-gradient(${stops.join(",")})` : "var(--background-modifier-border)";
    const center = el("div", "pv-donut-center", undefined, donut);
    el("strong", "", knownTotal ? weight(knownTotal) : number(quantityTotal), center);
    el("span", "", knownTotal ? "known weight" : "items", center);
    const legend = el("div", "pv-legend", undefined, chart);
    groups.forEach(([name, rows], index) => {
      const line = el("div", "pv-legend-row", undefined, legend);
      const dot = el("span", "pv-dot", "", line); dot.style.backgroundColor = palette[index % palette.length];
      el("span", "", name, line);
      el("span", "pv-muted", `${number(count(rows))} items`, line);
      el("strong", "", weight(total(rows)), line);
    });
    groups.forEach(([name, rows], index) => {
      const section = el("details", "pv-group", undefined, body); section.open = true;
      const title = el("summary", "", undefined, section);
      const dot = el("span", "pv-dot", "", title); dot.style.backgroundColor = palette[index % palette.length];
      el("strong", "", name, title);
      el("span", "pv-group-total", `${number(count(rows))} items · ${weight(total(rows))}${unknown(rows) ? ` · ${unknown(rows)} unweighed` : ""}`, title);
      const scroll = el("div", "pv-table-scroll", undefined, section);
      const table = el("table", "pv-table", undefined, scroll);
      table.setAttribute("aria-label", name);
      const head = el("tr", "", undefined, el("thead", "", undefined, table));
      for (const text of ["Item", "Brand", ...(state.event ? ["Location"] : []), "Tags", "Each", "Qty", "Total"]) { const th = el("th", "", text, head); th.scope = "col"; }
      const tbody = el("tbody", "", undefined, table);
      const sorted = [...rows].sort((a, b) => state.sort === "name" ? a.name.localeCompare(b.name) : state.sort === "weight" ? (b.grams === null ? -1 : b.grams * b.quantity) - (a.grams === null ? -1 : a.grams * a.quantity) : state.sort === "quantity" ? b.quantity - a.quantity : a.index - b.index);
      for (const item of sorted) {
        const tr = el("tr", item.old ? "pv-old" : "", undefined, tbody);
        const cell = el("td", "pv-item", undefined, tr);
        const itemContent = el("div", "pv-item-content", undefined, cell);
        photo(itemContent, item);
        const text = el("div", "", undefined, itemContent);
        itemLink(text, item);
        if (item.status !== "owned") el("div", "pv-description", item.old ? "Old · excluded from totals" : `Status: ${item.status}`, text);
        if (item.description) el("div", "pv-description", item.description, text);
        if (item.notes) el("div", "pv-description", item.notes, text);
        const brand = el("td", "", undefined, tr);
        if (item.brand) el("div", "", item.brand, brand);
        if (state.event) el("td", "pv-event-location", locationText(item), tr);
        const tags = el("td", "", undefined, tr);
        const tagList = el("div", "pv-tags", undefined, tags);
        for (const tag of item.tags) {
          const chip = button(`#${tag}`, tagList, () => toggleTag(tag), "pv-tag");
          chip.setAttribute("aria-pressed", String(state.tags.includes(tag)));
        }
        el("td", "pv-numeric", item.grams === null ? "—" : weight(item.grams), tr);
        el("td", "pv-numeric", number(item.quantity), tr);
        el("td", "pv-numeric", item.old || item.grams === null ? "—" : weight(item.grams * item.quantity), tr);
      }
    });
    if (warnings.length) {
      const details = el("details", "pv-warnings", undefined, body);
      el("summary", "", `${warnings.length} CSV warning(s)`, details);
      const list = el("ul", "", undefined, details);
      warnings.forEach(message => el("li", "", message, list));
    }
  }
  async function load() {
    if (loading) return;
    loading = true; refresh.disabled = true; status.textContent = "Loading CSV…";
    try {
      // Read directly from the vault: CSV paths are always vault-relative.
      const file = dv.app.vault.getAbstractFileByPath(csvPath);
      if (!file || file.extension?.toLowerCase() !== "csv") throw new Error(`CSV not found: ${csvPath}`);
      const source = await dv.app.vault.read(file);
      warnings = [];
      items = parseCSV(source).map(normalize);
      eventNotes = {}; notesError = ""; setupChains = new Map();
      if (eventsPath) {
        const notesFile = dv.app.vault.getAbstractFileByPath(eventsPath);
        if (notesFile) {
          try {
            const parsed = JSON.parse(await dv.app.vault.read(notesFile));
            if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("expected an object keyed by event name");
            for (const [name, note] of Object.entries(parsed)) {
              if (!name || cleanTag(name) !== name || name.includes("/") || !note || typeof note !== "object" || Array.isArray(note) ||
                (note.extends !== undefined && (typeof note.extends !== "string" || !note.extends || note.extends.includes("/") || cleanTag(note.extends) !== note.extends)) ||
                (note.notes !== undefined && typeof note.notes !== "string") ||
                (note.instructions !== undefined && (!Array.isArray(note.instructions) || note.instructions.some(text => typeof text !== "string"))))
                throw new Error(`invalid entry for ${name}; use a single extends setup name, notes text and an instructions array of strings`);
            }
            const known = new Set([...Object.keys(parsed), ...items.flatMap(item => item.tags.filter(tag => tag.startsWith("event/")).map(tag => tag.split("/")[1]))]);
            const chains = new Map();
            function chain(name, visiting = []) {
              if (visiting.includes(name)) throw new Error(`inheritance cycle: ${[...visiting, name].join(" → ")}`);
              if (!known.has(name)) throw new Error(`unknown parent setup: ${name}`);
              if (chains.has(name)) return chains.get(name);
              const parent = Object.hasOwn(parsed, name) ? parsed[name].extends : undefined;
              const result = [name, ...(parent ? chain(parent, [...visiting, name]) : [])];
              chains.set(name, result);
              return result;
            }
            for (const name of known) chain(name);
            eventNotes = parsed;
            setupChains = chains;
          } catch (error) { notesError = `Could not load ${eventsPath}: ${error.message}`; }
        } else if (options.events) notesError = `Event instructions not found: ${eventsPath}`;
      }
      for (const item of items) {
        for (const tag of item.tags.filter(tag => tag.startsWith("omit/"))) {
          const name = tag.slice(5);
          if (!name || name.includes("/")) warnings.push(`${item.name}: exclusions must use omit/<setup>, without a place`);
          else if (item.tags.some(value => within(value, `event/${name}`))) warnings.push(`${item.name}: both inclusion and exclusion for ${name}; exclusion wins`);
        }
      }
      const categories = [...new Set(items.map(item => item.category))].sort((a, b) => a.localeCompare(b));
      const tags = [...new Set(items.flatMap(item => item.tags.flatMap(ancestors)))].sort((a, b) => a.localeCompare(b));
      const statuses = [...new Set(["owned", ...items.map(item => item.status), ...(state.status ? [state.status] : [])])].sort();
      const events = [...new Set([...Object.keys(eventNotes), ...items.flatMap(item => item.tags.filter(tag => tag.startsWith("event/")).map(tag => tag.split("/")[1]))])].sort();
      if (state.event && !events.includes(state.event)) events.push(state.event);
      if (!categories.includes(state.category)) state.category = "";
      if (state.group.startsWith("tag:") && !tags.includes(state.group.slice(4))) state.group = "category";
      categoryFilter.setChoices([["", "All categories"], ...categories.map(value => [value, value])]);
      tagFilter.setChoices([["", "Choose tag…"], ...tags.map(value => [value, `#${value}`])]);
      statusFilter.setChoices([["", "All statuses"], ...statuses.map(value => [value, value === "owned" ? "Owned + old" : value])]);
      eventSelect.setChoices([["", "All events"], ...events.map(event => [event, event])]);
      updatePlaces();
      groupSelect.setChoices([["event-location", "Location in event"], ["category", "Category"], ...tags.map(tag => [`tag:${tag}`, `Tag: #${tag}`])]);
      status.textContent = csvPath;
      render();
    } catch (error) {
      body.replaceChildren();
      status.textContent = `Could not load inventory: ${error.message}`;
    } finally { loading = false; refresh.disabled = false; }
  }
  await load();
})();
