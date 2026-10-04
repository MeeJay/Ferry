/** Lets the background spotlight follow the pointer (CSS vars --mx / --my). */
export function startSpotlight() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(pointer: coarse)').matches) return;
  const root = document.documentElement.style;
  let frame = 0;
  let x = 0;
  let y = 0;
  window.addEventListener('pointermove', (e) => {
    x = e.clientX;
    y = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      root.setProperty('--mx', `${x}px`);
      root.setProperty('--my', `${y}px`);
    });
  }, { passive: true });
}
