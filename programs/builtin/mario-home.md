---
id: mario-home
name: "Mario Home (Ironmaster)"
author: Mario
url: "https://github.com/MarioAtoms/liftosaur"
shortDescription: "3-day home rotation for Ironmaster dumbbells and a kettlebell. Weights in lb."
isMultiweek: false
tags: []
frequency: 3
age: "more_than_year"
duration: "45-60"
goal: "hypertrophy"
---

Three-day home rotation for Ironmaster Quick-Lock dumbbells and an Ironmaster kettlebell. Legs, Push, Pull, then repeat. Weights are in pounds. Rest 60-90 seconds. Each day ends with a 5 minute shoulder reset.

<!-- more -->

Dumbbells load in 5 lb steps from 10 to 75 lb. The kettlebell loads in 2.5 lb steps from 25 lb. Every weighted jump in this program is +5 lb, which both tools can make.

Double progression: hit the top of the rep range on every set, then add 5 lb and start the range again. Push-ups and wall slides add a rep instead of weight.

The floor press is written as Bench Press, Dumbbell. Lie on the floor so the upper arms stop at the floor.

```liftoscript
# Week 1

// Rest 60-90 seconds between sets.
// Finish with the 5 min shoulder reset.
## Legs

// One kettlebell, held at the chest.
Goblet Squat, Kettlebell / 2x10 50lb 90s / warmup: none / progress: dp(5lb, 10, 10)

// 25 lb in each hand.
Romanian Deadlift, Dumbbell / 2x10 25lb 90s / warmup: none / progress: dp(5lb, 10, 10)

// 20 lb in each hand. Reps are per side.
Reverse Lunge, Dumbbell / 2x8-10 20lb 90s / warmup: none / progress: dp(5lb, 8, 10)

// 20 lb per dumbbell.
Standing Calf Raise, Dumbbell / 2x15 20lb 90s / warmup: none / progress: dp(5lb, 15, 20)

// Rest 60-90 seconds between sets.
// Finish with the 5 min shoulder reset.
## Push

// Floor press: lie on the floor so the upper arms stop at the floor. 25 lb each dumbbell.
Bench Press, Dumbbell / 2x10 25lb 90s / warmup: none / progress: dp(5lb, 10, 12)

// Neutral grip. Palms face each other. 25 lb each dumbbell.
Shoulder Press Parallel Grip, Dumbbell / 2x10 25lb 90s / warmup: none / progress: dp(5lb, 10, 12)

// 15 lb each dumbbell.
Lateral Raise, Dumbbell / 2x12 15lb 90s / warmup: none / progress: dp(5lb, 12, 15)

// Do as many as you can. The next target is one more than you just completed.
Push Up / 2x15+ 0lb 90s / warmup: none / progress: custom() {~
  for (var.i in completedReps) {
    if (completedReps[var.i] >= reps[var.i]) {
      reps[var.i] = completedReps[var.i] + 1
    }
  }
~}

// Rest 60-90 seconds between sets.
// Finish with the 5 min shoulder reset.
## Pull

// One dumbbell. Reps are per side.
Bent Over One Arm Row, Dumbbell / 3x10 25lb 90s / warmup: none / progress: dp(5lb, 10, 12)

// 15 lb each dumbbell.
Reverse Fly, Dumbbell / 2x12-15 15lb 90s / warmup: none / progress: dp(5lb, 12, 15)

// Back and arms on the wall. Slide the hands up and down.
Wall Slide / 2x12 0lb 90s / warmup: none / progress: custom() {~
  for (var.i in completedReps) {
    if (completedReps[var.i] >= reps[var.i]) {
      reps[var.i] = reps[var.i] + 1
    }
  }
~}

// 25 lb each dumbbell.
Hammer Curl, Dumbbell / 2x10-12 25lb 90s / warmup: none / progress: dp(5lb, 10, 12)
```
