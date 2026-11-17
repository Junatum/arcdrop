# Contributing to ArcDrop

Thanks for your interest in ArcDrop, a SmartSafeHub official app distributed under **GPL-3.0-or-later**.

## Before proposing a change

- Open an issue describing the intended behavior, affected OpenWrt target or browser, and a reproducible scenario. For security concerns, use [SECURITY.md](SECURITY.md) instead of a public issue.
- Keep ArcDrop independent: **do not copy PairDrop/Snapdrop source code, UI assets, or other unlicensed third-party material**.
- Preserve the trusted-LAN boundary, HTTPS checks, explicit recipient approval, and the rule that the router must not receive file payload bytes.
- Prefer small changes without persistent services, bulky dependencies, or generated frontend build output.

## Development and tests

Follow the [English development guide](docs/DEVELOPMENT.md) or [한국어 개발 가이드](docs/ko/DEVELOPMENT.md). Run from the repository root:

```sh
shellspec
sh tools/lint.sh
```

The `spec/contracts_spec.sh` descriptions remain in **Korean** per the project's test conventions; source comments and public technical documentation should be in English. Register every new test exactly once with ShellSpec and preserve the CI test-coverage guard.

## Documentation and releases

- `README.md`, `CHANGELOG.md`, and the default `docs/` technical guides are in English.
- `README.ko.md` and selected `docs/ko/` guides are maintained in Korean.
- Keep `CHANGELOG.md` entries grouped by release with **exactly one blank line** between release blocks.
- When changing the package revision, update `Makefile`, the version in `web/index.html`, the changelog, and relevant tests together.
- Do not commit generated frontend files (`web/dist`, `web/build`).

Contributions are subject to review; filing a pull request does not guarantee acceptance. Ensure any submitted code is yours to license under GPL-3.0-or-later, with appropriate copyright and notice files for third-party components.
