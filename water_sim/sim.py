#!/usr/bin/env python3
import argparse
import math
import sys
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Tuple

import numpy as np

try:
    import pygame
except Exception as e:  # pragma: no cover
    print("Failed to import pygame. Please install dependencies: pip install -r requirements.txt", file=sys.stderr)
    raise

try:
    import cv2
except Exception as e:  # pragma: no cover
    print("Failed to import opencv (cv2). Please install dependencies: pip install -r requirements.txt", file=sys.stderr)
    raise

try:
    import mediapipe as mp  # type: ignore
    HAS_MEDIAPIPE = True
except Exception:
    mp = None  # type: ignore
    HAS_MEDIAPIPE = False


@dataclass
class SimulationConfig:
    width: int = 960
    height: int = 540
    num_particles: int = 1500
    smoothing_length: float = 16.0  # h
    rest_density: float = 1000.0
    particle_mass: float = 1.0
    gas_constant: float = 2200.0  # k (pressure stiffness)
    viscosity: float = 250.0
    gravity: Tuple[float, float] = (0.0, 1200.0)
    wall_damping: float = -0.5
    substeps: int = 1
    max_fps: int = 60
    camera_index: int = 0
    mirror_cam: bool = True
    enable_mouse: bool = False
    max_seconds: float = 0.0


