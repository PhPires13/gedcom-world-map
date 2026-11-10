# Examples

- `synthetic-pt-1847.MOCK-output.json` shows the output format. It is **not a live run**. It was made by feeding the reader a mocked model response: the hand-built ground-truth reading of `eval/samples/synthetic-pt-1847/page-1.png` (`tests/fixtures/synthetic-pt-1847.reading.json`). That response then went through the real pipeline: page loading, box normalisation and checks, claims and hint matching. Its usage and cost are zero, and `model_served` says `MOCK`.

No `ANTHROPIC_API_KEY` was available when the reader was built, so there is no live output yet. The first live run should be saved here as `synthetic-pt-1847.output.json` (see the main README, "First live run").
