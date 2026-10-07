# Release Codex Companion

The GitHub marketplace selects committed `release/plugins/codex`. The generator combines companion and native worker sources, preserving upstream license and notice files. Release versions come from `package.json`; development bundles retain source-hash suffixes.

## Prepare and qualify

1. Start from a clean branch. Update maintained sources and use `npm run bump-version -- <version>` to synchronize metadata. Update the changelog and versioned notes.
2. Run `npm ci`, `npm test`, and `npm run build` with the release's pinned tools. Generate with `npm run release:prepare`; run `npm run release:validate` for deterministic generation and strict manifests.
3. Run `npm run release:test`: native Mod tests and five actual Claude lifecycle scenarios with simulated Codex. It makes no provider calls and typechecks against fresh declarations generated in an isolated copy.
4. Run `npm run release:acceptance:real` with the intended Codex provider. It creates an isolated two-file implementation, continues its worker to fix an empty-name case, and returns re-review to the original reviewer after another topic intervenes. Record actual model, thread identities, results, and elapsed time. This is real Codex with a scripted Claude parent, not a live Claude model.
5. Verify marketplace installation in an isolated `CLAUDE_CONFIG_DIR`, including the installed worker and Mod. Keep personal settings and active sessions untouched. Confirm a clean Git checkout reproduces `release:check` and package acceptance without copied SDK declarations.
6. Run `npm run release:pack` to create a deterministic standalone marketplace ZIP and SHA-256 sidecar in `output/`. Exclude credentials, SDK/protocol declarations, caches, and private task logs. Record fresh evidence in the notes.

Commit generated `release/` with the preparation changes. Its host SDK types are ignored because Claude regenerates them. `release:check` compares all shipped files with fresh generation and rejects stale or extra output. CI checks runtime, package generation, and native acceptance, and uploads the ZIP/checksum as artifacts.

## Publish after approval

After the maintainer approves the prepared commit and qualification, merge into the default branch: GitHub marketplace installs follow that branch. Create a matching `v<version>` tag and GitHub prerelease with the versioned notes, ZIP, and checksum. No workflow publishes automatically.

Restart after updates. An earlier local `codex@huabei-codex` trial must be uninstalled with `--keep-data` before installing `codex@codex-companion`. Preserve attribution and license. Upstream contributions remain independent of this release.

## Qualification boundaries

The first beta targets macOS. Linux CI covers runtime tests, protocol types, versions, and deterministic generation; it does not qualify native Linux interaction. Windows, desktop painting, arbitrary crash recovery, live Claude delegation adherence, prompt-cache savings, and other host versions need separate evidence. Keep simulated, scripted-parent real-provider, and normal live-model results distinct.
