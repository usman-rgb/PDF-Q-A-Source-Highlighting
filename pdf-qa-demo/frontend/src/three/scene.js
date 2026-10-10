/**
 * Three.js particle-network background.
 * This is the single visual centrepiece — everything else defers to it.
 * Rendered into a fixed canvas behind the UI.
 */
import * as THREE from "three";
const PARTICLE_COUNT = 1800;
const SPREAD = 90;
const CONNECT_DIST = 14;
const MAX_LINES_PER_PARTICLE = 3;
export class BackgroundScene {
    renderer;
    scene;
    camera;
    particles;
    raf = 0;
    clock = new THREE.Clock();
    constructor(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);
        this.camera.position.z = 35;
        this.resize();
        this.buildParticles();
        this.buildLines();
        this.loop();
        window.addEventListener("resize", () => this.resize());
    }
    resize() {
        this.renderer.setSize(innerWidth, innerHeight);
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
    }
    buildParticles() {
        const pos = new Float32Array(PARTICLE_COUNT * 3);
        const col = new Float32Array(PARTICLE_COUNT * 3);
        const palette = [
            new THREE.Color("#5B6EF5"),
            new THREE.Color("#818cf8"),
            new THREE.Color("#a5b4fc"),
            new THREE.Color("#2DD4BF"),
        ];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            pos[i * 3] = (Math.random() - 0.5) * SPREAD;
            pos[i * 3 + 1] = (Math.random() - 0.5) * SPREAD;
            pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
            const c = palette[Math.floor(Math.random() * palette.length)];
            col[i * 3] = c.r;
            col[i * 3 + 1] = c.g;
            col[i * 3 + 2] = c.b;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.25,
            vertexColors: true,
            transparent: true,
            opacity: 0.55,
            sizeAttenuation: true,
        }));
        this.scene.add(this.particles);
    }
    buildLines() {
        const pos = this.particles.geometry.getAttribute("position").array;
        const verts = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            let links = 0;
            for (let j = i + 1; j < PARTICLE_COUNT && links < MAX_LINES_PER_PARTICLE; j++) {
                const dx = pos[i * 3] - pos[j * 3];
                const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
                const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) < CONNECT_DIST) {
                    verts.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
                    links++;
                }
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
        this.scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            color: "#5B6EF5",
            transparent: true,
            opacity: 0.07,
        })));
    }
    loop() {
        this.raf = requestAnimationFrame(() => this.loop());
        const t = this.clock.getElapsedTime();
        this.particles.rotation.y = t * 0.025;
        this.particles.rotation.x = Math.sin(t * 0.015) * 0.08;
        this.renderer.render(this.scene, this.camera);
    }
    /** Intensify particles during active query — single purposeful state change. */
    pulseQuery(active) {
        const mat = this.particles.material;
        mat.opacity = active ? 0.85 : 0.55;
        mat.size = active ? 0.38 : 0.25;
    }
    dispose() {
        cancelAnimationFrame(this.raf);
        this.renderer.dispose();
    }
}
