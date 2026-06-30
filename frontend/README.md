# Machiner frontend

## Train the minimal melee base

Start the frontend, open the practice arena at `/beta`, add an opponent model,
and click **Train Base**. Base authoring uses generated states:

- rotation learns to face a nearby opponent;
- swing learns to fire only while aligned, in range, and off cooldown;
- movement starts neutral;
- block starts disabled.

The base control is disabled during rated match training. **Approve + Export**
produces a versioned class artifact for `frontend/public/models/`. Class base
models, feature schemas, action schemas, and trainers must remain separate.

## Supervised melee strategy training

Players choose a movement style, preferred distance, and whether the fighter
should attack or block at close range. The browser converts that structured
recipe into a direction-balanced synthetic dataset using relative opponent
positions. No arbitrary code or reward expressions are executed.

Each run is capped at 2,048 generated examples, 30 epochs, and 15 seconds. A
deterministic 80/20 train/validation split reports training and validation loss
plus action accuracy. Generated examples and TensorFlow tensors are discarded
immediately after the run; only aggregate metrics and the trained model remain.

Clean Play and rated evaluation are deterministic and never enable
training-only exploration.

```bash
npm run dev
npm test
npm run lint
npm run build
```
