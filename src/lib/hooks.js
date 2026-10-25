import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

/** True when the user asked the OS/browser for less motion. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Cheap one-time WebGL capability check used to decide whether to mount 3D scenes. */
let webglCache;
export function supportsWebGL() {
  if (webglCache !== undefined) return webglCache;
  try {
    const canvas = document.createElement('canvas');
    webglCache = Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** True while the element is on screen — lets 3D scenes stop rendering when scrolled away. */
export function useInView(ref, rootMargin = '80px') {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return inView;
}

/**
 * GSAP staggered reveal: any descendant with [data-reveal] fades/rises in sequence.
 * Re-runs when `key` changes. Skipped entirely under reduced motion.
 */
export function useStaggerReveal(key) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();
  useLayoutEffect(() => {
    if (reduced || !ref.current) return undefined;
    const ctx = gsap.context(() => {
      const items = gsap.utils.toArray('[data-reveal]');
      if (!items.length) return;
      gsap.fromTo(items,
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out', stagger: 0.06, clearProps: 'opacity,transform' });
    }, ref);
    return () => ctx.revert();
  }, [key, reduced]);
  return ref;
}

/** Pointer-driven 3D tilt for cards; writes CSS variables so React does not re-render. */
export function useTilt(max = 6) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node || reduced || !window.matchMedia('(hover: hover)').matches) return undefined;
    let frame = 0;
    const move = (event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        node.style.setProperty('--ry', `${((x - 0.5) * max * 2).toFixed(2)}deg`);
        node.style.setProperty('--rx', `${((0.5 - y) * max * 2).toFixed(2)}deg`);
        node.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        node.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      node.style.setProperty('--rx', '0deg');
      node.style.setProperty('--ry', '0deg');
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
    };
  }, [max, reduced]);
  return ref;
}

/** Light/dark theme persisted per browser; defaults to the OS preference. */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('hcm_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* storage unavailable */ }
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080B16' : '#F5F6FB');
    try { localStorage.setItem('hcm_theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))];
}
