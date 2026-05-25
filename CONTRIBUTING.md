# Contributing

Contributions are welcome, especially small fixes, tests, documentation
improvements, and paper-trading research workflow improvements.

This project is a research tool for paper trading. It is not financial advice,
and it does not currently include live order execution. Please do not submit
changes that add real order placement, private trading API credentials, secrets,
or secret-like values.

Before opening a pull request:

- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- Keep changes focused and explain the motivation in the pull request.
- Use a bilingual pull request title in the form `English title / 日本語タイトル`.
- Do not add a `[codex]` prefix to the pull request title.
- Write the pull request body in Japanese, using `## 概要` and `## 検証` as
  the default sections.
- Always assign the pull request. For solo work, assign it to the author.
- Do not include `.env` files, API keys, database dumps, private logs, or other
  sensitive material.
