/**
 * Page chrome entry point: smooth-scroll, reveal-on-scroll, HUD widgets.
 * All real work lives under js/page/.
 */
import { installSmoothAnchorScroll } from './js/page/smooth-anchor-scroll.js';
import { installRevealOnScroll }     from './js/page/reveal-on-scroll.js';
import { installHud }                from './js/page/hud.js';

installSmoothAnchorScroll();
installRevealOnScroll();
installHud();