class SpatialHashGrid:
    def __init__(self, cell_size: float):
        self.cell_size = cell_size
        self.cells: Dict[Tuple[int, int], List[int]] = defaultdict(list)

    def clear(self) -> None:
        self.cells.clear()

    def _cell_coords(self, x: float, y: float) -> Tuple[int, int]:
        return int(x // self.cell_size), int(y // self.cell_size)

    def insert(self, index: int, position: np.ndarray) -> None:
        cx, cy = self._cell_coords(position[0], position[1])
        self.cells[(cx, cy)].append(index)

    def query_neighbors(self, position: np.ndarray) -> List[int]:
        cx, cy = self._cell_coords(position[0], position[1])
        neighbors: List[int] = []
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                neighbors.extend(self.cells.get((cx + ox, cy + oy), ()))
        return neighbors


class SPHSimulator:
    def __init__(self, config: SimulationConfig):
        self.cfg = config
        self.num_particles = config.num_particles
        self.positions = np.zeros((self.num_particles, 2), dtype=np.float32)
        self.velocities = np.zeros((self.num_particles, 2), dtype=np.float32)
        self.accelerations = np.zeros((self.num_particles, 2), dtype=np.float32)
        self.densities = np.zeros((self.num_particles,), dtype=np.float32)
        self.pressures = np.zeros((self.num_particles,), dtype=np.float32)
        self.grid = SpatialHashGrid(config.smoothing_length)
        self._init_particles()

        # Precompute kernel constants
        h = self.cfg.smoothing_length
        self.h = h
        self.h2 = h * h
        self.poly6_const = 315.0 / (64.0 * math.pi * h ** 9)
        self.spiky_grad_const = -45.0 / (math.pi * h ** 6)
        self.visc_laplacian_const = 45.0 / (math.pi * h ** 6)

    def _init_particles(self) -> None:
        w, h = self.cfg.width, self.cfg.height
        margin = 4
        cols = int((w - 2 * margin) // (self.cfg.smoothing_length * 0.7))
        rows = max(1, self.num_particles // max(1, cols))
        x_positions = []
        y_positions = []
        count = 0
        for r in range(rows):
            for c in range(cols):
                if count >= self.num_particles:
                    break
                x = margin + c * (self.cfg.smoothing_length * 0.7) + (r % 2) * 2.0
                y = h * 0.2 + r * (self.cfg.smoothing_length * 0.7)
                if x >= w - margin or y >= h - margin:
                    continue
                x_positions.append(x)
                y_positions.append(y)
                count += 1
            if count >= self.num_particles:
                break
        if count < self.num_particles:
            # Fill any remaining with random positions near top
            rng = np.random.default_rng()
            extra = self.num_particles - count
            x_extra = rng.uniform(margin, w - margin, size=extra)
            y_extra = rng.uniform(margin, h * 0.4, size=extra)
            x_positions.extend(x_extra.tolist())
            y_positions.extend(y_extra.tolist())
        self.positions[:, 0] = np.array(x_positions[: self.num_particles], dtype=np.float32)
        self.positions[:, 1] = np.array(y_positions[: self.num_particles], dtype=np.float32)
        self.velocities[:] = 0

    def _compute_densities_and_pressures(self) -> None:
        self.grid.clear()
        for i in range(self.num_particles):
            self.grid.insert(i, self.positions[i])
        h2 = self.h2
        self.densities.fill(0.0)
        for i in range(self.num_particles):
            pos_i = self.positions[i]
            density_i = 0.0
            for j in self.grid.query_neighbors(pos_i):
                r_vec = pos_i - self.positions[j]
                r2 = float(r_vec[0] * r_vec[0] + r_vec[1] * r_vec[1])
                if r2 < h2:
                    term = (h2 - r2)
                    density_i += self.cfg.particle_mass * self.poly6_const * term * term * term
            self.densities[i] = max(density_i, self.cfg.rest_density * 0.2)  # avoid zero
        # Pressure via equation of state
        self.pressures = self.cfg.gas_constant * (self.densities - self.cfg.rest_density)
        self.pressures = np.maximum(self.pressures, 0.0)

    def _compute_forces(self) -> None:
        self.accelerations.fill(0.0)
        h = self.h
        for i in range(self.num_particles):
            pos_i = self.positions[i]
            vel_i = self.velocities[i]
            pressure_force = np.zeros(2, dtype=np.float32)
            viscosity_force = np.zeros(2, dtype=np.float32)
            for j in self.grid.query_neighbors(pos_i):
                if i == j:
                    continue
                r_vec = pos_i - self.positions[j]
                r = float(np.linalg.norm(r_vec))
                if r <= 1e-5 or r >= h:
                    continue
                # Pressure force
                grad = self.spiky_grad_const * (h - r) ** 2 * (r_vec / r)
                pressure_term = (self.pressures[i] + self.pressures[j]) / (2.0 * self.densities[j])
                pressure_force += -self.cfg.particle_mass * pressure_term * grad
                # Viscosity force
                laplacian = self.visc_laplacian_const * (h - r)
                viscosity_force += self.cfg.viscosity * self.cfg.particle_mass * (self.velocities[j] - vel_i) * (laplacian / self.densities[j])
            # Gravity
            gravity_force = np.array(self.cfg.gravity, dtype=np.float32) * self.densities[i]
            total_force = pressure_force + viscosity_force + gravity_force
            self.accelerations[i] = total_force / max(self.densities[i], 1e-5)

    def _integrate(self, dt: float) -> None:
        # Semi-implicit Euler
        self.velocities += self.accelerations * dt
        self.positions += self.velocities * dt

        # Boundary collisions
        w, h = self.cfg.width, self.cfg.height
        bounce = self.cfg.wall_damping
        radius = 2.0
        for i in range(self.num_particles):
            x, y = self.positions[i]
            vx, vy = self.velocities[i]
            if x < radius:
                x = radius
                vx *= bounce
            elif x > w - radius:
                x = w - radius
                vx *= bounce
            if y < radius:
                y = radius
                vy *= bounce
            elif y > h - radius:
                y = h - radius
                vy *= bounce
            self.positions[i] = (x, y)
            self.velocities[i] = (vx, vy)

    def step(self, dt: float) -> None:
        dt_per_sub = dt / max(1, self.cfg.substeps)
        for _ in range(max(1, self.cfg.substeps)):
            self._compute_densities_and_pressures()
            self._compute_forces()
            self._integrate(dt_per_sub)

    def apply_repulsor(self, center: Tuple[float, float], radius: float, velocity: Tuple[float, float]) -> None:
        if radius <= 0:
            return
        cx, cy = center
        rvx, rvy = velocity
        r2 = radius * radius
        for i in range(self.num_particles):
            dx = self.positions[i, 0] - cx
            dy = self.positions[i, 1] - cy
            d2 = dx * dx + dy * dy
            if d2 < r2:
                d = math.sqrt(max(d2, 1e-6))
                nx = dx / d
                ny = dy / d
                # Push out proportionally to penetration depth
                depth = (radius - d)
                push = depth * 8.0  # strength
                self.velocities[i, 0] += nx * push + rvx * 0.35
                self.velocities[i, 1] += ny * push + rvy * 0.35


class MediapipeHandTracker:
    def __init__(self, camera_index: int, mirror: bool = True):
        if not HAS_MEDIAPIPE:
            raise RuntimeError("mediapipe not available")
        self.cap = cv2.VideoCapture(camera_index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Failed to open camera index {camera_index}")
        self.mirror = mirror
        self.mp_hands = mp.solutions.hands  # type: ignore[attr-defined]
        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            model_complexity=1,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.center_history: Dict[int, Deque[Tuple[float, float]]] = {}

    def read_hand_repulsors(self, target_size: Tuple[int, int]) -> List[Tuple[Tuple[float, float], float, Tuple[float, float]]]:
        ok, frame = self.cap.read()
        if not ok or frame is None:
            return []
        frame_h, frame_w = frame.shape[:2]
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(frame_rgb)
        repulsors: List[Tuple[Tuple[float, float], float, Tuple[float, float]]] = []
        if results.multi_hand_landmarks:
            for hand_idx, hand_landmarks in enumerate(results.multi_hand_landmarks):
                # Compute palm center as average of wrist and MCP joints
                indices = [0, 5, 9, 13, 17]
                xs = [hand_landmarks.landmark[i].x * frame_w for i in indices]
                ys = [hand_landmarks.landmark[i].y * frame_h for i in indices]
                center_x = float(sum(xs) / len(xs))
                center_y = float(sum(ys) / len(ys))
                # Radius proportional to spread
                dists = [math.hypot((hand_landmarks.landmark[i].x * frame_w) - center_x,
                                    (hand_landmarks.landmark[i].y * frame_h) - center_y) for i in indices]
                radius = float(sum(dists) / len(dists)) * 1.4

                if self.mirror:
                    center_x = frame_w - center_x
                target_w, target_h = target_size
                sim_x = center_x * (target_w / frame_w)
                sim_y = center_y * (target_h / frame_h)

                hist: Deque[Tuple[float, float]] = self.center_history.setdefault(hand_idx, deque(maxlen=4))
                hist.append((sim_x, sim_y))
                v_x, v_y = 0.0, 0.0
                if len(hist) >= 2:
                    sx0, sy0 = hist[0]
                    sx1, sy1 = hist[-1]
                    v_x = (sx1 - sx0) * 10.0 / max(1, len(hist) - 1)
                    v_y = (sy1 - sy0) * 10.0 / max(1, len(hist) - 1)

                sim_radius = radius * (target_w / frame_w)
                repulsors.append(((sim_x, sim_y), sim_radius, (v_x, v_y)))
        return repulsors

    def release(self) -> None:
        try:
            self.cap.release()
        except Exception:
            pass
        try:
            self.hands.close()
        except Exception:
            pass


class MotionTracker:
    def __init__(self, camera_index: int, mirror: bool = True):
        self.cap = cv2.VideoCapture(camera_index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Failed to open camera index {camera_index}")
        self.mirror = mirror
        self.bg_sub = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=25, detectShadows=False)
        self.center_history: Deque[Tuple[float, float]] = deque(maxlen=4)

    def read_hand_repulsors(self, target_size: Tuple[int, int]) -> List[Tuple[Tuple[float, float], float, Tuple[float, float]]]:
        ok, frame = self.cap.read()
        if not ok or frame is None:
            return []
        frame_h, frame_w = frame.shape[:2]
        if self.mirror:
            frame = cv2.flip(frame, 1)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        fgmask = self.bg_sub.apply(gray)
        # Remove noise
        fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        fgmask = cv2.dilate(fgmask, np.ones((5, 5), np.uint8), iterations=1)
        contours, _ = cv2.findContours(fgmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return []
        cnt = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(cnt)
        if area < (frame_w * frame_h * 0.002):  # ignore tiny motion
            return []
        (cx, cy), radius = cv2.minEnclosingCircle(cnt)
        target_w, target_h = target_size
        sim_x = float(cx) * (target_w / frame_w)
        sim_y = float(cy) * (target_h / frame_h)
        self.center_history.append((sim_x, sim_y))
        v_x, v_y = 0.0, 0.0
        if len(self.center_history) >= 2:
            sx0, sy0 = self.center_history[0]
            sx1, sy1 = self.center_history[-1]
            v_x = (sx1 - sx0) * 10.0 / max(1, len(self.center_history) - 1)
            v_y = (sy1 - sy0) * 10.0 / max(1, len(self.center_history) - 1)
        sim_radius = float(radius) * (target_w / frame_w) * 1.2
        return [((sim_x, sim_y), sim_radius, (v_x, v_y))]

    def release(self) -> None:
        try:
            self.cap.release()
        except Exception:
            pass


def draw_particles(surface: pygame.Surface, positions: np.ndarray) -> None:
    color = (100, 160, 255)
    radius = 2
    for i in range(positions.shape[0]):
        x = int(positions[i, 0])
        y = int(positions[i, 1])
        pygame.draw.circle(surface, color, (x, y), radius)


def draw_repulsors(surface: pygame.Surface, repulsors: List[Tuple[Tuple[float, float], float]]):
    overlay = pygame.Surface(surface.get_size(), pygame.SRCALPHA)
    for (cx, cy), r in repulsors:
        pygame.draw.circle(overlay, (255, 255, 255, 40), (int(cx), int(cy)), int(max(1, r)), width=0)
        pygame.draw.circle(overlay, (255, 255, 255, 120), (int(cx), int(cy)), int(max(1, r)), width=2)
    surface.blit(overlay, (0, 0))


def run(config: SimulationConfig) -> None:
    pygame.init()
    pygame.display.set_caption("2D Water Particles + Webcam Hand Interaction")
    screen = pygame.display.set_mode((config.width, config.height))
    clock = pygame.time.Clock()

    simulator = SPHSimulator(config)

    tracker: Optional[object] = None
    if not config.enable_mouse:
        try:
            if HAS_MEDIAPIPE:
                tracker = MediapipeHandTracker(config.camera_index, mirror=config.mirror_cam)
            else:
                tracker = MotionTracker(config.camera_index, mirror=config.mirror_cam)
        except Exception as e:
            print(f"Warning: {e}. Falling back to mouse interaction.")
            tracker = None
            config.enable_mouse = True

    font = pygame.font.SysFont("monospace", 14)

    running = True
    last_time = time.time()
    start_time = last_time

    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    running = False
                elif event.key == pygame.K_r:
                    simulator._init_particles()

        now = time.time()
        dt = now - last_time
        last_time = now
        dt = max(1e-3, min(dt, 1.0 / 30.0))

        repulsor_visuals: List[Tuple[Tuple[float, float], float]] = []
        if config.enable_mouse:
            mx, my = pygame.mouse.get_pos()
            pressed = pygame.mouse.get_pressed()[0]
            radius = 60.0 if pressed else 40.0
            rel = pygame.mouse.get_rel()
            repulsor = ((float(mx), float(my)), radius, (float(rel[0]) * 60.0, float(rel[1]) * 60.0))
            simulator.apply_repulsor(*repulsor)
            repulsor_visuals.append(((float(mx), float(my)), radius))
        else:
            assert tracker is not None
            repulsors = tracker.read_hand_repulsors((config.width, config.height))  # type: ignore[attr-defined]
            for center, radius, velocity in repulsors:
                simulator.apply_repulsor(center, radius, velocity)
                repulsor_visuals.append((center, radius))

        simulator.step(dt)

        screen.fill((10, 12, 18))
        draw_particles(screen, simulator.positions)
        draw_repulsors(screen, repulsor_visuals)

        fps = clock.get_fps()
        interaction_text = (
            "Interaction: Webcam (MediaPipe)" if (not config.enable_mouse and HAS_MEDIAPIPE) else
            "Interaction: Webcam (Motion)" if (not config.enable_mouse and not HAS_MEDIAPIPE) else
            "Interaction: Mouse (hold LMB = stronger)"
        )
        hud_lines = [
            f"Particles: {simulator.num_particles}",
            f"FPS: {fps:5.1f}",
            interaction_text,
            "Keys: ESC quit, R reset",
        ]
        y = 6
        for line in hud_lines:
            surf = font.render(line, True, (220, 230, 240))
            screen.blit(surf, (8, y))
            y += surf.get_height() + 2

        pygame.display.flip()
        clock.tick(config.max_fps)

        if config.max_seconds > 0 and (time.time() - start_time) >= config.max_seconds:
            running = False

    if tracker is not None and hasattr(tracker, "release"):
        try:
            tracker.release()  # type: ignore[attr-defined]
        except Exception:
            pass
    pygame.quit()


def parse_args(argv: Optional[List[str]] = None) -> SimulationConfig:
    parser = argparse.ArgumentParser(description="2D SPH-like water simulation with webcam hand interaction")
    parser.add_argument("--width", type=int, default=960, help="Window width")
    parser.add_argument("--height", type=int, default=540, help="Window height")
    parser.add_argument("--num_particles", type=int, default=1500, help="Number of water particles")
    parser.add_argument("--h", dest="smoothing_length", type=float, default=16.0, help="Smoothing length (kernel radius)")
    parser.add_argument("--fps", dest="max_fps", type=int, default=60, help="Max FPS cap")
    parser.add_argument("--camera", type=int, default=0, help="Webcam index to use")
    parser.add_argument("--no-mirror", action="store_true", help="Disable horizontal mirroring of webcam input")
    parser.add_argument("--mouse", action="store_true", help="Use mouse interaction instead of webcam (fallback)")
    parser.add_argument("--max-seconds", dest="max_seconds", type=float, default=0.0, help="Auto-exit after this many seconds (0 = run until quit)")

    args = parser.parse_args(argv)
    cfg = SimulationConfig(
        width=args.width,
        height=args.height,
        num_particles=args.num_particles,
        smoothing_length=args.smoothing_length,
        max_fps=args.max_fps,
        camera_index=args.camera,
        mirror_cam=not args.no_mirror,
        enable_mouse=args.mouse,
        max_seconds=args.max_seconds,
    )
    if cfg.smoothing_length < 12:
        cfg.substeps = 2
    elif cfg.smoothing_length < 8:
        cfg.substeps = 3
    else:
        cfg.substeps = 1
    return cfg


if __name__ == "__main__":
    config = parse_args()
    run(config)