(function () {
  const storageKey = "theme";
  const root = document.documentElement;

  const mainImages = {
    light: "pictures/main-light.png",
    dark: "pictures/main-dark.png",
  };

  const THEME_TRANSITION_MS = Math.round(
    parseFloat(getComputedStyle(root).getPropertyValue("--theme-duration")) * 1000
  ) || 1100;
  const PAGE_TRANSITION_MS = 1400;
  const pages = ["publications", "research", "about"];
  const contentPath = "assets/content/";
  const contentCache = Object.create(null);

  let activeOverlay = -1;
  let currentSrc = "";
  let overlays = [];
  let currentPage = null;
  let isTransitioning = false;

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  async function renderPageContent(page) {
    const pageView = document.getElementById("page-view");
    pageView.innerHTML = "";

    try {
      let html = contentCache[page];
      if (!html) {
        const response = await fetch(contentPath + page + ".html");
        if (!response.ok) {
          throw new Error("Failed to load page");
        }
        html = await response.text();
        contentCache[page] = html;
      }
      pageView.innerHTML = html;
    } catch (err) {
      pageView.innerHTML =
        "<h1>Error</h1><p>Could not load this page. If you are previewing locally, run a local server (for example <code>npx serve .</code>).</p>";
    }

    pageView.scrollTop = 0;
  }

  function preloadPageContent() {
    pages.forEach(function (page) {
      fetch(contentPath + page + ".html")
        .then(function (response) {
          if (!response.ok) return "";
          return response.text();
        })
        .then(function (html) {
          if (html) contentCache[page] = html;
        })
        .catch(function () {});
    });
  }

  function setPageViewAccessibility(isVisible) {
    const pageView = document.getElementById("page-view");
    const landingView = document.getElementById("landing-view");
    if (pageView) pageView.setAttribute("aria-hidden", String(!isVisible));
    if (landingView) landingView.setAttribute("aria-hidden", String(isVisible));
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
    return document.querySelector('.figure-zone[data-zone="' + key + '"]');
  }

  function preloadImages() {
    const urls = new Set([
      mainImages.light,
      mainImages.dark,
      "pictures/sideLogo-light.png",
      "pictures/sideLogo-dark.png",
    ]);
    document.querySelectorAll(".figure-zone").forEach(function (zone) {
      urls.add(zone.getAttribute("data-img-light"));
      urls.add(zone.getAttribute("data-img-dark"));
    });
    urls.forEach(function (url) {
      if (!url) return;
      const img = new Image();
      img.src = url;
    });
  }

  function hideOverlays() {
    overlays.forEach(function (el) {
      el.classList.remove("is-visible");
    });
    activeOverlay = -1;
    currentSrc = "";
  }

  function resetFigureImage() {
    const base = document.getElementById("figure-base");
    hideOverlays();
    if (base) base.src = mainImages[getTheme()];
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

  function clearActiveNav() {
    setActiveNav(null);
  }

  function activateZone(key) {
    if (document.body.classList.contains("view-page")) return;
    const zone = getZoneByKey(key);
    if (!zone) return;
    setActiveNav(null);
    document.querySelectorAll(".site-list-item").forEach(function (item) {
      item.classList.toggle("is-active", item.getAttribute("data-zone") === key);
    });
    crossfadeTo(getZoneImage(zone));
  }

  function deactivateHover() {
    if (document.body.classList.contains("view-page")) return;
    clearActiveNav();
    resetFigureImage();
  }

  async function showHome(skipHistory, instant) {
    if (isTransitioning || document.body.classList.contains("view-home")) return;

    isTransitioning = true;
    currentPage = null;
    document.body.classList.remove("view-page");
    document.body.classList.add("view-home");
    clearActiveNav();
    resetFigureImage();
    setPageViewAccessibility(false);
    document.title = "Ambashri Purkayastha";

    if (!instant) {
      await wait(PAGE_TRANSITION_MS);
    }

    if (!skipHistory) {
      history.pushState({ page: null }, "", window.location.pathname);
    }
    isTransitioning = false;
  }

  async function loadPage(page, skipHistory, instant) {
    if (!pages.includes(page) || isTransitioning) return;
    if (currentPage === page && document.body.classList.contains("view-page")) return;

    const pageView = document.getElementById("page-view");
    const isHome = document.body.classList.contains("view-home");
    isTransitioning = true;

    if (isHome) {
      await renderPageContent(page);
      document.body.classList.remove("view-home");
      document.body.classList.add("view-page");
      setActiveNav(page);
      hideOverlays();
      setPageViewAccessibility(true);
    } else if (!instant) {
      pageView.classList.add("is-fading");
      await wait(PAGE_TRANSITION_MS / 2);
      await renderPageContent(page);
      setActiveNav(page);
      pageView.classList.remove("is-fading");
      await wait(PAGE_TRANSITION_MS / 2);
    } else {
      await renderPageContent(page);
      setActiveNav(page);
    }

    currentPage = page;

    const titles = {
      about: "About — Ambashri Purkayastha",
      publications: "Publications — Ambashri Purkayastha",
      research: "Research — Ambashri Purkayastha",
    };
    document.title = titles[page];

    if (!skipHistory) {
      history.pushState({ page: page }, "", "#" + page);
    }

    if (isHome && !instant) {
      await wait(PAGE_TRANSITION_MS);
    }

    isTransitioning = false;
  }

  function initNavigation() {
    document.addEventListener("click", function (event) {
      const link = event.target.closest("a[data-page]");
      if (!link) return;
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
    preloadImages();

    const landingStage = document.getElementById("landing-stage");
    overlays = [
      document.getElementById("figure-overlay-a"),
      document.getElementById("figure-overlay-b"),
    ].filter(Boolean);

    if (!landingStage || overlays.length < 2) return;

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

    landingStage.addEventListener("mouseleave", deactivateHover);

    landingStage.querySelectorAll(".figure-zone, .site-list-item").forEach(function (el) {
      el.addEventListener("blur", function () {
        if (!landingStage.matches(":hover") &&
            !landingStage.querySelector(".figure-zone:focus, .site-list-item:focus")) {
          deactivateHover();
        }
      });
    });
  }

  function applyTheme(theme, instant) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(storageKey, theme);

    const base = document.getElementById("figure-base");
    if (!base) return;

    if (instant) {
      base.src = mainImages[theme];
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
        base.src = mainImages[theme];
      }, THEME_TRANSITION_MS);
      return;
    }

    window.setTimeout(function () {
      if (document.body.classList.contains("view-home") &&
          !document.querySelector(".site-list-item.is-active")) {
        base.src = mainImages[theme];
        hideOverlays();
      }
    }, THEME_TRANSITION_MS);
  }

  applyTheme(getPreferredTheme(), true);
  initFigureNav();
  initNavigation();

  document.querySelectorAll(".theme-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const current = root.getAttribute("data-theme");
      applyTheme(current === "dark" ? "light" : "dark");
    });
  });
})();
