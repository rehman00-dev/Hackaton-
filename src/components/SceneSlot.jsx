import React, { Suspense, lazy, useRef } from 'react';
import { supportsWebGL, useInView, usePrefersReducedMotion } from '../lib/hooks';

// The whole three.js stack is only fetched when a scene is actually mounted.
const OrbScene = lazy(() => import('../scenes/OrbScene.jsx'));

class SceneBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn('3D scene disabled:', error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** CSS-only stand-in used while loading, without WebGL, or if the scene throws. */
export function SceneFallback() {
  return (
    <div className="scene-fallback" aria-hidden="true">
      <span className="orb-core" />
      <span className="orb-ring r1" />
      <span className="orb-ring r2" />
      <span className="orb-ring r3" />
    </div>
  );
}

/** Decorative 3D slot: lazy, pauses off-screen, respects reduced motion, falls back gracefully. */
export default function SceneSlot({ compact = false, className = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const reduced = usePrefersReducedMotion();
  const webgl = supportsWebGL();
  return (
    <div ref={ref} className={`scene-slot ${className}`} aria-hidden="true">
      {webgl ? (
        <SceneBoundary fallback={<SceneFallback />}>
          <Suspense fallback={<SceneFallback />}>
            <OrbScene active={inView} reduced={reduced} compact={compact} />
          </Suspense>
        </SceneBoundary>
      ) : <SceneFallback />}
    </div>
  );
}
