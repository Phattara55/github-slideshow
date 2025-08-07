import './style.css'
import * as THREE from 'three'
import { Howl } from 'howler'

// Canvas and renderer
const canvas = document.getElementById('game')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

// Scene and camera
const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x87ceeb, 50, 300)

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
scene.add(camera)

// Lighting
const hemiLight = new THREE.HemisphereLight(0xbfdffb, 0x335533, 0.6)
scene.add(hemiLight)
const dirLight = new THREE.DirectionalLight(0xffffff, 1)
dirLight.position.set(40, 60, 20)
dirLight.castShadow = true
const d = 80
Object.assign(dirLight.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 200 })
scene.add(dirLight)

// Ground
const groundGeo = new THREE.PlaneGeometry(800, 800)
const groundMat = new THREE.MeshLambertMaterial({ color: 0x88bb66 })
const ground = new THREE.Mesh(groundGeo, groundMat)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// Billboard texture maker (for 2D sprites like trees/grass)
function makeSpriteTexture(draw) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  draw(ctx, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  return tex
}

// Tree sprite
const treeTexture = makeSpriteTexture((ctx, s) => {
  ctx.clearRect(0, 0, s, s)
  // trunk
  ctx.fillStyle = '#5d3a1a'
  ctx.fillRect(s * 0.46, s * 0.65, s * 0.08, s * 0.3)
  // leaves layers
  ctx.fillStyle = '#2e7d32'
  ctx.beginPath(); ctx.moveTo(s * 0.2, s * 0.65); ctx.lineTo(s * 0.8, s * 0.65); ctx.lineTo(s * 0.5, s * 0.3); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#388e3c'
  ctx.beginPath(); ctx.moveTo(s * 0.28, s * 0.5); ctx.lineTo(s * 0.72, s * 0.5); ctx.lineTo(s * 0.5, s * 0.2); ctx.closePath(); ctx.fill()
})

function makeBillboard(texture, scale = 8) {
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(scale, scale, 1)
  sprite.position.y = scale * 0.5
  return sprite
}

// Scatter trees
const randRange = (min, max) => Math.random() * (max - min) + min
for (let i = 0; i < 120; i++) {
  const t = makeBillboard(treeTexture, randRange(6, 10))
  const r = randRange(60, 350)
  const a = Math.random() * Math.PI * 2
  t.position.set(Math.cos(a) * r, t.position.y, Math.sin(a) * r)
  scene.add(t)
}

// Grass sprites (simple tufts)
const grassTexture = makeSpriteTexture((ctx, s) => {
  ctx.clearRect(0, 0, s, s)
  ctx.fillStyle = '#4caf50'
  for (let i = 0; i < 6; i++) {
    const x = s * (0.2 + i * 0.12)
    const y = s * 0.75
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + s * 0.05, y)
    ctx.lineTo(x + s * 0.02, y - s * 0.15)
    ctx.closePath()
    ctx.fill()
  }
})
for (let i = 0; i < 400; i++) {
  const g = makeBillboard(grassTexture, randRange(1.5, 2.5))
  const r = randRange(20, 380)
  const a = Math.random() * Math.PI * 2
  g.position.set(Math.cos(a) * r, g.position.y * 0.3, Math.sin(a) * r)
  scene.add(g)
}

// Simple low-poly castle
function buildCastle() {
  const group = new THREE.Group()
  const stone = new THREE.MeshPhongMaterial({ color: 0xbababa, flatShading: true })
  const wallGeo = new THREE.BoxGeometry(20, 10, 20)
  const keep = new THREE.Mesh(wallGeo, stone)
  keep.castShadow = true; keep.receiveShadow = true
  keep.position.y = 5
  group.add(keep)

  // towers
  const towerGeo = new THREE.CylinderGeometry(4, 5, 16, 8)
  const towerMat = stone
  const towerPositions = [
    [10, 8, 10], [-10, 8, 10], [10, 8, -10], [-10, 8, -10]
  ]
  for (const [x, y, z] of towerPositions) {
    const t = new THREE.Mesh(towerGeo, towerMat)
    t.position.set(x, y, z)
    t.castShadow = true; t.receiveShadow = true
    group.add(t)
  }

  // gate
  const gateGeo = new THREE.BoxGeometry(8, 8, 4)
  const gate = new THREE.Mesh(gateGeo, new THREE.MeshPhongMaterial({ color: 0x8d6e63, flatShading: true }))
  gate.position.set(0, 4, 12)
  group.add(gate)

  // moat bridge
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 10), new THREE.MeshPhongMaterial({ color: 0x796548, flatShading: true }))
  bridge.position.set(0, 0.6, 18)
  bridge.castShadow = true
  group.add(bridge)

  // simple wall crenellations
  const crenel = new THREE.BoxGeometry(2, 2, 2)
  for (let i = -8; i <= 8; i += 4) {
    const c = new THREE.Mesh(crenel, stone)
    c.position.set(i, 11, 10)
    group.add(c)
    const c2 = c.clone(); c2.position.z = -10; group.add(c2)
    const c3 = c.clone(); c3.position.set(10, 11, i); group.add(c3)
    const c4 = c.clone(); c4.position.set(-10, 11, i); group.add(c4)
  }

  group.position.set(0, 0, 0)
  scene.add(group)
  return group
}

