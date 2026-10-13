# Security

## Reporting a vulnerability

Please report security problems **privately** through
[GitHub's private vulnerability reporting](https://github.com/Aswertus/cisco-lsp/security/advisories/new),
not in a public issue. You'll get a reply there; this is a spare-time project, so it may take
a few days.

## Your configurations

The extension runs entirely on your machine. Your config files are never uploaded; the only
network request is the optional update check against GitHub Releases
(`cisco-ios-lsp.checkForUpdates`).

Issues on this repository are public. When you report a bug, include only the few lines
needed to reproduce it, and replace hostnames, real IP addresses (use the documentation
ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), passwords and hashes, SNMP
communities and keys. If you posted something sensitive by mistake, edit the issue right
away and rotate the affected credentials — GitHub keeps an edit history.
