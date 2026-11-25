/** The API runs in the browser on PGlite (demo build and desktop app); routes live on the URL hash. */
export const IS_LOCAL_API = import.meta.env.VITE_DEMO === 'true';
/** Windows app (`vite build --mode desktop`, apps/desktop): one person's data, backup on close. */
export const IS_DESKTOP = import.meta.env.VITE_DESKTOP === 'true';
/** Public test environment (`vite build --mode demo`): sample data, prefilled login, reset banner. */
export const IS_DEMO = IS_LOCAL_API && !IS_DESKTOP;
