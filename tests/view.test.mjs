// Run with: node tests/view.test.mjs
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../view.js", import.meta.url), "utf8");

// Small DOM substitute: exercise the actual view and its controls without Obsidian.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.handlers = {}; this.style = {}; this.attributes = {}; this.textContent = ""; this.value = ""; }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; this.textContent = ""; }
  addEventListener(name, callback) { this.handlers[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() {}
}
const document = { createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element("#text"), { textContent: text }) };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction("dv", "input", "document", source);
function assert(condition, message) { if (!condition) throw new Error(message); }
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
async function fixture(csv, input = {}, eventSource = null) {
  const container = new Element("div");
  const requestedPaths = [];
  const dv = { container, app: { vault: {
    getAbstractFileByPath: path => {
      requestedPaths.push(path);
      return path.endsWith(".csv") ? { extension: "csv" } : eventSource === null ? null : { extension: "json" };
    },
    read: async file => file.extension === "csv" ? csv : eventSource
  }, metadataCache: {}, workspace: {} } };
  await execute(dv, input, document);
  const nodes = () => descendants(container);
  const select = label => nodes().find(node => node.tagName === "label" && node.textContent === label).children[0];
  return {
    nodes, select, requestedPaths,
    stat: index => nodes().filter(node => node.className === "pv-stat")[index].children[0].textContent,
    groups: () => nodes().filter(node => node.className === "pv-group").map(node => node.children[0].children.find(child => child.tagName === "strong").textContent),
    change(label, value) { const node = select(label); node.value = value; node.handlers.change(); },
    async refresh(value) { csv = value; await nodes().find(node => node.textContent === "Refresh CSV").handlers.click(); }
  };
}

const csv = `name,weight,quantity,tags,status
Headlamp,100 g,1,group/storage/car/boot;group/winter/hiking,owned
Cable,20 g,2,#group/storage/car/glove-box;group/tech,owned
Mat,200 g,1,group/storage/carpet;group/winter,owned
Monitor,2 kg,1,group/tech,wishlist
Helmet,300 g,1,group/caving,sold
Shared,10 g,1,group/storage/car/boot;group/storage/house;group/winter,owned
Direct,0,0,group/storage,owned
Unknown,,,group/paper,owned`;
const view = await fixture(csv, { groupByTag: "group/storage" });
assert(view.stat(0) === "6", "Owned quantity excludes wishlist and sold");
assert(view.stat(2) === "350 g", "Known weights include quantities");
assert(view.stat(3) === "1", "Unknown weights are tracked");
assert(view.groups().includes("group/storage/car + group/storage/house"), "Overlapping groups counted once");
assert(view.groups().includes("group/storage (direct)"), "Direct branch assignment");
assert(view.groups().includes("No #group/storage tag"), "Missing branch group");
assert(view.select("Add tag filter (AND)").children.some(node => node.value === "group/storage/car"), "Parent inferred");
view.change("Add tag filter (AND)", "group/storage/car");
assert(view.stat(0) === "4", "Parent includes descendants but excludes carpet");
view.change("Add tag filter (AND)", "group/winter");
assert(view.stat(0) === "2", "AND filters intersect branches");
assert(view.stat(2) === "110 g", "No duplicated group weights");
view.nodes().find(node => node.attributes["aria-label"] === "Remove filter #group/winter").handlers.click();
assert(view.stat(0) === "4", "Remove active filter");
view.change("Group by", "tag:group/storage/car");
assert(view.groups().includes("group/storage/car/glove-box"), "Grouping drills into next segment");
view.nodes().find(node => node.textContent === "Clear tags").handlers.click();
view.change("Status", "");
assert(view.stat(0) === "8", "All statuses selectable");
view.change("Status", "wishlist");
assert(view.stat(2) === "2,000 g", "Wishlist isolated");
await view.refresh("name,tags,status\nOther,group/storage/house,owned");
assert(view.stat(0) === "0", "Status retained on refresh");

