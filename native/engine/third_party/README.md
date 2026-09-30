# third_party/

Vendored SDKs, gitignored (large — the VST3 SDK checkout alone is ~170MB). Not committed;
fetch them locally before building anything under `native/engine/`.

## vst3sdk

Steinberg's VST3 SDK, MIT-licensed as of v3.8.0 (Oct 2025 re-license — see
`docs/NATIVE_SHELL_PLAN.md` §3 for why this specific version matters; an older checkout may still
carry the retired GPLv3/proprietary terms).

Fetch it:

```
git clone --branch v3.8.1_build_84 --depth 1 --recurse-submodules --shallow-submodules \
  https://github.com/steinbergmedia/vst3sdk.git native/engine/third_party/vst3sdk
```

Verify the license before building against it:

```
head -5 native/engine/third_party/vst3sdk/LICENSE.txt
# should say "MIT License" / "Copyright (c) ... Steinberg Media Technologies GmbH"
```
