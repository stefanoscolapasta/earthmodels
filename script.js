/* ==========================================================================
   Earth Models — page chrome
   - Reveal-on-scroll for content blocks
   - Live HUD updates: clock, cursor coords, FPS, splat count
   - Smooth-scroll for in-page anchors
   ========================================================================== */

// Smooth scroll for nav anchors
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
        const href = anchor.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        const offsetTop = target.getBoundingClientRect().top + window.scrollY - 64;
        window.scrollTo({ top: offsetTop, behavior: 'smooth' });
    });
});

// Reveal-on-scroll
const revealables = document.querySelectorAll(
    '.section-body > *, .pillar, .future-card, .benefit, .subject, .method-step, .pull-quote, .data-table, .meta-grid, .footnote-list'
);
revealables.forEach((el) => el.classList.add('reveal'));

const revealObserver = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
            }
        }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
);
revealables.forEach((el) => revealObserver.observe(el));

// HUD: live UTC clock, cursor coords, FPS counter
const clockEl = document.getElementById('clock');
const cursorEl = document.getElementById('hud-cursor');
const fpsEl = document.getElementById('hud-fps');

function updateClock() {
    if (!clockEl) return;
    const d = new Date();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    clockEl.textContent = `${hh}:${mm}:${ss} UTC`;
}
updateClock();
setInterval(updateClock, 1000);

if (cursorEl) {
    document.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = -(e.clientY / window.innerHeight - 0.5) * 2;
        const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);
        cursorEl.textContent = `CUR  ${fmt(x)}  ${fmt(y)}`;
    }, { passive: true });
}

if (fpsEl) {
    let frames = 0;
    let lastTick = performance.now();
    function fpsLoop(now) {
        frames++;
        if (now - lastTick >= 1000) {
            fpsEl.textContent = `${frames} FPS`;
            frames = 0;
            lastTick = now;
        }
        requestAnimationFrame(fpsLoop);
    }
    requestAnimationFrame(fpsLoop);
}
