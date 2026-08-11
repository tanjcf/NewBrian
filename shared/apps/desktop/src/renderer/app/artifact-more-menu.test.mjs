import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("artifact menu resists the preview header div rule and matches the compact skill picker", () => {
  assert.match(styles, /\.search-file-preview > header \.artifact-more-menu\s*\{[^}]*min-width:\s*148px[^}]*display:\s*grid/s);
  assert.match(styles, /\.search-file-preview > header \.artifact-more-menu > button\s*\{[^}]*min-height:\s*32px[^}]*font-size:\s*11px[^}]*white-space:\s*nowrap/s);
});
