# Contributing to SF Streaming Monitor

Thanks for your interest\! This is a personal/internal tool maintained on a best-effort basis. Contributions are welcome but response time is not guaranteed.

## Reporting a bug

Please use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) issue template. The more detail you provide, the easier it is to reproduce and fix.

## Suggesting a feature

Open an issue with the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template. Describe the use case — not just the feature — so the value is clear.

## Submitting a pull request

1. Fork the repo and create a branch from `main`
2. Run `npm install` and `npm run compile` to verify it builds cleanly
3. Keep changes focused — one fix or feature per PR
4. Test against a real Salesforce org if possible
5. Open the PR with a clear description of what changed and why

## Development setup

```bash
git clone https://github.com/nwmorph/sf-streaming-monitor.git
cd sf-streaming-monitor
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

Changes to `media/main.js` and `media/main.css` take effect after closing and reopening the panel — no recompile needed.

## No guarantees

This project is maintained in spare time. Issues and PRs may take time to review. If you need a fix urgently, the codebase is intentionally simple — feel free to fork and patch.
