#!/usr/bin/env python3
"""Self-check for sam_runner_cuda.seed_prompt — no GPU, no model, no test framework.

Run it with the SAM venv's python (the only env the runner ever runs in):

    $KINO_SAM_PYTHON scripts/test_sam_seed.py

Covers the seeding logic that decides which frame the text prompt is anchored to. The
GPU work it drives is untestable here, but the probe schedule is exactly where an
off-by-one silently costs you the head of every clip.
"""
import sys
from os.path import dirname, abspath

sys.path.insert(0, dirname(abspath(__file__)))
from sam_runner_cuda import seed_prompt, SEED_PROBES


class FakePredictor:
    """Detects on frames in `hits`; records every frame probed."""

    def __init__(self, hits):
        self.hits = hits
        self.probed = []

    def handle_request(self, req):
        f = req["frame_index"]
        self.probed.append(f)
        return {"outputs": {"out_obj_ids": [7] if f in self.hits else []}}


def check(name, cond):
    assert cond, f"FAIL: {name}"
    print(f"  ok  {name}")


# Frame 0 detects -> seed there, and do not waste detector passes on later frames.
p = FakePredictor(hits={0, 30})
check("seeds at 0 when frame 0 detects", seed_prompt(p, "s", "x", 60) == 0)
check("stops probing once seeded", p.probed == [0])

# Frame 0 detects nothing -> keep probing, seed on the first frame that does.
# (The real-world case: a wave that has not broken yet at t=0.)
p = FakePredictor(hits=set(range(23, 60)))
seed = seed_prompt(p, "s", "x", 60)
check("seeds past frame 0 when 0 is empty", seed is not None and seed >= 23)
check("probed frame 0 first", p.probed[0] == 0)
check("probe count stays bounded", len(p.probed) <= SEED_PROBES + 1)

# Nothing anywhere -> None, so the caller can fail cleanly instead of writing a blank mask.
p = FakePredictor(hits=set())
check("returns None when nothing detects", seed_prompt(p, "s", "x", 60) is None)

# Only the very last frame detects — the probe schedule must actually reach it.
n = 60
p = FakePredictor(hits={n - 1})
check("reaches the final frame", seed_prompt(p, "s", "x", n) == n - 1)

# Degenerate clips must not divide by zero or loop forever.
for n in (1, 2, 3):
    p = FakePredictor(hits={n - 1})
    check(f"handles a {n}-frame clip", seed_prompt(p, "s", "x", n) == n - 1)

print("all seed_prompt checks passed")
