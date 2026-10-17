# Licence audit

Checked 2026-08-24 by reading the actual LICENSE files, not the model cards. That
distinction is the whole reason this file exists: the Hunyuan3D model card was
silent about its territory clause while the LICENSE excluded the UK, EU and South Korea outright.

## The chain this skill depends on

| Component | What it does | Licence | Territory clause |
|---|---|---|---|
| Hi3DGen / Stable3DGen (code) | the pipeline | **MIT**, Copyright (c) 2025 **Bytedance Inc.** | none |
| `Stable-X/trellis-normal-v0-1` | the 3D generation weights | **MIT** | none |
| StableNormal (code) | image to normal map | **Apache-2.0** | none |
| `Stable-X/yoso-normal-v1-8-1` | normal weights | **Apache-2.0** | none |
| TRELLIS (Microsoft) | what Hi3DGen fine-tunes | MIT | none |

**Verdict: clear for commercial use, with no territory clause.** Check the clause against where you live yourself. The authors also removed the
NVIDIA kaolin / nvdiffrast / flexicube dependencies specifically so the adapted
version could be used commercially, which is a deliberate signal rather than an
accident of licensing.

## What is blocked, and stays blocked

**Every Tencent Hunyuan community licence excludes the UK.** Hunyuan3D-2.1,
HY-Motion 1.0 and HunyuanVideo all carry it. Verbatim:

> THIS LICENSE AGREEMENT DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM
> AND SOUTH KOREA

and the operative restriction closes the hosted-inference loophole:

> You must not use, reproduce, modify, distribute, or display the ... Works,
> **Output or results** of the Works outside the Territory.

The restriction covers the **output**, so running it on someone else's GPU and
pulling the mesh into a project in an excluded region is still a breach. Do not spend time evaluating
a Tencent Hunyuan model from an excluded region (the UK, EU or South Korea).

## The rule this produced

Read the LICENSE file, not the model card, and not the marketing site. A silent
model card is not evidence of absence: hunyuanmotion.net says "commercial ready"
and says nothing about territory.

## Alternatives, if Hi3DGen ever goes away

- **TRELLIS.2-4B** (Microsoft, MIT) - emits full PBR, outputs GLB, runs on the
  official ZeroGPU Space
- **TripoSR** (MIT) - sub-second, ~6GB VRAM, has a CPU path
