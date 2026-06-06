# Changelog

All notable changes to SF Streaming Monitor are documented here.

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