const initial = await fixture(csv, { tags: ["group/storage/car", "group/winter"], groupByTag: "group/storage", unit: "kg" });
assert(initial.stat(2) === "0.11 kg", "Initial filters and units");
await initial.refresh("name,tags\nOther,group/storage/house");
assert(initial.stat(0) === "0", "Missing tag filters do not broaden results");
const missing = await fixture(csv, { tags: ["does/not/exist"] });
assert(missing.stat(0) === "0", "Missing initial tag gives no matches");
const quoted = await fixture('\uFEFFname,description,weight,quantity,tags\r\n"A, B","line 1\nline 2",2 oz,2,"["" #group/storage//car/ "",""group/two words""]"');
assert(quoted.stat(2) === "113.4 g", "Quoted CSV and unit conversion");
assert(quoted.nodes().some(node => node.textContent === "line 1\nline 2"), "Multiline description");
quoted.change("Add tag filter (AND)", "group/storage/car");
assert(quoted.stat(0) === "2", "Tag paths normalized");
const invalid = await fixture("name,weight,quantity,tags\nBad,heavy,-3,[bad]");
assert(invalid.stat(0) === "1" && invalid.stat(3) === "1", "Invalid numeric values handled");
assert(invalid.nodes().some(node => node.className === "pv-warnings"), "Warnings rendered");
const consumables = await fixture("name,quantity,tags\nToothpaste,2,group/storage/bag;consumable\nSoap,1,group/storage/car;consumable\nBrush,1,group/storage/bag");
consumables.change("Add tag filter (AND)", "consumable");
assert(consumables.stat(0) === "3", "Consumables can be marked with a tag");
consumables.change("Add tag filter (AND)", "group/storage/bag");
assert(consumables.stat(0) === "2", "Consumable marker combines with storage tags");
const broken = await fixture('name\n"unclosed');
assert(broken.nodes().some(node => node.textContent.includes("Unclosed quoted CSV field")), "Malformed CSV handled");
assert(!view.select("Group by").children.some(node => node.value === "location"), "No location control");

