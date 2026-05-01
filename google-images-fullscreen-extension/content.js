/* global browser */
(() => {
  'use strict';

  const STATE = {
    enabled: true,
    overlay: null,
    img: null,
    lastSrc: '',
    lastUpdate: 0,
    scheduled: false,
    observer: null,
    initialized: false,
    navToken: 0,
    navBusy: false,
    preloadCache: new Set()
  };

  const MIN_UPDATE_GAP_MS = 250;

  function isGoogleImagesPage() {
    const host = location.hostname || '';
    return host.includes('google.') && (
      location.pathname.includes('/search') ||
      location.search.includes('tbm=isch') ||
      location.search.includes('udm=2')
    );
  }

  function createOverlay() {
    if (STATE.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'gifp-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const img = document.createElement('img');
    img.alt = '';

    const close = document.createElement('button');
    close.id = 'gifp-close';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close fullscreen image preview';

    const prev = document.createElement('button');
    prev.id = 'gifp-prev';
    prev.className = 'gifp-nav';
    prev.type = 'button';
    prev.textContent = '‹';
    prev.title = 'Previous image';

    const next = document.createElement('button');
    next.id = 'gifp-next';
    next.className = 'gifp-nav';
    next.type = 'button';
    next.textContent = '›';
    next.title = 'Next image';

    const hint = document.createElement('div');
    hint.id = 'gifp-hint';
    hint.textContent = 'Esc closes • Arrow keys / buttons move through Google Images';

    overlay.appendChild(img);
    overlay.appendChild(close);
    overlay.appendChild(prev);
    overlay.appendChild(next);
    overlay.appendChild(hint);
    document.documentElement.appendChild(overlay);

    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideOverlay();
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) hideOverlay();
    });

    img.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    prev.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateGoogleImages('prev');
    });

    next.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateGoogleImages('next');
    });

    document.addEventListener('keydown', (event) => {
      if (!STATE.overlay || !STATE.overlay.classList.contains('gifp-visible')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hideOverlay();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        navigateGoogleImages('prev');
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        navigateGoogleImages('next');
      }
    }, true);

    STATE.overlay = overlay;
    STATE.img = img;
  }

  function hideOverlay() {
    if (!STATE.overlay) return;
    STATE.overlay.classList.remove('gifp-visible');
    STATE.overlay.setAttribute('aria-hidden', 'true');
  }

  function showOverlay(src) {
    if (!STATE.enabled || !src) return;
    createOverlay();
    if (STATE.img.src !== src) STATE.img.src = src;
    STATE.lastSrc = src;
    STATE.overlay.classList.add('gifp-visible');
    STATE.overlay.setAttribute('aria-hidden', 'false');
    window.setTimeout(preloadNearbyImages, 300);
  }

  function scheduleSeveralUpdates() {
    setTimeout(scheduleUpdate, 80);
    setTimeout(scheduleUpdate, 250);
    setTimeout(scheduleUpdate, 600);
    setTimeout(scheduleUpdate, 1100);
  }

  function elementIsInExtensionOverlay(el) {
    return Boolean(el && el.closest && el.closest('#gifp-overlay'));
  }

  function elementVisible(el) {
    if (!el || elementIsInExtensionOverlay(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  }

  function scoreNavCandidate(el, direction) {
    if (!elementVisible(el)) return -1;

    const rect = el.getBoundingClientRect();
    const label = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('data-tooltip') || '',
      el.textContent || ''
    ].join(' ').trim().toLowerCase();

    const prevWords = /(previous|prev|back|left|‹|❮|〈|chevron_left)/i;
    const nextWords = /(next|forward|right|›|❯|〉|chevron_right)/i;
    const wrongWords = direction === 'prev' ? nextWords : prevWords;
    const rightWords = direction === 'prev' ? prevWords : nextWords;

    if (wrongWords.test(label)) return -1;

    let score = 0;
    if (rightWords.test(label)) score += 1000;
    if (el.matches('button,[role="button"],a')) score += 80;
    if (el.querySelector('svg')) score += 35;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const verticalMiddleBias = 1 - Math.min(1, Math.abs(centerY - innerHeight / 2) / (innerHeight / 2));
    score += verticalMiddleBias * 60;

    if (direction === 'prev') {
      score += (1 - Math.min(1, centerX / innerWidth)) * 50;
      if (centerX < innerWidth * 0.55) score += 25;
    } else {
      score += Math.min(1, centerX / innerWidth) * 50;
      if (centerX > innerWidth * 0.45) score += 25;
    }

    if (rect.width > 240 || rect.height > 240) score -= 120;

    return score;
  }

  function findGoogleNavButton(direction) {
    const selectors = [
      'button',
      '[role="button"]',
      'a[aria-label]',
      'div[aria-label]',
      'span[aria-label]'
    ].join(',');

    const candidates = Array.from(document.querySelectorAll(selectors))
      .filter((el) => !elementIsInExtensionOverlay(el))
      .map((el) => ({ el, score: scoreNavCandidate(el, direction) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates.length ? candidates[0].el : null;
  }

  function fireMouseActivation(el) {
    if (!el) return false;

    try { el.focus({ preventScroll: true }); } catch (e) {}

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const options = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

    try {
      el.dispatchEvent(new MouseEvent('mousedown', options));
      el.dispatchEvent(new MouseEvent('mouseup', options));
      el.dispatchEvent(new MouseEvent('click', options));
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (ignored) { return false; }
    }
  }

  function dispatchArrowToPage(direction) {
    const key = direction === 'prev' ? 'ArrowLeft' : 'ArrowRight';
    const keyCode = direction === 'prev' ? 37 : 39;
    const targets = [document.activeElement, document.body, document, window].filter(Boolean);

    for (const target of targets) {
      try {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true, view: window }));
      } catch (e) {}
    }
  }

  function attemptGoogleNavigation(direction) {
    const button = findGoogleNavButton(direction);
    if (button && fireMouseActivation(button)) return true;
    dispatchArrowToPage(direction);
    return true;
  }

  function preloadNearbyImages() {
    if (!STATE.enabled) return;

    const candidates = Array.from(document.images || [])
      .filter((image) => !elementIsInExtensionOverlay(image))
      .map((image) => image.currentSrc || image.src)
      .filter(srcLooksUsable)
      .filter((src) => src && src !== STATE.lastSrc && !STATE.preloadCache.has(src))
      .slice(0, 10);

    for (const src of candidates) {
      STATE.preloadCache.add(src);
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }

    if (STATE.preloadCache.size > 80) {
      STATE.preloadCache = new Set(Array.from(STATE.preloadCache).slice(-40));
    }
  }

  function navigateGoogleImages(direction) {
    if (STATE.navBusy) return;

    STATE.navBusy = true;
    const token = ++STATE.navToken;
    const previousSrc = findSelectedImageSrc() || STATE.lastSrc;
    let attempts = 0;
    const startedAt = Date.now();

    const retryUntilChanged = () => {
      if (token !== STATE.navToken) return;

      const currentSrc = findSelectedImageSrc();
      if (currentSrc && currentSrc !== previousSrc) {
        showOverlay(currentSrc);
        preloadNearbyImages();
        STATE.navBusy = false;
        return;
      }

      if (attempts >= 5 || Date.now() - startedAt > 1700) {
        STATE.navBusy = false;
        scheduleSeveralUpdates();
        return;
      }

      attempts += 1;
      attemptGoogleNavigation(direction);
      window.setTimeout(retryUntilChanged, attempts === 1 ? 180 : 260);
    };

    retryUntilChanged();
  }

  function srcLooksUsable(src) {
    if (!src) return false;
    if (src.startsWith('data:')) return false;
    if (src.includes('gstatic.com/images?q=tbn')) return false;
    return /^https?:\/\//i.test(src) || src.startsWith('//');
  }

  function getLargestVisibleImage() {
    const imgs = Array.from(document.images || []);
    let best = null;
    let bestArea = 0;

    for (const image of imgs) {
      if (elementIsInExtensionOverlay(image)) continue;

      const src = image.currentSrc || image.src;
      if (!srcLooksUsable(src)) continue;

      const rect = image.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 160) continue;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;

      const style = getComputedStyle(image);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

      const area = rect.width * rect.height;
      const centerBias = Math.max(0, 1 - Math.abs((rect.left + rect.width / 2) - innerWidth / 2) / innerWidth);
      const score = area * (1 + centerBias * 0.35);

      if (score > bestArea) {
        bestArea = score;
        best = image;
      }
    }

    return best;
  }

  function findSelectedImageSrc() {
    const best = getLargestVisibleImage();
    if (best) return best.currentSrc || best.src;
    return '';
  }

  function updateOverlayFromPage() {
    STATE.scheduled = false;
    if (!STATE.enabled || !isGoogleImagesPage()) return;

    const now = Date.now();
    if (now - STATE.lastUpdate < MIN_UPDATE_GAP_MS) return;
    STATE.lastUpdate = now;

    const src = findSelectedImageSrc();
    if (src && src !== STATE.lastSrc) {
      showOverlay(src);
    }
  }

  function scheduleUpdate() {
    if (STATE.scheduled || !STATE.enabled) return;
    STATE.scheduled = true;
    window.setTimeout(updateOverlayFromPage, MIN_UPDATE_GAP_MS);
  }

  async function loadEnabledState() {
    try {
      const result = await browser.storage.local.get({ enabled: true });
      STATE.enabled = Boolean(result.enabled);
    } catch (e) {
      STATE.enabled = true;
    }
  }

  function startObserver() {
    if (STATE.observer || !document.body) return;

    STATE.observer = new MutationObserver(() => {
      scheduleUpdate();
    });

    STATE.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    document.addEventListener('click', () => {
      setTimeout(scheduleUpdate, 250);
      setTimeout(scheduleUpdate, 700);
    }, true);
  }

  function stopObserver() {
    if (STATE.observer) {
      STATE.observer.disconnect();
      STATE.observer = null;
    }
    hideOverlay();
  }

  async function init() {
    if (STATE.initialized) return;
    STATE.initialized = true;

    if (!isGoogleImagesPage()) return;

    await loadEnabledState();
    createOverlay();

    if (STATE.enabled) {
      startObserver();
      setTimeout(scheduleUpdate, 500);
    }

    browser.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== 'GIFP_SET_ENABLED') return;
      STATE.enabled = Boolean(message.enabled);
      if (STATE.enabled) {
        startObserver();
        scheduleUpdate();
      } else {
        stopObserver();
      }
    });

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.enabled) return;
      STATE.enabled = Boolean(changes.enabled.newValue);
      if (STATE.enabled) {
        startObserver();
        scheduleUpdate();
      } else {
        stopObserver();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
