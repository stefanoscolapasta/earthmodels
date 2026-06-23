/**
 * Add the `.reveal` class to every selector match, then observe each one
 * with an IntersectionObserver and add `.is-visible` when it enters the
 * viewport. The first element to cross the threshold is unobserved
 * immediately so the reveal only runs once per element.
 */

const DEFAULT_SELECTORS = [
    '.section-body > *',
    '.pillar',
    '.future-card',
    '.benefit',
    '.subject',
    '.method-step',
    '.pull-quote',
    '.data-table',
    '.meta-grid',
    '.footnote-list'
];

export function installRevealOnScroll({
    selectors = DEFAULT_SELECTORS,
    rootMargin = '0px 0px -10% 0px',
    threshold = 0.05
} = {}) {
    const els = document.querySelectorAll(selectors.join(', '));
    els.forEach((el) => el.classList.add('reveal'));

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        }
    }, { rootMargin, threshold });

    els.forEach((el) => observer.observe(el));
    return observer;
}
