# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, contact the maintainer directly via GitHub: [@nwmorph](https://github.com/nwmorph)

Describe the issue, steps to reproduce, and potential impact. You'll receive a response as soon as possible.

## Scope

This extension runs locally and communicates only with:
- `api.pubsub.salesforce.com:7443` — Salesforce Pub/Sub gRPC API
- Your authenticated Salesforce org instance URL

No data is sent to any third-party service. Credentials are read from the local `~/.sfdx` store managed by the Salesforce CLI.
