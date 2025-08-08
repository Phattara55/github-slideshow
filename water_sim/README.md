# 2D Water Particles + Webcam Hand Interaction

A simple SPH-like 2D water particle simulation rendered with Pygame, with interaction via a webcam-tracked hand using MediaPipe. Also supports mouse interaction as fallback.

## Requirements
- Python 3.9+
- A working webcam (for hand interaction)
- Linux/macOS/Windows (SDL dependencies may be required for Pygame on Linux)

## Setup
```bash
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\\Scripts\\activate
pip install --upgrade pip
pip install -r requirements.txt
```

## Run (Webcam)
```bash
python sim.py --width 960 --height 540 --num_particles 1500 --camera 0
```
- By default, the webcam image is mirrored horizontally for a more natural interaction. Disable with `--no-mirror`.

## Run (Mouse fallback)
```bash
python sim.py --mouse
```
- Left mouse button increases repulsor strength.

## Controls
- ESC: Quit
- R: Reset particles

## Tips
- If performance is low, lower `--num_particles` (e.g., 800) or increase `--h` (e.g., 20).
- For small `--h`, the sim increases substeps automatically for stability.