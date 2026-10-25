import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, Lightformer } from '@react-three/drei';
import * as THREE from 'three';

const VIOLET = '#8B5CF6';
const CYAN = '#22D3EE';

/** Deterministic pseudo-random so the layout is stable between renders. */
function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

/** Small spheres scattered on a shell, connected to their nearest neighbours — a "people network". */
function PeopleNetwork({ count, radius }) {
  const { positions, lines } = useMemo(() => {
    const random = seeded(42);
    const points = Array.from({ length: count }, () => {
      const u = random() * 2 - 1;
      const t = random() * Math.PI * 2;
      const r = radius * (0.92 + random() * 0.2);
      const s = Math.sqrt(1 - u * u);
      return new THREE.Vector3(r * s * Math.cos(t), r * u, r * s * Math.sin(t));
    });
    const segments = [];
    points.forEach((a, i) => {
      points
        .map((b, j) => ({ j, d: a.distanceTo(b) }))
        .filter((item) => item.j > i)
        .sort((x, y) => x.d - y.d)
        .slice(0, 2)
        .forEach((item) => segments.push(a, points[item.j]));
    });
    return { positions: points, lines: new THREE.BufferGeometry().setFromPoints(segments) };
  }, [count, radius]);
  return (
    <group>
      {positions.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.045 + (i % 3) * 0.015, 16, 16]} />
          <meshStandardMaterial color={i % 2 ? CYAN : '#C4B5FD'} emissive={i % 2 ? CYAN : VIOLET} emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      ))}
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#A78BFA" transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

function Core({ pointer, animate, compact }) {
  const group = useRef();
  const rings = useRef([]);
  const network = useRef();
  useFrame((state, delta) => {
    if (!group.current) return;
    const d = animate ? Math.min(delta, 0.05) : 0;
    // ease towards the pointer for a soft parallax tilt
    const targetY = pointer.current.x * 0.5;
    const targetX = -pointer.current.y * 0.35;
    group.current.rotation.y += (targetY - group.current.rotation.y) * Math.min(1, d * 3);
    group.current.rotation.x += (targetX - group.current.rotation.x) * Math.min(1, d * 3);
    if (network.current) network.current.rotation.y += d * 0.18;
    rings.current.forEach((ring, index) => {
      if (ring) ring.rotation.z += d * (0.12 + index * 0.07) * (index % 2 ? -1 : 1);
    });
  });
  return (
    <group ref={group} scale={compact ? 0.92 : 1}>
      <Float speed={animate ? 1.4 : 0} rotationIntensity={0.25} floatIntensity={0.6}>
        {/* faceted glass-like core */}
        <mesh>
          <icosahedronGeometry args={[0.9, 1]} />
          <meshStandardMaterial color="#6D4AE0" metalness={0.3} roughness={0.5} flatShading envMapIntensity={0.55} />
        </mesh>
        <mesh scale={1.02}>
          <icosahedronGeometry args={[0.9, 1]} />
          <meshBasicMaterial color="#C4B5FD" wireframe transparent opacity={0.22} />
        </mesh>
        {/* inner glow */}
        <mesh scale={0.5}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshBasicMaterial color={CYAN} transparent opacity={0.55} toneMapped={false} />
        </mesh>
        {/* orbiting rings */}
        {[1.35, 1.7, 2.05].map((r, index) => (
          <group key={r} rotation={[Math.PI / 2 + (index - 1) * 0.55, index * 0.4, 0]}>
            <mesh ref={(node) => { rings.current[index] = node; }}>
              <torusGeometry args={[r, 0.012 + index * 0.004, 12, 160]} />
              <meshStandardMaterial color={index === 1 ? CYAN : '#A78BFA'} emissive={index === 1 ? CYAN : VIOLET} emissiveIntensity={0.9} toneMapped={false} />
            </mesh>
          </group>
        ))}
        <group ref={network}>
          <PeopleNetwork count={compact ? 18 : 26} radius={compact ? 1.9 : 2.2} />
        </group>
      </Float>
    </group>
  );
}

export default function OrbScene({ active = true, reduced = false, compact = false }) {
  const pointer = useRef({ x: 0, y: 0 });
  const animate = active && !reduced;
  return (
    <Canvas
      className="scene-canvas"
      dpr={[1, compact ? 1.5 : 1.75]}
      frameloop={animate ? 'always' : 'demand'}
      camera={{ position: [0, 0, compact ? 5.6 : 7.4], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onPointerMove={(event) => {
        const rect = event.target.getBoundingClientRect?.();
        if (!rect) return;
        pointer.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.current.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={0.9} color="#ffffff" />
      <pointLight position={[-4, -2, 3]} intensity={30} color={CYAN} />
      <pointLight position={[4, 2, -2]} intensity={24} color={VIOLET} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 4, 3]} scale={[8, 2, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.4} position={[-5, 0, 2]} scale={[2, 6, 1]} color={CYAN} />
        <Lightformer form="rect" intensity={1.4} position={[5, 0, 2]} scale={[2, 6, 1]} color={VIOLET} />
      </Environment>
      <Core pointer={pointer} animate={animate} compact={compact} />
    </Canvas>
  );
}
