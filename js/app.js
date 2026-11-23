import { setupBooking } from './booking.js';

const header = document.querySelector('.site-header');
const nav = document.querySelector('#nav');
const toggle = document.querySelector('.menu-toggle');
const desktop = matchMedia('(min-width: 58rem)');
const navEntries = [...nav.querySelectorAll('a')].map(link => ({
  link,
  target: document.querySelector(link.hash),
})).sort((a, b) => a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

function setMenu(open, restoreFocus = false) {
  nav.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  toggle.querySelector('use').setAttribute('href', `./assets/icons/ui.svg#${open ? 'close' : 'menu'}`);
  if (restoreFocus) toggle.focus();
}

header.classList.add('menu-ready');
toggle.hidden = false;
toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') === 'false'));
header.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav.classList.contains('is-open')) {
    event.preventDefault();
    setMenu(false, true);
  }
});
header.addEventListener('focusout', event => {
  if (event.relatedTarget && !header.contains(event.relatedTarget)) setMenu(false);
});
document.addEventListener('pointerdown', event => {
  if (!header.contains(event.target)) setMenu(false);
});
desktop.addEventListener('change', () => {
  const focusInNav = nav.contains(document.activeElement);
  const focusOnToggle = document.activeElement === toggle;
  setMenu(false, !desktop.matches && focusInNav);
  if (desktop.matches && focusOnToggle) nav.querySelector('a').focus();
});

let scrollFrame = 0;
function updateNav() {
  scrollFrame = 0;
  header.classList.toggle('is-scrolled', scrollY > 8);
  const anchorLine = header.getBoundingClientRect().bottom + 92;
  const active = navEntries.findLast(({ target }) => target.getBoundingClientRect().top <= anchorLine);
  for (const entry of navEntries) {
    if (entry === active) entry.link.setAttribute('aria-current', 'location');
    else entry.link.removeAttribute('aria-current');
  }
}
function scheduleNavUpdate() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateNav);
}
window.addEventListener('scroll', scheduleNavUpdate, { passive: true });
window.addEventListener('resize', scheduleNavUpdate);
scheduleNavUpdate();

const selectService = setupBooking();
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const target = document.getElementById(link.hash.slice(1));
  if (!target) return;
  setMenu(false);
  if (link.dataset.service) selectService(link.dataset.service);
  const focusTarget = target.matches('main') ? target : target.querySelector('h1, h2') ?? target;
  focusTarget.tabIndex = -1;
  requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
});

const dialog = document.querySelector('#gallery-dialog');
const gallery = [...document.querySelectorAll('.gallery-open')];
if (typeof dialog.showModal === 'function') {
  const image = dialog.querySelector('.dialog-image');
  const caption = dialog.querySelector('#gallery-caption');
  const position = dialog.querySelector('#gallery-position');
  let index = 0;
  let opener;

  function displayImage(next) {
    index = (next + gallery.length) % gallery.length;
    const link = gallery[index];
    image.src = link.href;
    image.alt = link.querySelector('img').alt;
    caption.textContent = link.closest('figure').querySelector('figcaption').textContent;
    position.textContent = `${index + 1} de ${gallery.length}`;
  }

  gallery.forEach((link, imageIndex) => link.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    opener = link;
    displayImage(imageIndex);
    dialog.showModal();
  }));
  dialog.querySelector('.gallery-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('#gallery-prev').addEventListener('click', () => displayImage(index - 1));
  dialog.querySelector('#gallery-next').addEventListener('click', () => displayImage(index + 1));
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    displayImage(index + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => opener?.focus({ preventScroll: true }));
}