const castle = buildCastle()

// Basic first-person controls (pointer lock)
const keys = new Set()
let isPointerLocked = false
let yaw = 0
let pitch = 0
const player = new THREE.Object3D()
player.position.set(0, 2, 35)
scene.add(player)
player.add(camera)
camera.position.set(0, 1.4, 0)

// Add a simple bow attached to the camera (first-person view)
function buildBow() {
  const group = new THREE.Group()
  const bowMat = new THREE.MeshBasicMaterial({ color: 0x6b4f2a })
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.02, 8, 16, Math.PI), bowMat)
  arc.rotation.y = Math.PI / 2
  arc.rotation.x = Math.PI / 2
  group.add(arc)
  const stringGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.35, 0),
    new THREE.Vector3(0, -0.35, 0),
  ])
  const string = new THREE.Line(stringGeom, new THREE.LineBasicMaterial({ color: 0xdddddd }))
  group.add(string)
  group.position.set(0.45, -0.25, -0.8)
  group.rotation.set(0, 0.2, 0.05)
  return group
}
const bow = buildBow()
camera.add(bow)

function onMouseMove(e) {
  if (!isPointerLocked) return
  const sensitivity = 0.0025
  yaw -= e.movementX * sensitivity
  pitch -= e.movementY * sensitivity
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch))
}

function updateCamera() {
  player.rotation.y = yaw
  camera.rotation.x = pitch
}

function onKey(e, down) {
  const k = e.code
  if (down) keys.add(k); else keys.delete(k)
}

document.addEventListener('keydown', e => onKey(e, true))
document.addEventListener('keyup', e => onKey(e, false))

// Pointer lock handling
const instructions = document.getElementById('instructions')
canvas.addEventListener('click', async () => {
  if (!isPointerLocked) {
    await canvas.requestPointerLock()
    isPointerLocked = true
    instructions.style.display = 'none'
  } else {
    shootArrow()
  }
})
document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === canvas
  if (!isPointerLocked) instructions.style.display = 'block'
})
document.addEventListener('mousemove', onMouseMove)

// Movement
const velocity = new THREE.Vector3()
function updateMovement(dt) {
  const moveSpeed = 10
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion)
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(player.quaternion)
  forward.y = 0; forward.normalize()
  right.y = 0; right.normalize()
  let move = new THREE.Vector3()
  if (keys.has('KeyW')) move.add(forward)
  if (keys.has('KeyS')) move.add(forward.clone().multiplyScalar(-1))
  if (keys.has('KeyA')) move.add(right.clone().multiplyScalar(-1))
  if (keys.has('KeyD')) move.add(right)
  if (move.lengthSq() > 0) move.normalize()
  player.position.addScaledVector(move, moveSpeed * dt)
  player.position.y = 2
}

// Bow and arrows
const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0x222222 })
const arrowGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6)
const arrowTipGeo = new THREE.ConeGeometry(0.06, 0.2, 6)

const trailMaterial = new THREE.LineBasicMaterial({ color: 0xffdd55, transparent: true, opacity: 0.8 })

const activeArrows = []

function makeArrow() {
  const group = new THREE.Group()
  const shaft = new THREE.Mesh(arrowGeo, arrowMaterial)
  shaft.rotation.z = Math.PI / 2
  shaft.position.set(0.5, 0, 0)
  const tip = new THREE.Mesh(arrowTipGeo, new THREE.MeshBasicMaterial({ color: 0x888888 }))
  tip.rotation.z = -Math.PI / 2
  tip.position.set(1.1, 0, 0)
  group.add(shaft)
  group.add(tip)
  group.castShadow = true

  const trailGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
  const trail = new THREE.Line(trailGeo, trailMaterial.clone())
  group.userData.trail = trail
  scene.add(trail)
  return group
}

