/**
 * Smooth-scroll for in-page `<a href="#…">` links.
 * Skips links whose target doesn't exist (so external anchors fall through).
 */

const NAV_OFFSET_PX = 64;

export function installSmoothAnchorScroll(root = document) {
    root.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', (e) => {
            const href = anchor.getAttribute('href');
            if (!href || href === '#') return;
            const target = document.querySelector(href);
            if (!target) return;
            e.preventDefault();
            const top = target.getBoundingClientRect().top + window.scrollY - NAV_OFFSET_PX;
            window.scrollTo({ top, behavior: 'smooth' });
        });
    });
}
