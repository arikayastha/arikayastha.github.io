(function () {
  const storageKey = "theme";
  const backgroundStorageKey = "bg-images";
  const viewModeStorageKey = "view-mode";
  const root = document.documentElement;

  /* Fixtures of the page, looked up once. The media queries in particular are
     read on every mouse move, and their result stays live on its own */
  const pageViewEl = document.getElementById("page-view");
  const landingViewEl = document.getElementById("landing-view");
  const landingStageEl = document.getElementById("landing-stage");
  const headerEl = document.getElementById("site-header");
  const figureBaseEl = document.getElementById("figure-base");
  const mobileQuery = window.matchMedia("(max-width: 768px)");
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const mainImages = {
    light: "pictures/main-light.svg",
    dark: "pictures/main-dark.svg",
  };

  const THEME_TRANSITION_MS = Math.round(
    parseFloat(getComputedStyle(root).getPropertyValue("--theme-duration")) * 1000
  ) || 1100;
  const PAGE_TRANSITION_MS = Math.round(
    parseFloat(getComputedStyle(root).getPropertyValue("--page-transition-duration")) * 1000
  ) || 1400;
  const pages = ["publications", "research", "about", "resources"];
  const siteTitle = "Ambashri Purkayastha";
  const pageTitles = {
    about: "About — " + siteTitle,
    publications: "Publications — " + siteTitle,
    research: "Research — " + siteTitle,
    resources: "Resources — " + siteTitle,
  };
  const scrollOrder = ["about", "research", "publications", "resources"];
  const contentPath = "assets/content/";
  const contentCache = Object.create(null);
  const contentPending = Object.create(null);

  let activeOverlay = -1;
  let currentSrc = "";
  let overlays = [];
  let currentPage = null;
  let isTransitioning = false;
  let scrollSectionsReady = false;
  let currentSection = null;
  let snapTimer = null;
  let snapFrame = null;
  let isSnapping = false;
  let burstAnchorIndex = null;

  /* How a page glides into place in the simple view */
  const SNAP_DURATION_MS = 650;
  const SNAP_IDLE_MS = 130;
  /* Fraction of the screen you must scroll to move on to the next page */
  const SNAP_TRIGGER_RATIO = 0.05;

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function nextFrame() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  /* In-flight requests are shared, so the preload and the simple view asking
     for the same page at once still costs a single fetch */
  function fetchPageHtml(page) {
    if (contentCache[page]) return Promise.resolve(contentCache[page]);
    if (contentPending[page]) return contentPending[page];

    contentPending[page] = fetch(contentPath + page + ".html")
      .then(function (response) {
        if (!response.ok) throw new Error("Failed to load page");
        return response.text();
      })
      .then(function (html) {
        contentCache[page] = html;
        return html;
      })
      .catch(function () {
        return "";
      })
      .finally(function () {
        delete contentPending[page];
      });

    return contentPending[page];
  }

  async function renderPageContent(page) {
    pageViewEl.innerHTML = "";

    const html = await fetchPageHtml(page);
    pageViewEl.innerHTML =
      html ||
      "<h1>Error</h1><p>Could not load this page. If you are previewing locally, run a local server (for example <code>npx serve .</code>).</p>";

    pageViewEl.scrollTop = 0;
  }

  function preloadPageContent() {
    pages.forEach(function (page) {
      fetchPageHtml(page);
    });
  }

  function setPageViewAccessibility(isVisible) {
    if (pageViewEl) pageViewEl.setAttribute("aria-hidden", String(!isVisible));
    if (landingViewEl) landingViewEl.setAttribute("aria-hidden", String(isVisible));
  }

  function getPreferredTheme() {
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function getTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function getZoneImage(zone) {
    const theme = getTheme();
    return zone.getAttribute(theme === "dark" ? "data-img-dark" : "data-img-light");
  }

  function getZoneByKey(key) {
    return (
      document.querySelector('.figure-zone[data-zone="' + key + '"]') ||
      document.querySelector('.site-list-item[data-zone="' + key + '"]')
    );
  }

  function setHeaderHighlight(active) {
    if (headerEl) headerEl.classList.toggle("is-highlight", active);
  }

  function preloadImages() {
    const urls = new Set([
      mainImages.light,
      mainImages.dark,
      "pictures/sideLogo-light.svg",
      "pictures/sideLogo-dark.svg",
      "pictures/header-light.svg",
      "pictures/header-dark.svg",
      "pictures/header-light-highlight.png",
      "pictures/header-dark-highlight.png",
      "pictures/tab-light.svg",
      "pictures/tab-dark.svg",
      "pictures/bg-right-corner-light.png",
      "pictures/bg-right-corner-dark.png",
      "pictures/bg-left-corner-light.png",
      "pictures/bg-left-corner-dark.png",
      "pictures/bg-right-corner-light-eclipse-sun.png",
      "pictures/bg-right-corner-light-eclipse-moon.png",
    ]);
    document.querySelectorAll(".figure-zone").forEach(function (el) {
      urls.add(el.getAttribute("data-img-light"));
      urls.add(el.getAttribute("data-img-dark"));
    });
    urls.forEach(function (url) {
      if (!url) return;
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    });
  }

  preloadImages();

  function hideOverlays() {
    overlays.forEach(function (el) {
      el.classList.remove("is-visible");
    });
    activeOverlay = -1;
    currentSrc = "";
  }

  function resetFigureImage() {
    hideOverlays();
    if (figureBaseEl) figureBaseEl.src = mainImages[getTheme()];
  }

  function showOnOverlay(index, src) {
    const nextEl = overlays[index];
    const prevEl = activeOverlay >= 0 ? overlays[activeOverlay] : null;

    nextEl.src = src;
    requestAnimationFrame(function () {
      nextEl.classList.add("is-visible");
      if (prevEl && prevEl !== nextEl) {
        prevEl.classList.remove("is-visible");
      }
      activeOverlay = index;
      currentSrc = src;
    });
  }

  function crossfadeTo(src) {
    if (!src || src === currentSrc) return;

    const nextIndex = activeOverlay === 0 ? 1 : 0;
    const nextEl = overlays[nextIndex];

    if (nextEl.getAttribute("src") === src && nextEl.complete && nextEl.naturalWidth > 0) {
      showOnOverlay(nextIndex, src);
      return;
    }

    nextEl.src = src;
    if (nextEl.complete && nextEl.naturalWidth > 0) {
      showOnOverlay(nextIndex, src);
      return;
    }

    const img = new Image();
    img.onload = function () {
      showOnOverlay(nextIndex, src);
    };
    img.src = src;
  }

  function setActiveNav(page) {
    document.querySelectorAll(".site-list-item").forEach(function (item) {
      const isActive = page && item.getAttribute("data-page") === page;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-current", isActive ? "page" : "false");
    });
  }

  /* Hovering lights an item up without making it the current page, so
     aria-current is cleared while the class follows the zone */
  function activateZone(key) {
    if (document.body.classList.contains("view-page")) return;
    document.querySelectorAll(".site-list-item").forEach(function (item) {
      item.setAttribute("aria-current", "false");
      item.classList.toggle("is-active", item.getAttribute("data-zone") === key);
    });
    setHeaderHighlight(key === "about");

    if (key === "about") {
      resetFigureImage();
      return;
    }

    const zone = getZoneByKey(key);
    if (!zone) return;
    crossfadeTo(getZoneImage(zone));
  }

  function shouldDeactivateHover() {
    return (
      !landingStageEl.matches(":hover") &&
      !(headerEl && headerEl.matches(":hover")) &&
      !landingStageEl.querySelector(".figure-zone:focus, .site-list-item:focus") &&
      !(headerEl && headerEl.matches(":focus"))
    );
  }

  function deactivateHover() {
    if (document.body.classList.contains("view-page")) return;
    if (!shouldDeactivateHover()) return;
    setActiveNav(null);
    setHeaderHighlight(false);
    resetFigureImage();
  }

  async function showHome(skipHistory, instant) {
    if (isTransitioning || document.body.classList.contains("view-home")) return;

    isTransitioning = true;

    if (!instant && pageViewEl) {
      pageViewEl.classList.add("is-fading");
      await wait(PAGE_TRANSITION_MS / 2);
    }

    currentPage = null;
    document.body.classList.remove("view-page");
    document.body.classList.add("view-home");
    setActiveNav(null);
    setHeaderHighlight(false);
    resetFigureImage();
    setPageViewAccessibility(false);
    document.title = siteTitle;

    if (!instant) {
      await wait(PAGE_TRANSITION_MS / 2);
    }

    if (pageViewEl) {
      pageViewEl.classList.remove("is-fading");
    }

    if (!skipHistory) {
      history.pushState({ page: null }, "", window.location.pathname);
    }
    isTransitioning = false;
  }

  async function loadPage(page, skipHistory, instant) {
    if (!pages.includes(page) || isTransitioning) return;
    if (currentPage === page && document.body.classList.contains("view-page")) return;

    const isHome = document.body.classList.contains("view-home");
    isTransitioning = true;

    if (isHome) {
      await renderPageContent(page);
      setActiveNav(null);
      document.body.classList.remove("view-home");
      document.body.classList.add("view-page");
      hideOverlays();
      setPageViewAccessibility(true);

      if (!instant) {
        await nextFrame();
        setActiveNav(page);
        await wait(PAGE_TRANSITION_MS);
      } else {
        setActiveNav(page);
      }
    } else if (!instant) {
      pageViewEl.classList.add("is-fading");
      await wait(PAGE_TRANSITION_MS / 2);
      await renderPageContent(page);
      setActiveNav(page);
      pageViewEl.classList.remove("is-fading");
      await wait(PAGE_TRANSITION_MS / 2);
    } else {
      await renderPageContent(page);
      setActiveNav(page);
    }

    currentPage = page;
    document.title = pageTitles[page];

    if (!skipHistory) {
      history.pushState({ page: page }, "", "#" + page);
    }

    isTransitioning = false;
  }

  function isMobileView() {
    return mobileQuery.matches;
  }

  function initHeaderNavigation() {
    if (!headerEl) return;

    headerEl.addEventListener(
      "click",
      function (event) {
        if (!isMobileView()) return;
        event.preventDefault();
        event.stopPropagation();
        if (document.body.classList.contains("view-page")) {
          showHome();
        }
      },
      true
    );
  }

  function initNavigation() {
    initHeaderNavigation();

    document.addEventListener("click", function (event) {
      const link = event.target.closest("a[data-page]");
      if (!link) return;

      if (link.id === "site-header" && isMobileView()) {
        return;
      }

      const page = link.getAttribute("data-page");
      if (!pages.includes(page)) return;
      event.preventDefault();
      loadPage(page);
    });

    const sidebarLogo = document.getElementById("sidebar-logo");
    if (sidebarLogo) {
      sidebarLogo.addEventListener("click", function () {
        if (document.body.classList.contains("view-page")) {
          showHome();
        }
      });
    }

    window.addEventListener("popstate", function (event) {
      const page = event.state && event.state.page;
      if (page) {
        loadPage(page, true);
      } else {
        showHome(true);
      }
    });

    const hash = window.location.hash.replace("#", "");
    if (pages.includes(hash)) {
      loadPage(hash, true, true);
      history.replaceState({ page: hash }, "", "#" + hash);
    } else {
      history.replaceState({ page: null }, "", window.location.pathname);
      setPageViewAccessibility(false);
    }

    preloadPageContent();
  }

  function initFigureNav() {
    overlays = [
      document.getElementById("figure-overlay-a"),
      document.getElementById("figure-overlay-b"),
    ].filter(Boolean);

    if (!landingStageEl || overlays.length < 2) return;

    document.querySelectorAll(".figure-zone").forEach(function (zone) {
      zone.addEventListener("mouseenter", function () {
        activateZone(zone.getAttribute("data-zone"));
      });

      zone.addEventListener("focus", function () {
        activateZone(zone.getAttribute("data-zone"));
      });
    });

    document.querySelectorAll(".site-list-item").forEach(function (item) {
      item.addEventListener("mouseenter", function () {
        if (!document.body.classList.contains("view-home")) return;
        activateZone(item.getAttribute("data-zone"));
      });

      item.addEventListener("focus", function () {
        if (!document.body.classList.contains("view-home")) return;
        activateZone(item.getAttribute("data-zone"));
      });
    });

    landingStageEl.addEventListener("mouseleave", deactivateHover);

    landingStageEl.querySelectorAll(".figure-zone, .site-list-item").forEach(function (el) {
      el.addEventListener("blur", deactivateHover);
    });

    if (headerEl) {
      headerEl.addEventListener("mouseenter", function () {
        if (!document.body.classList.contains("view-home")) return;
        activateZone("about");
      });

      headerEl.addEventListener("focus", function () {
        if (!document.body.classList.contains("view-home")) return;
        activateZone("about");
      });

      headerEl.addEventListener("mouseleave", deactivateHover);
      headerEl.addEventListener("blur", deactivateHover);
    }
  }

  function applyTheme(theme, instant) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(storageKey, theme);
    syncPointerEffects();

    if (!figureBaseEl) return;

    if (instant) {
      figureBaseEl.src = mainImages[theme];
      hideOverlays();
      return;
    }

    if (document.body.classList.contains("view-page")) return;

    const activeItem = document.querySelector(".site-list-item.is-active");
    const activeZone = activeItem
      ? getZoneByKey(activeItem.getAttribute("data-zone"))
      : document.querySelector(".figure-zone:hover");

    const targetSrc = activeZone ? getZoneImage(activeZone) : mainImages[theme];

    currentSrc = "";
    crossfadeTo(targetSrc);

    if (activeZone) {
      window.setTimeout(function () {
        figureBaseEl.src = mainImages[theme];
      }, THEME_TRANSITION_MS);
      return;
    }

    window.setTimeout(function () {
      if (document.body.classList.contains("view-home") &&
          !document.querySelector(".site-list-item.is-active")) {
        figureBaseEl.src = mainImages[theme];
        hideOverlays();
      }
    }, THEME_TRANSITION_MS);
  }

  function getBackgroundImagesEnabled() {
    return localStorage.getItem(backgroundStorageKey) === "true";
  }

  function setBackgroundImagesEnabled(enabled) {
    root.classList.toggle("bg-images-enabled", enabled);
    localStorage.setItem(backgroundStorageKey, String(enabled));

    const active = root.classList.contains("bg-images-enabled");
    const label = active ? "Turn off background images" : "Turn on background images";
    document.querySelectorAll(".bg-toggle").forEach(function (btn) {
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
      btn.setAttribute("aria-label", label);
    });
    syncPointerEffects();
  }

  function prefersReducedMotion() {
    return reducedMotionQuery.matches;
  }

  function getSimpleViewEnabled() {
    return localStorage.getItem(viewModeStorageKey) === "simple";
  }

  /* Simple view stacks every page into one continuous scroll */
  async function renderScrollSections() {
    const container = document.getElementById("scroll-main");
    if (!container || scrollSectionsReady) return;
    scrollSectionsReady = true;

    const htmlList = await Promise.all(scrollOrder.map(fetchPageHtml));

    container.innerHTML = "";
    scrollOrder.forEach(function (page, index) {
      const section = document.createElement("section");
      section.className = "scroll-section";
      section.id = page;
      section.setAttribute("data-section", page);

      const box = document.createElement("div");
      box.className = "page scroll-page";
      box.innerHTML =
        htmlList[index] ||
        "<h1>Error</h1><p>Could not load this section. If you are previewing locally, run a local server (for example <code>npx serve .</code>).</p>";

      section.appendChild(box);
      container.appendChild(section);
    });

    initScrollSpy();
  }

  function setCurrentSection(key) {
    if (key === currentSection) return;
    currentSection = key;

    document.querySelectorAll(".scroll-nav-item").forEach(function (item) {
      const isCurrent = item.getAttribute("data-section") === key;
      item.classList.toggle("is-current", isCurrent);
      item.setAttribute("aria-current", isCurrent ? "true" : "false");
    });

    if (key && document.body.classList.contains("view-scroll")) {
      history.replaceState({ page: key }, "", "#" + key);
    }
  }

  function initScrollSpy() {
    const sections = document.querySelectorAll(".scroll-section");
    if (!sections.length || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          setCurrentSection(entry.target.getAttribute("data-section"));
        });
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );

    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  function cancelSnap() {
    if (snapFrame) cancelAnimationFrame(snapFrame);
    window.clearTimeout(snapTimer);
    snapFrame = null;
    isSnapping = false;
    burstAnchorIndex = null;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /* Hand-rolled so the glide is gentler than the browser's own snap */
  function glideTo(targetY) {
    const startY = window.scrollY;
    const distance = targetY - startY;
    if (Math.abs(distance) < 2) return;

    cancelSnap();

    if (prefersReducedMotion()) {
      window.scrollTo({ top: targetY, behavior: "instant" });
      return;
    }

    isSnapping = true;
    const startTime = performance.now();

    function step(now) {
      const progress = Math.min((now - startTime) / SNAP_DURATION_MS, 1);
      window.scrollTo({
        top: startY + distance * easeInOutCubic(progress),
        behavior: "instant",
      });

      if (progress < 1 && isSnapping) {
        snapFrame = requestAnimationFrame(step);
        return;
      }

      snapFrame = null;
      isSnapping = false;
    }

    snapFrame = requestAnimationFrame(step);
  }

  function sectionPositions() {
    return Array.prototype.map.call(
      document.querySelectorAll(".scroll-section"),
      function (section) {
        return section.getBoundingClientRect().top + window.scrollY;
      }
    );
  }

  function nearestIndex(positions, y) {
    let best = 0;
    let bestDistance = Infinity;

    positions.forEach(function (position, index) {
      const distance = Math.abs(position - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });

    return best;
  }

  /* A nudge in either direction moves a whole page, as a hard snap would */
  function snapToPage() {
    const positions = sectionPositions();
    if (!positions.length) return;

    const y = window.scrollY;
    const anchor = burstAnchorIndex === null ? nearestIndex(positions, y) : burstAnchorIndex;
    burstAnchorIndex = null;

    const travelled = y - positions[anchor];
    const viewport = window.innerHeight;
    let index = anchor;

    if (Math.abs(travelled) >= viewport * 0.9) {
      index = nearestIndex(positions, y);
    } else if (travelled > viewport * SNAP_TRIGGER_RATIO) {
      index = anchor + 1;
    } else if (travelled < -viewport * SNAP_TRIGGER_RATIO) {
      index = anchor - 1;
    }

    glideTo(positions[Math.max(0, Math.min(index, positions.length - 1))]);
  }

  function scheduleSnap() {
    if (burstAnchorIndex === null) {
      burstAnchorIndex = nearestIndex(sectionPositions(), window.scrollY);
    }
    window.clearTimeout(snapTimer);
    snapTimer = window.setTimeout(snapToPage, SNAP_IDLE_MS);
  }

  function scrollToSection(key, instant) {
    const target = document.getElementById(key);
    if (!target) return;

    const targetY = target.getBoundingClientRect().top + window.scrollY;
    if (instant) {
      cancelSnap();
      window.scrollTo({ top: targetY, behavior: "instant" });
      return;
    }

    glideTo(targetY);
  }

  async function setSimpleViewEnabled(enabled, instant) {
    document.body.classList.toggle("view-scroll", enabled);
    localStorage.setItem(viewModeStorageKey, enabled ? "simple" : "rich");
    cancelSnap();
    syncPointerEffects();

    const scrollView = document.getElementById("scroll-view");
    if (scrollView) scrollView.setAttribute("aria-hidden", String(!enabled));

    document.querySelectorAll(".view-toggle").forEach(function (btn) {
      btn.classList.toggle("is-active", enabled);
      btn.setAttribute("aria-pressed", String(enabled));
      btn.setAttribute(
        "aria-label",
        enabled ? "Switch to illustrated view" : "Switch to simple scrolling view"
      );
    });

    if (!enabled) {
      /* On first load the illustrated view already owns the URL and scroll position */
      if (instant) return;
      window.scrollTo({ top: 0, behavior: "instant" });
      history.replaceState(
        { page: currentPage },
        "",
        currentPage ? "#" + currentPage : window.location.pathname
      );
      return;
    }

    await renderScrollSections();

    const hash = window.location.hash.replace("#", "");
    const target = currentPage || (pages.includes(hash) ? hash : null);

    if (target) {
      scrollToSection(target, instant);
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  function initScrollView() {
    const scrollView = document.getElementById("scroll-view");
    if (!scrollView) return;

    scrollView.addEventListener("click", function (event) {
      const link = event.target.closest(".scroll-nav-item");
      if (!link) return;
      event.preventDefault();
      scrollToSection(link.getAttribute("data-section"));
    });

    const logo = document.getElementById("scroll-logo");
    if (logo) {
      logo.addEventListener("click", function () {
        glideTo(0);
      });
    }

    window.addEventListener(
      "scroll",
      function () {
        if (isSnapping) return;
        if (isMobileView()) return;
        if (!document.body.classList.contains("view-scroll")) return;
        scheduleSnap();
      },
      { passive: true }
    );

    /* A new gesture always wins over an in-flight glide */
    ["wheel", "touchstart", "keydown"].forEach(function (type) {
      window.addEventListener(
        type,
        function () {
          if (isSnapping) cancelSnap();
        },
        { passive: true }
      );
    });
  }

  /* ============================================
     CURSOR STARS
     A star charges while the cursor rests: the longer it sits still, the
     brighter it burns and the more points it grows. Reach five points and it
     is left behind to fade when the cursor moves on, joined to its
     neighbours like a constellation.
     ============================================ */
  /* Anything the stars should keep clear of: text boxes and artwork alike.
     .figure-nav covers the illustration and the tagline beneath it */
  const STAR_BLOCKED_SELECTOR =
    ".page-view, .app-sidebar, .site-header, .figure-nav, .bg-corner";
  const STAR_MIN_POINTS = 4;
  const STAR_MAX_POINTS = 8;
  /* Dwell needed to reach full brightness and the highest point count */
  const STAR_CHARGE_MS = 800;
  /* How far the cursor may drift and still count as resting */
  const STAR_STILL_RADIUS = 10;
  const STAR_LIFE_MIN_MS = 1600;
  const STAR_LIFE_MAX_MS = 10000;
  /* A four-pointer is kept once it has charged this far; below it the star
     goes with the cursor rather than being left behind */
  const STAR_MIN_RELEASE = 0.15;
  /* Kept stars are strung together in the order they were made; anything
     further apart than this is left unlinked rather than drawing a line
     clear across the screen */
  const STAR_LINK_MAX_DISTANCE = 480;
  const STAR_LINK_ALPHA = 0.35;
  const STAR_MAX_TRAIL = 24;

  let starCanvas = null;
  let starCtx = null;
  let starFrame = null;
  let starLastFrame = 0;
  let liveStar = null;
  const starTrail = [];

  /* Ground rules both pointer effects answer to: they ride on the background
     artwork, stay out of the simple view, and bow to reduced motion */
  function pointerEffectsAllowed() {
    return (
      root.classList.contains("bg-images-enabled") &&
      !document.body.classList.contains("view-scroll") &&
      !prefersReducedMotion()
    );
  }

  function starsEnabled() {
    return pointerEffectsAllowed() && getTheme() === "dark" && !isMobileView();
  }

  function starPoints(charge) {
    const span = STAR_MAX_POINTS - STAR_MIN_POINTS + 1;
    return Math.min(STAR_MAX_POINTS, STAR_MIN_POINTS + Math.floor(charge * span));
  }

  function starRadius(charge) {
    return 6 + charge * 20;
  }

  function starAlpha(charge) {
    return 0.25 + charge * 0.75;
  }

  function starLifespan(charge) {
    return STAR_LIFE_MIN_MS + charge * (STAR_LIFE_MAX_MS - STAR_LIFE_MIN_MS);
  }

  function addStar(x, y, charge, rotation) {
    starTrail.push({
      x: x,
      y: y,
      points: starPoints(charge),
      radius: starRadius(charge),
      alpha: starAlpha(charge),
      rotation: rotation,
      life: 0,
      span: starLifespan(charge),
    });
    if (starTrail.length > STAR_MAX_TRAIL) starTrail.shift();
  }

  function resizeStarCanvas() {
    if (!starCanvas || !starCtx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    starCanvas.width = Math.floor(window.innerWidth * ratio);
    starCanvas.height = Math.floor(window.innerHeight * ratio);
    starCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function clearStarCanvas() {
    if (!starCtx) return;
    starCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function clearStars() {
    if (starFrame) cancelAnimationFrame(starFrame);
    starFrame = null;
    starLastFrame = 0;
    liveStar = null;
    starTrail.length = 0;
    clearStarCanvas();
  }

  /* Tidies up the moment the theme, backgrounds or view change */
  function syncPointerEffects() {
    if (!starsEnabled()) clearStars();
    if (!eclipseEnabled()) resetEclipse();
  }

  function drawStar(x, y, points, radius, alpha, rotation) {
    const inner = radius * (0.26 + points * 0.015);

    starCtx.beginPath();
    for (let i = 0; i < points * 2; i += 1) {
      const reach = i % 2 === 0 ? radius : inner;
      const angle = (Math.PI * i) / points - Math.PI / 2 + rotation;
      starCtx.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
    }
    starCtx.closePath();

    starCtx.fillStyle = "rgba(255, 248, 240, " + alpha + ")";
    starCtx.shadowColor = "rgba(214, 178, 190, " + alpha * 0.75 + ")";
    starCtx.shadowBlur = radius * 1.2;
    starCtx.fill();
    starCtx.shadowBlur = 0;
  }

  function starRemaining(star) {
    return 1 - star.life / star.span;
  }

  /* Walks every star still on screen, oldest first, with the one under the
     cursor last: the constellation follows the order they were made in */
  function drawConstellation(liveVisible) {
    const count = starTrail.length + (liveVisible ? 1 : 0);
    if (count < 2) return;

    starCtx.lineWidth = 1;

    let fromX = 0;
    let fromY = 0;
    let fromFade = 0;

    for (let i = 0; i < count; i += 1) {
      const isLive = i === starTrail.length;
      const star = isLive ? liveStar : starTrail[i];
      const fade = isLive ? 1 : starRemaining(star);

      if (i > 0 && Math.hypot(star.x - fromX, star.y - fromY) <= STAR_LINK_MAX_DISTANCE) {
        /* The line is only ever as present as its dimmer end */
        const alpha = Math.min(fromFade, fade) * STAR_LINK_ALPHA;
        starCtx.strokeStyle = "rgba(255, 248, 240, " + alpha + ")";
        starCtx.beginPath();
        starCtx.moveTo(fromX, fromY);
        starCtx.lineTo(star.x, star.y);
        starCtx.stroke();
      }

      fromX = star.x;
      fromY = star.y;
      fromFade = fade;
    }
  }

  function starStep(now) {
    starFrame = null;

    if (!starsEnabled()) {
      clearStars();
      return;
    }

    const delta = starLastFrame ? Math.min(now - starLastFrame, 64) : 16;
    starLastFrame = now;
    clearStarCanvas();

    for (let i = starTrail.length - 1; i >= 0; i -= 1) {
      const star = starTrail[i];
      star.life += delta;
      if (starRemaining(star) <= 0) starTrail.splice(i, 1);
    }

    if (liveStar && liveStar.charge < 1) {
      liveStar.charge = Math.min(1, liveStar.charge + delta / STAR_CHARGE_MS);
    }

    /* It charges unseen: nothing appears until it has earned a fifth point */
    const livePoints = liveStar ? starPoints(liveStar.charge) : 0;
    const liveVisible = livePoints > STAR_MIN_POINTS;

    drawConstellation(liveVisible);

    starTrail.forEach(function (star) {
      const remaining = starRemaining(star);
      drawStar(
        star.x,
        star.y,
        star.points,
        star.radius * (1.25 - remaining * 0.25),
        star.alpha * remaining,
        star.rotation
      );
    });

    let running = starTrail.length > 0;

    if (liveStar) {
      if (liveStar.charge < 1) running = true;
      if (liveVisible) {
        drawStar(
          liveStar.x,
          liveStar.y,
          livePoints,
          starRadius(liveStar.charge),
          starAlpha(liveStar.charge),
          liveStar.rotation
        );
      }
    }

    /* A fully charged star just sits there, so let the canvas hold the frame */
    if (running) {
      starFrame = requestAnimationFrame(starStep);
      return;
    }
    starLastFrame = 0;
  }

  function requestStarFrame() {
    if (starFrame || !starCtx) return;
    starFrame = requestAnimationFrame(starStep);
  }

  function releaseLiveStar() {
    if (!liveStar) return;

    if (liveStar.charge >= STAR_MIN_RELEASE) {
      addStar(liveStar.x, liveStar.y, liveStar.charge, liveStar.rotation);
    }

    liveStar = null;
  }

  function handleStarPointer(event) {
    if (!starsEnabled()) {
      if (liveStar || starTrail.length) clearStars();
      return;
    }

    if (event.target && event.target.closest && event.target.closest(STAR_BLOCKED_SELECTOR)) {
      releaseLiveStar();
      requestStarFrame();
      return;
    }

    const x = event.clientX;
    const y = event.clientY;

    if (!liveStar) {
      liveStar = { x: x, y: y, charge: 0, rotation: Math.random() * Math.PI };
    } else if (Math.hypot(x - liveStar.x, y - liveStar.y) > STAR_STILL_RADIUS) {
      /* Moved on: bank the old star and start charging a fresh one here */
      releaseLiveStar();
      liveStar = { x: x, y: y, charge: 0, rotation: Math.random() * Math.PI };
    }

    requestStarFrame();
  }

  /* ============================================
     CORNER ECLIPSE
     Day mode only. The cursor's offset from the telescope is mapped onto the
     moon's offset from the sun, so walking the pointer towards the telescope
     slides the moon across the sun until the corners hand over to the
     total-eclipse artwork on hover.
     ============================================ */
  /* How much cursor travel becomes moon travel, and the furthest the moon
     is ever thrown from the sun */
  const ECLIPSE_SCALE = 0.12;
  const ECLIPSE_MAX_OFFSET = 110;
  /* How close the moon must be before the corner switches to the eclipse
     artwork; below this the plain sun has the corner to itself */
  const ECLIPSE_ENGAGE = 0.3;
  /* The moon only answers the cursor out in the open. Boxes are listed per
     view so one that is merely hidden rather than removed stops blocking;
     .figure-nav covers the illustration and the tagline beneath it */
  const CONTENT_BOXES_ALWAYS = ".app-sidebar";
  const CONTENT_BOXES_HOME = ".site-header, .figure-nav";
  const CONTENT_BOXES_PAGE = ".page-view";
  /* Breathing room so the moon never creeps up against an edge */
  const CONTENT_CLEARANCE = 16;

  let eclipseLeft = null;
  let eclipseRight = null;
  let eclipseMoon = null;
  let contentAlways = [];
  let contentHome = [];
  let contentPage = [];

  function eclipseEnabled() {
    return pointerEffectsAllowed() && getTheme() === "light";
  }

  /* Measured against the boxes themselves rather than whatever the pointer
     happens to hit, since several of them ignore pointer events */
  function hitsAnyBox(boxes, x, y) {
    for (let i = 0; i < boxes.length; i += 1) {
      const rect = boxes[i].getBoundingClientRect();
      if (!rect.width && !rect.height) continue;

      if (
        x > rect.left - CONTENT_CLEARANCE &&
        x < rect.right + CONTENT_CLEARANCE &&
        y > rect.top - CONTENT_CLEARANCE &&
        y < rect.bottom + CONTENT_CLEARANCE
      ) {
        return true;
      }
    }

    return false;
  }

  function isOverContent(x, y) {
    const inPage = document.body.classList.contains("view-page");
    return (
      hitsAnyBox(contentAlways, x, y) ||
      hitsAnyBox(inPage ? contentPage : contentHome, x, y)
    );
  }

  /* Hands the corners back to the stylesheet */
  function resetEclipse() {
    if (!eclipseMoon) return;
    eclipseRight.classList.remove("is-eclipsing");
    eclipseMoon.style.opacity = "";
    eclipseMoon.style.transform = "";
  }

  function updateEclipse(event) {
    if (!eclipseMoon) return;

    if (!eclipseEnabled()) {
      resetEclipse();
      return;
    }

    /* On the telescope the hover artwork is the finished eclipse, so the
       stand-in layers step aside and let the stylesheet cross-fade */
    if (eclipseLeft.matches(":hover")) {
      eclipseRight.classList.remove("is-eclipsing");
      eclipseMoon.style.opacity = "0";
      return;
    }

    /* Only the empty space drives the moon; over the content it rests */
    if (isOverContent(event.clientX, event.clientY)) {
      resetEclipse();
      return;
    }

    const rect = eclipseLeft.getBoundingClientRect();
    const fromX = event.clientX - (rect.left + rect.width / 2);
    const fromY = event.clientY - (rect.top + rect.height / 2);

    /* Reflected across the top-left to bottom-right diagonal, so the moon
       answers the cursor across that axis instead of copying it */
    const x = fromY * ECLIPSE_SCALE;
    const y = fromX * ECLIPSE_SCALE;

    const reach = Math.hypot(x, y);
    const capped = reach > ECLIPSE_MAX_OFFSET ? ECLIPSE_MAX_OFFSET / reach : 1;
    const closeness = 1 - Math.min(1, reach / ECLIPSE_MAX_OFFSET);
    const engaged = closeness > ECLIPSE_ENGAGE;

    eclipseRight.classList.toggle("is-eclipsing", engaged);
    eclipseMoon.style.transform =
      "translate(" + x * capped + "px, " + y * capped + "px)";
    eclipseMoon.style.opacity = engaged
      ? String(Math.min(1, (closeness - ECLIPSE_ENGAGE) * 3))
      : "0";
  }

  function initCornerEclipse() {
    eclipseLeft = document.querySelector(".bg-corner--left");
    eclipseRight = document.querySelector(".bg-corner--right");
    if (!eclipseLeft || !eclipseRight) return;

    eclipseMoon = eclipseRight.querySelector(".bg-corner__moon");
    if (!eclipseMoon) return;

    contentAlways = document.querySelectorAll(CONTENT_BOXES_ALWAYS);
    contentHome = document.querySelectorAll(CONTENT_BOXES_HOME);
    contentPage = document.querySelectorAll(CONTENT_BOXES_PAGE);
  }

  function initCursorStars() {
    starCanvas = document.getElementById("cursor-stars");
    if (!starCanvas || !starCanvas.getContext) return;

    starCtx = starCanvas.getContext("2d");
    resizeStarCanvas();
  }

  /* Stars and the eclipse share one set of pointer listeners: only one of
     them is ever live (dark vs day mode) and each bows out on its own */
  function initPointerEffects() {
    initCursorStars();
    initCornerEclipse();

    document.addEventListener(
      "mousemove",
      function (event) {
        handleStarPointer(event);
        updateEclipse(event);
      },
      { passive: true }
    );

    document.addEventListener("mouseleave", function () {
      releaseLiveStar();
      requestStarFrame();
      resetEclipse();
    });

    window.addEventListener("resize", function () {
      resizeStarCanvas();
      clearStars();
      resetEclipse();
    });
  }

  applyTheme(getPreferredTheme(), true);
  setBackgroundImagesEnabled(getBackgroundImagesEnabled());
  initPointerEffects();
  initFigureNav();
  initNavigation();
  initScrollView();
  setSimpleViewEnabled(getSimpleViewEnabled(), true);

  document.querySelectorAll(".theme-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const current = root.getAttribute("data-theme");
      applyTheme(current === "dark" ? "light" : "dark");
    });
  });

  document.querySelectorAll(".bg-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setBackgroundImagesEnabled(!root.classList.contains("bg-images-enabled"));
    });
  });

  document.querySelectorAll(".view-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setSimpleViewEnabled(!document.body.classList.contains("view-scroll"));
    });
  });

  /* Scrollbar visibility on scroll */
  let scrollTimeout;
  window.addEventListener(
    "scroll",
    function () {
      root.classList.add("is-scrolling");
      window.clearTimeout(scrollTimeout);
      scrollTimeout = window.setTimeout(function () {
        root.classList.remove("is-scrolling");
      }, 1000);
    },
    { passive: true }
  );
})();
