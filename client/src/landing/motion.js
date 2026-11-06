/** True when the visitor asked for less motion. Every animated piece of the landing page checks this first. */
export const calm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Fires `fn` at most once per animation frame for a scroll or resize event. Returns the throttled handler and a cancel. */
export function perFrame(fn) {
  let id = 0;
  const handler = () => {
    if (id) return;
    id = requestAnimationFrame(() => {
      id = 0;
      fn();
    });
  };
  handler.cancel = () => cancelAnimationFrame(id);
  return handler;
}