// Audio
const shootSfx = new Howl({ src: ['data:audio/wav;base64,UklGRl4AAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAZGF0YRIAAACAgICQkJCYmJiUlJSPj4+Tk5OUlJSMjIyPj4+UlJSSkpKS0tLT09PV1dXWFhYX19fYGBgY2NjZGRkZ2dnaGhoaG5ubnBwcHFxcYCAgIeHh4iIiImJiYqKipGRkZKSkpOTk5SUlJWVlZcXFxeXl5iYmJmZmZqamptbW1wcHB2dnZ8fHx9fX2AgICDg4OGhoaHh4eJiYmNjY2RkZGampqenp6goKCjo6OkpKSlJSUnJycqKioqampqtra2vr6+wsLC0tLS3t7e+vr7////'], volume: 0.3 })
const hitSfx = new Howl({ src: ['data:audio/wav;base64,UklGRmIAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAZGF0YSoAAACAgP///4CAgICAgP7+/v39/f7+/v///wAAAP///wD///8A////AP///wAAAAD///8A////AP///wAAAAD9/f3///8A////AAAAAP///wD///8A////AAAAAP///w=='], volume: 0.4 })
const dragonRoarSfx = new Howl({ src: ['data:audio/wav;base64,UklGRnYAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAZGF0YUsAAACAgICAgP7+/oCAgICAgICAgP7+/v///wAAAP///wAAAP7+/gAAAAD///8A////AAAAAP7+/gAAAAD///8A////AAAAAP7+/gAAAAD///8A////AAAAAP7+/gAAAAD///8='], volume: 0.25 })

function shootArrow() {
  if (!isPointerLocked) return
  const arrow = makeArrow()
  const origin = new THREE.Vector3()
  camera.getWorldPosition(origin)
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize()
  arrow.position.copy(origin)
  // Slight offset forward so it doesn't collide with player immediately
  arrow.position.addScaledVector(dir, 0.8)
  // Orient arrow to direction
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir)
  arrow.setRotationFromQuaternion(quat)
  scene.add(arrow)

  const speed = 55
  activeArrows.push({
    mesh: arrow,
    velocity: dir.clone().multiplyScalar(speed),
    life: 5,
  })
  shootSfx.play()
}

// Low-poly dragon (procedural)
function buildDragon() {
  const dragon = new THREE.Group()
  const mat = new THREE.MeshPhongMaterial({ color: 0x8a2a2a, flatShading: true })

  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 10), mat)
  body.position.set(0, 3, 0)
  body.castShadow = true; body.receiveShadow = true
  dragon.add(body)

  const head = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), mat)
  head.position.set(0, 3.5, 6)
  dragon.add(head)

  const jaw = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 1.4), mat)
  jaw.position.set(0, 2.9, 6.8)
  dragon.add(jaw)

  const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 6), mat)
  tail.position.set(0, 3, -8)
  dragon.add(tail)

  const wingGeo = new THREE.BoxGeometry(0.4, 6, 10)
  const leftWing = new THREE.Mesh(wingGeo, mat)
  leftWing.position.set(-2.2, 5, 1)
  leftWing.rotation.z = Math.PI / 4
  const rightWing = leftWing.clone()
  rightWing.position.x = 2.2
  rightWing.rotation.z = -Math.PI / 4
  dragon.add(leftWing, rightWing)

  const legGeo = new THREE.BoxGeometry(0.8, 2, 0.8)
  for (const [x, z] of [[-1, 3], [1, 3], [-1, 0], [1, 0]]) {
    const leg = new THREE.Mesh(legGeo, mat)
    leg.position.set(x, 2, z)
    dragon.add(leg)
  }

  dragon.position.set(0, 10, -40)
  scene.add(dragon)

  dragon.userData = {
    hp: 100,
    speed: 8,
    state: 'patrol', // 'patrol' | 'attack' | 'die'
    targetAngle: 0,
    flap: 0,
  }

  return dragon
}

const dragon = buildDragon()

document.getElementById('dragon-health').textContent = `Dragon HP: ${dragon.userData.hp}`