const eventCSV = `name,weight,quantity,tags,status
Power bank,200,1,event/backpacking/backpack/essentials;event/car-ride/car/console;event/apartment/desk;group/tech;group/essentials,owned
Soap,50,2,event/backpacking/backpack/hygiene;event/car-ride/car/boot;consumable,owned
Membership only,10,1,event/backpacking;group/essentials,owned
Wrong prefix,500,1,event/backpacking-extra/car;group/tech,owned
Independent,20,1,group/tech,owned
Two locations,30,1,event/backpacking/backpack/essentials;event/backpacking/pocket;group/essentials,owned
Empty location,5,1,event/backpacking/,owned
Wishlist,100,1,event/backpacking/backpack;consumable,wishlist`;
const events = await fixture(eventCSV, { event: "backpacking" });
assert(events.stat(0) === "6" && events.stat(2) === "345 g", "Event membership filters with boundaries and ownership");
assert(events.groups().includes("backpack/essentials"), "Groups by full event-specific location");
assert(events.groups().includes("Location unspecified"), "Membership without location retained");
assert(events.groups().includes("backpack/essentials + pocket"), "Conflicting locations count once");
assert(!events.groups().some(name => name.includes("console") || name.includes("desk")), "Other events never leak into grouping");
assert(events.select("Event").children.some(node => node.value === "apartment"), "Events discovered from tags");
assert(events.select("Location in event").children.some(node => node.value === "backpack"), "Location parents inferred");
assert(events.nodes().filter(node => node.className === "pv-event-location").some(node => node.textContent === "backpack/hygiene"), "Location column rendered");
events.change("Location in event", "backpack");
assert(events.stat(0) === "4" && events.stat(2) === "330 g", "Location filter includes all descendants once");
events.change("Add tag filter (AND)", "group/essentials");
assert(events.stat(0) === "2", "Independent kit filter intersects event and location");
events.change("Group by", "tag:group");
events.change("Event", "car-ride");
assert(events.select("Location in event").value === "", "Event change clears location filter");
assert(events.select("Group by").value === "event-location", "Event change selects contextual grouping");
assert(events.stat(0) === "1" && events.groups()[0] === "car/console", "Switch changes location and preserves kit filter");
events.nodes().find(node => node.textContent === "Clear tags").handlers.click();
assert(events.stat(0) === "3", "All car members after clearing kit filter");
events.change("Event", "");
assert(events.stat(0) === "8" && events.stat(2) === "865 g", "All events counts rows only once");
assert(events.groups().length === 1 && events.groups()[0] === "All possessions", "No blended event locations in all-event view");
assert(events.select("Location in event").disabled, "Location filter disabled without event");
assert(!events.nodes().some(node => node.className === "pv-event-location"), "No ambiguous location column without event");
events.change("Event", "backpacking");
events.change("Add tag filter (AND)", "consumable");
assert(events.stat(0) === "2", "Consumable classification works with event");
events.change("Status", "");
assert(events.stat(0) === "3", "Wishlist can be included in event view");
events.change("Location in event", "backpack/hygiene");
await events.refresh("name,tags\nOther,event/car-ride/car");
assert(events.stat(0) === "0", "Refresh retains absent event and location filters");
assert(events.select("Event").value === "backpacking" && events.select("Location in event").value === "backpack/hygiene", "Missing selections remain visible");
const absentEvent = await fixture(eventCSV, { event: "not-present" });
assert(absentEvent.stat(0) === "0", "Unknown initial event gives no matches");
const normalizedEvent = await fixture(eventCSV, { event: "#event/car-ride/" });
assert(normalizedEvent.stat(0) === "3", "Initial event accepts normalized event tag");
const oldItems = await fixture("name,weight,quantity,tags,status\nCurrent,20,2,event/home/desk,owned\nFormer,500,3,old;event/home/shelf,owned\nFormer unknown,,,old,\nStatus old,100,1,,old", { event: "home" });
assert(oldItems.nodes().filter(node => node.className === "pv-old").length === 1, "Old tag remains visible in default view");
assert(oldItems.stat(0) === "2" && oldItems.stat(1) === "1" && oldItems.stat(2) === "40 g", "Old items excluded from quantity, entries and weight");
oldItems.change("Event", "");
assert(oldItems.nodes().filter(node => node.className === "pv-old").length === 3, "Old status and tags both recognized");
assert(oldItems.stat(3) === "0", "Old unknown weights excluded");
oldItems.change("Status", "old");
assert(oldItems.stat(0) === "0" && oldItems.stat(2) === "0 g", "Old-only view has zero totals");
assert(oldItems.nodes().find(node => node.className === "pv-donut").style.background === "var(--background-modifier-border)", "Old-only chart is empty");
const instructions = await fixture("name,tags\nLamp,event/home/desk", { event: "home" }, JSON.stringify({ home: { notes: "At home", instructions: ["Charge devices", "<b>Plain text</b>"] }, travel: { instructions: ["Check docs"] } }));
assert(instructions.nodes().some(node => node.textContent === "Charge devices"), "Selected event instructions displayed");
assert(instructions.nodes().some(node => node.tagName === "li" && node.textContent === "<b>Plain text</b>"), "Instructions are plain text");
instructions.change("Event", "travel");
assert(instructions.nodes().some(node => node.textContent === "Check docs"), "Instructions-only event selectable even without inventory members");
assert(!instructions.nodes().some(node => node.textContent === "Charge devices"), "Previous instructions cleared on event change");
instructions.change("Event", "");
assert(instructions.nodes().find(node => node.className === "pv-instructions").children.length === 0, "All events hides instructions");
const badNotes = await fixture("name\nLamp", {}, "{bad");
assert(badNotes.stat(0) === "1" && badNotes.nodes().some(node => node.textContent.startsWith("Could not load ")), "Malformed instructions do not prevent inventory loading");
const disabledNotes = await fixture("name\nLamp", { events: false }, "{bad");
assert(!disabledNotes.nodes().some(node => node.textContent.startsWith("Could not load ")), "Instructions can be disabled");
assert(disabledNotes.requestedPaths.length === 1, "Disabled configuration is not read");
const relocated = await fixture("name,tags\nLamp,event/home/desk", {
  csv: "Private/Inventory/packinglist.csv", events: "Private/Travel/events.json", event: "home"
}, '{"home":{"instructions":["Charge lamp"]}}');
assert(relocated.requestedPaths.join("|") === "Private/Inventory/packinglist.csv|Private/Travel/events.json", "CSV and events use independent vault-relative paths");
assert(relocated.stat(0) === "1" && relocated.nodes().some(node => node.textContent === "Charge lamp"), "Relocated inventory and instructions render");
await relocated.refresh("name,tags\nSpare,event/home/bag");
assert(relocated.requestedPaths.slice(2).join("|") === "Private/Inventory/packinglist.csv|Private/Travel/events.json", "Refresh reuses configured paths");
const adjacent = await fixture("name\nLamp", { csv: "Private/packinglist.csv" });
assert(adjacent.requestedPaths[1] === "Private/events.json", "Default event path follows relocated CSV");
const inheritanceCSV = `name,weight,quantity,tags
Inherited,10,2,event/base/bag/pouch
Moved,20,1,event/base/bag;event/child/pocket
Excluded,30,1,event/base/bag;omit/child
Restored,40,1,event/base/bag;omit/child;event/grand/suitcase
Unlocated,50,1,event/base/bag;event/child
Conflict,60,1,event/base/bag;event/child/pocket;omit/child
Boundary,70,1,event/base-extra/bag
Child only,80,1,event/child/desk
Former,90,1,event/base/bag;old`;
const hierarchy = JSON.stringify({ base: { notes: "Base note", instructions: ["Charge", "Maps"] }, child: { extends: "base", instructions: ["Charge", "Child reminder"] }, grand: { extends: "child" } });
const inherited = await fixture(inheritanceCSV, { event: "child" }, hierarchy);
assert(inherited.stat(0) === "5" && inherited.stat(2) === "170 g", "Child includes inherited rows once and respects exclusions and old totals");
assert(inherited.groups().includes("bag/pouch") && inherited.groups().includes("pocket") && inherited.groups().includes("Location unspecified"), "Nearest inclusion overrides location, including explicit membership without a place");
assert(!inherited.nodes().some(node => node.textContent === "Excluded" || node.textContent === "Conflict"), "Exclusion wins same-setup conflict");
assert(inherited.nodes().some(node => node.textContent.includes("exclusion wins")), "Conflicting declarations warn");
assert(inherited.nodes().filter(node => node.tagName === "li" && node.textContent === "Charge").length === 1, "Inherited instructions deduplicated");
inherited.change("Location in event", "bag");
assert(inherited.stat(0) === "2", "Inherited locations populate filters and include descendants");
inherited.change("Event", "grand");
assert(inherited.stat(0) === "6" && inherited.stat(2) === "210 g", "Descendant inherits exclusions and can explicitly re-include stock");
assert(inherited.groups().includes("suitcase"), "Re-included item uses descendant location");
assert(!inherited.nodes().some(node => node.textContent === "Excluded"), "Exclusions propagate through descendants");
inherited.change("Event", "");
assert(inherited.stat(0) === "9" && inherited.stat(2) === "370 g", "All events retains excluded inventory and counts physical stock once");
inherited.change("Event", "base");
assert(inherited.stat(0) === "7" && inherited.stat(2) === "220 g", "Child exclusions do not affect parent");
for (const [definitions, message] of [
  [{ a: { extends: "b" }, b: { extends: "a" } }, "inheritance cycle"],
  [{ a: { extends: "missing" } }, "unknown parent setup"],
  [{ a: { extends: ["base"] } }, "invalid entry"]
]) {
  const invalidHierarchy = await fixture("name,tags\nLamp,event/a/desk", { event: "a" }, JSON.stringify(definitions));
  assert(invalidHierarchy.stat(0) === "1", "Invalid hierarchy retains explicit inventory");
  assert(invalidHierarchy.nodes().some(node => node.textContent.includes(message)), message + " is reported");
}
const tagParent = await fixture("name,tags\nLamp,event/base/desk", { event: "child" }, '{"child":{"extends":"base"}}');
assert(tagParent.stat(0) === "1", "Parent setup can be defined through item tags");
console.log("All inventory view checks passed.");
export { fixture, assert };
