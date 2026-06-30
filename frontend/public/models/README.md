# Approved base models

Each class owns a versioned directory and one self-contained exported artifact:

```text
models/
  melee-base-v4/
    melee-base-v4.base-model.json
  melee-base-v3/
    melee-base-v3.base-model.json
  melee-base-v2/
    melee-base-v2.base-model.json
  melee-base-v1/
    melee-base-v1.base-model.json
  ranged-base-v1/
    ranged-base-v1.base-model.json
```

`melee-base-v4` is the current approved artifact. Earlier versions remain for
contract history.

Generate an artifact from the practice arena with **Train Base**, review it,
then select **Approve + Export**. Do not hand-edit the exported file: its model
topology and weights are protected by the embedded SHA-256 digest.
