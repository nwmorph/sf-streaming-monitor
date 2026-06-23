# Changelog

All notable changes to SF Streaming Monitor are documented here.

## [0.1.2] — 2026-06-23

### Improved
- List view: channel name is now de-duplicated across consecutive cards — the first card in a run shows the full bold channel name; subsequent cards on the same channel show a short muted label, making it easier to scan a high-volume stream without visual noise

---

## [0.1.1] — 2026-06-23

### Fixed
- Org credentials now resolved correctly: the extension reads the decrypted access token by invoking `@salesforce/core` from the Salesforce CLI's own installation (`/usr/local/lib/sf/node_modules/@salesforce/core`), replacing a broken approach that attempted to bundle `@salesforce/core` as an external module (which VS Code's extension host could not resolve) and a subsequent attempt that mistakenly extracted the refresh token instead of the access token from the `sfdxAuthUrl` field
- Removed `@salesforce/core` and `keytar` from the extension's own `package.json` dependencies and esbuild external list — the extension no longer ships or requires its own copy

---

## [0.1.0] — 2026-06-06

### Added
- Subscribe to Salesforce Platform Events, CDC, and Generic Streaming channels via the Pub/Sub gRPC API
- List view with collapsible event cards (Payload / Full envelope toggle)
- Timeline view with colour-coded dots per channel, clustering with count badges, ‹ › navigation
- Timeline window filter: All, 1 day, 12 hr, 6 hr, 3 hr, 1 hr, 30 min, 10 min
- Channel legend in timeline toolbar
- Global Payload / Full toggle applies to all cards simultaneously
- Publish Event modal with live schema fetch, auto-generated payload template, and Avro serialization
- Channel discovery (Platform Events and CDC topics)
- Org picker backed by local `~/.sfdx` credentials; auto-detects default org from SFDX workspace
- Replay control: New only (−1) or All retained (−2)
- Diagnostic Output channel logging all gRPC lifecycle events
- Date fields formatted as ISO strings instead of raw Unix timestamps
- Session expired errors prompt to re-authenticate directly from the extension
- Author credit: Niklas Waller
