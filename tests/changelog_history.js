import fs from "node:fs";
import path from "node:path";

// Historical documentation assertions span the index and its linked archives.
export function readChangelogHistory(root) {
  const archives = fs.readdirSync(path.join(root, "CHANGELOG")).filter((file) => file.endsWith(".md")).sort();
  return ["CHANGELOG.md", ...archives.map((file) => path.join("CHANGELOG", file))]
    .map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
}
