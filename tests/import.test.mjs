// Run with: node tests/import.test.mjs (also runs the view regression checks).
// All fixture contents are fictional and safe to publish.
import { readFile } from "node:fs/promises";
import { fixture, assert } from "./view.test.mjs";

const inventoryCSV = await readFile(new URL("./fixtures/inventory.csv", import.meta.url), "utf8");
const eventJSON = await readFile(new URL("./fixtures/setups.json", import.meta.url), "utf8");
const imported = await fixture(inventoryCSV, { event: "base" }, eventJSON);
const names = () => imported.nodes().filter(node => node.className === "pv-name").map(node => node.textContent);

assert(imported.stat(0) === "6" && imported.stat(1) === "5", "File import preserves quantities and owned entry counts");
assert(imported.stat(2) === "330 g" && imported.stat(3) === "1", "Known weights include quantities; missing weights remain unknown");
assert(imported.nodes().filter(node => node.className === "pv-old").length === 1, "Old stock stays visible without contributing to totals");
assert(imported.nodes().some(node => node.textContent === "Small, reusable cup"), "Quoted descriptions survive file import");
assert(imported.nodes().some(node => node.textContent === "Wash after use."), "Item notes survive file import");

imported.change("Event", "cold");
assert(imported.stat(0) === "6" && imported.stat(2) === "630 g", "Child setup inherits stock and adds its own items");
assert(!names().includes("Warm-weather filter") && names().includes("Cold-weather filter"), "Child exclusions replace equipment without duplicating stock");
assert(!names().includes("Spare battery"), "Child setup excludes inherited stock");
assert(imported.nodes().some(node => node.textContent === "Check supplies.") && imported.nodes().some(node => node.textContent === "Check insulation."), "Instructions inherit from imported configuration");

imported.change("Status", "wishlist");
assert(imported.stat(1) === "1" && names().includes("Blanket"), "Wishlist stock stays separate from owned stock");
imported.change("Status", "uncertain");
assert(imported.stat(1) === "1" && names().includes("Pouch"), "Uncertain stock stays reviewable through inheritance");
imported.change("Status", "owned");
imported.change("Event", "cold-plus");
assert(imported.stat(0) === "7" && imported.stat(2) === "650 g", "Grandchild setup can re-include excluded stock");
assert(imported.groups().includes("pocket") && names().filter(name => name === "Spare battery").length === 1, "Re-included stock uses its new location and appears once");

for (const setup of Object.keys(JSON.parse(eventJSON))) {
  const rendered = await fixture(inventoryCSV, { event: setup }, eventJSON);
  assert(!rendered.nodes().some(node => node.className === "pv-warnings" || node.textContent.startsWith("Could not load ")), "Fixture setup loads without warnings: " + setup);
}
console.log("All inventory import checks passed.");
