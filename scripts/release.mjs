#!/usr/bin/env node
// Usage: pnpm release <patch|minor|major|x.y.z>
// Bumps the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml,
// commits, tags vX.Y.Z and pushes — the Release workflow does the rest.
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const sh = (c) => execSync(c, { stdio: "pipe" }).toString().trim()
const arg = process.argv[2] ?? "patch"

if (sh("git status --porcelain")) {
  console.error("✗ Working tree not clean. Commit or stash first.")
  process.exit(1)
}
if (sh("git branch --show-current") !== "main") {
  console.error("✗ Releases are cut from main.")
  process.exit(1)
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"))
const [maj, min, pat] = pkg.version.split(".").map(Number)
const next =
  arg === "major" ? `${maj + 1}.0.0` : arg === "minor" ? `${maj}.${min + 1}.0` : arg === "patch" ? `${maj}.${min}.${pat + 1}` : arg
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`✗ Bad version: ${next}`)
  process.exit(1)
}

pkg.version = next
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"))
conf.version = next
writeFileSync("src-tauri/tauri.conf.json", JSON.stringify(conf, null, 2) + "\n")
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").replace(/^version = ".*"$/m, `version = "${next}"`)
writeFileSync("src-tauri/Cargo.toml", cargo)
execSync("cargo update -p marie --manifest-path src-tauri/Cargo.toml --offline", { stdio: "ignore" })

sh(`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`)
sh(`git commit -m "release: v${next}"`)
sh(`git tag v${next}`)
execSync(`git push origin main v${next}`, { stdio: "inherit" })
console.log(`✓ Tagged v${next} — watch it build: gh run watch`)
