# Security Policy

## Supported scope

This repository is a paper-trading and research project. Live order execution,
GMO Private API integration, and real trading credentials are outside the
supported security scope.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's private
vulnerability reporting when available, or by opening a GitHub security advisory
draft for this repository.

Do not include secrets, API keys, private trading credentials, database dumps,
or exploitable details in public issues or pull requests.

## Contributor safety rules

- Do not commit `.env` files, API keys, private logs, database dumps, or
  credential-like values.
- Do not add live order execution or private trading API calls without an
  explicit maintainer-approved design change.
- Keep GitHub Actions permissions minimal and avoid introducing workflows that
  can write to repository contents from untrusted pull requests.
