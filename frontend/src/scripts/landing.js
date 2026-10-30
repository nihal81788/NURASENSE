/**
 * NuraSense — Landing Page Interactions
 * IntersectionObserver reveal animations, pipeline tab keyboard/mouse navigation,
 * mobile drawer toggle, and smooth anchor scrolling
 */

export function initLandingInteractions() {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* reveal + gauge observer */
  const revealItems = Array.from(document.querySelectorAll('.reveal, .gauge'));
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    revealItems.forEach((el) => { io.observe(el); });
  } else {
    revealItems.forEach((el) => { el.classList.add('is-in'); });
  }

  /* pipeline tabs */
  const tabs = Array.from(document.querySelectorAll('.pipe-tab'));
  function selectTab(tab) {
    tabs.forEach((other) => {
      const selected = other === tab;
      other.setAttribute('aria-selected', selected ? 'true' : 'false');
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    });
    tab.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => { selectTab(tab); });
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        selectTab(next);
      }
    });
  });

  /* mobile drawer toggle */
  const mobileToggle = document.getElementById('mobileNavToggle');
  const mobileDrawer = document.getElementById('mobileNavDrawer');
  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileDrawer.classList.toggle('is-open');
      mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    mobileDrawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('is-open');
        mobileToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }
}
