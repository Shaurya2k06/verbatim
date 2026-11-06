import AOS from "aos";
import "aos/dist/aos.css";

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

let started = false;

/** Scroll reveals, set up once for the whole visit: coming back to the page only needs its new elements found. */
export function startReveals() {
  if (started) {
    AOS.refreshHard();
    return;
  }
  started = true;
  AOS.init({ once: true, duration: 700, easing: "ease-out-cubic", offset: 48, throttleDelay: 50, disable: calm() });
}

/** Spread onto an element to have it rise in; `order` staggers siblings. */
export const reveal = (order = 0) => ({ "data-aos": "fade-up", "data-aos-delay": String(Math.min(order, 6) * 80) });
