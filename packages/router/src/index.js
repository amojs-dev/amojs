/**
 * amo router — public surface. Three names is the whole router:
 *   router()   → a component that owns the outlet and the URL
 *   redirect() → returned from load/action to send the user elsewhere
 *   link()     → prefixes an in-app href with the router's base
 */

export { router, redirect, link } from './router.js';
