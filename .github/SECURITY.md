# Security Policy

This document outlines security procedures and general policies for TabMerger.

## Supported versions

Only the latest published stable release (Chrome/Firefox/Edge stores, and the deployed web
app) is supported with security fixes. There is no long-term maintenance branch.

## Reporting a vulnerability

Please do not open a public GitHub issue for a security vulnerability.

Report security bugs privately through GitHub's built-in reporting flow: go to this
repository's **Security** tab → **Report a vulnerability**. Include as much detail as you can:
affected package (`extension`, `web`, or `shared`), reproduction steps, and impact.

<!-- TODO (owner): enable private vulnerability reporting in Settings → Code security if it
     isn't already turned on — the link above only works once that setting is enabled. -->

I take all security bugs extremely seriously and appreciate responsible disclosure. I will
acknowledge a new report within 24 hours, and send a more detailed response within 48 hours
indicating next steps.

**Note:** report security bugs in third-party dependencies to the person or team maintaining
that dependency, not here.

## Scope notes specific to this repo

- The extension's cloud sync is end-to-end encrypted for signed-in Pro users — the unwrapped
  data key never leaves the device and the server never holds it. If you find a path where
  plaintext content reaches Supabase or a server-side route for an encrypted column, that is a
  high-priority report.
- The extension requests no `host_permissions` — if you find a code path that reads or scripts
  arbitrary page content without the user's explicit interaction, that is a high-priority report.

## Disclosure policy

When a security bug report is received, it will be assigned to a primary handler who will
coordinate the fix and release:

- Confirm the problem and determine affected versions.
- Audit the code for similar issues.
- Prepare and test a fix.
- Release the fix as soon as possible, then publish an advisory describing the issue.
