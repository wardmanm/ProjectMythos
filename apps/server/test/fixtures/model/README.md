# Mock provider fixtures

Recorded model responses that the mock provider replays in fixture mode (PRV-081). They
are committed and reviewed like code (CONV-114).

## Layout

```
model/
  <scope>/                one folder per test scenario
    001-narrator.json     the scenario's first narrator call
    002-narrator.json     its second narrator call
    001-extractor.json    its first extractor call
```

- **The scope** is a kebab-case slug named after the test, such as `prv-081-replay`.
  Test names hold characters such as `:` that Windows file names cannot.
- **The number** is three digits and counts the calls of that role only, from `001`.
  Background calls interleave with interactive ones, so one count across roles would
  not replay the same way twice.
- **The role** is the call's `TextRequest.role`.
- **Each file** is exactly one `TextResponse`, as an adapter returns it: `text`,
  `thinking`, `usage`, and `finishReason`. It is never a provider's wire format
  (PRV-012); the mock rejects any other field, naming the file.

A test points the mock at its scenario by setting the provider config's `fixturesDir`
to the scope folder. A call with no file throws, naming the file it looked for.

Fixtures are keyed by scenario, role, and number, not by prompt text, so template edits
never invalidate them. The server's `record-fixtures` command (PRV-082) writes a
scenario's files from a real profile, replacing only that scenario's folder.

## Scenarios

- `prv-081-replay`: two narrator calls and one extractor call, for the replay test.
- `prv-012-wire-format`: deliberately in Ollama's wire format, so the test can show
  the mock rejects it.

## Governing spec

- [05-providers.md](../../../../../spec/05-providers.md) §8 and its Decisions.