// Simple dragon AI: circle the castle, sometimes swoop towards player
let dragonTimer = 0
function updateDragon(dt) {
  if (dragon.userData.hp <= 0) return
  dragonTimer += dt
  const u = dragon.userData

  // Wing flap animation
  u.flap += dt * 6
  const flap = Math.sin(u.flap) * 0.4
  dragon.children.forEach((c) => {
    if (c.geometry && c.geometry.parameters && c.geometry.parameters.height === 6 && c.geometry.parameters.depth === 10) {
      // crude detection for wings created above
      c.rotation.z = (c.position.x < 0 ? Math.PI / 4 : -Math.PI / 4) + flap
    }
  })

  if (u.state === 'patrol') {
    const radius = 45
    const speed = 0.4
    const angle = dragonTimer * speed
    const height = 12 + Math.sin(dragonTimer * 0.8) * 2
    dragon.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
    dragon.lookAt(0, 5, 0)

    if (Math.random() < 0.01) {
      u.state = 'attack'
      dragonRoarSfx.play()
    }
  } else if (u.state === 'attack') {
    const toPlayer = player.position.clone().sub(dragon.position)
    const dist = toPlayer.length()
    const dir = toPlayer.normalize()
    dragon.position.addScaledVector(dir, u.speed * dt)
    dragon.lookAt(player.position.x, player.position.y + 1.5, player.position.z)
    if (dist < 5 || Math.random() < 0.01) {
      u.state = 'patrol'
    }
  }
}

// Collision detection helper
function lineSphereIntersect(p0, p1, center, radius) {
  const dir = p1.clone().sub(p0)
  const f = p0.clone().sub(center)
  const a = dir.dot(dir)
  const b = 2 * f.dot(dir)
  const c = f.dot(f) - radius * radius
  let discriminant = b * b - 4 * a * c
  if (discriminant < 0) return false
  discriminant = Math.sqrt(discriminant)
  const t1 = (-b - discriminant) / (2 * a)
  const t2 = (-b + discriminant) / (2 * a)
  if (t1 >= 0 && t1 <= 1) return true
  if (t2 >= 0 && t2 <= 1) return true
  return false
}

function updateArrows(dt) {
  for (let i = activeArrows.length - 1; i >= 0; i--) {
    const a = activeArrows[i]
    const prev = a.mesh.position.clone()
    a.mesh.position.addScaledVector(a.velocity, dt)

    // gravity
    a.velocity.y -= 9.8 * 0.6 * dt

    // orient
    const dir = a.velocity.clone().normalize()
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir)
    a.mesh.setRotationFromQuaternion(quat)

    // trail update
    const trail = a.mesh.userData.trail
    const points = [a.mesh.position.clone(), prev]
    trail.geometry.setFromPoints(points)
    trail.material.opacity = Math.max(0, trail.material.opacity - dt * 0.6)

    // collision with dragon (approx as sphere)
    if (dragon.userData.hp > 0) {
      const center = dragon.position.clone().add(new THREE.Vector3(0, 3, 0))
      const radius = 4
      if (lineSphereIntersect(prev, a.mesh.position, center, radius)) {
        dragon.userData.hp -= 10
        document.getElementById('dragon-health').textContent = `Dragon HP: ${Math.max(0, dragon.userData.hp)}`
        hitSfx.play()
        // small knockback
        dragon.position.add(dir.multiplyScalar(0.6))
        scene.remove(a.mesh)
        scene.remove(a.mesh.userData.trail)
        activeArrows.splice(i, 1)
        if (dragon.userData.hp <= 0) {
          dragon.userData.state = 'die'
          dragonFallTimer = 0
        }
        continue
      }
    }

    a.life -= dt
    if (a.life <= 0 || a.mesh.position.length() > 1000) {
      scene.remove(a.mesh)
      scene.remove(a.mesh.userData.trail)
      activeArrows.splice(i, 1)
    }
  }
}

// Dragon death animation
let dragonFallTimer = 0
function updateDragonDeath(dt) {
  if (dragon.userData.hp > 0) return
  dragonFallTimer += dt
  dragon.rotation.z += dt * 0.5
  dragon.position.y -= dt * 4
  if (dragon.position.y <= 0.5) {
    dragon.position.y = 0.5
  }
}

// Animate
let last = performance.now()
function animate() {
  requestAnimationFrame(animate)
  const now = performance.now()
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now

  updateCamera()
  updateMovement(dt)
  updateDragon(dt)
  updateArrows(dt)
  updateDragonDeath(dt)

  // subtle bow sway
  if (bow) {
    bow.position.y = -0.25 + Math.sin(now * 0.004) * 0.01
    bow.position.x = 0.45 + Math.cos(now * 0.003) * 0.008
  }

  renderer.setClearColor(scene.fog.color)
  renderer.render(scene, camera)
}
animate()

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
