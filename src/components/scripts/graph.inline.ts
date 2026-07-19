// @ts-nocheck
import {
  removeAllChildren,
  getBasePath,
  getFullSlugFromUrl,
  simplifySlug,
  resolveBasePath,
} from "@quartz-community/utils";

(function () {
  function getSlugFromUrl() {
    var slug = getFullSlugFromUrl();
    var base = getBasePath();
    if (base && slug.startsWith(base.replace(/^\//, ""))) {
      slug = slug.slice(base.replace(/^\//, "").length);
      if (slug.startsWith("/")) slug = slug.slice(1);
    }
    return slug;
  }

  function loadScript(src) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.crossOrigin = "anonymous";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // d3 (~70KB) and pixi.js (~200KB, a full WebGL renderer) used to load
  // unconditionally on every page — even pages where the graph is never
  // scrolled to or opened. That's several seconds of JS parse/execute on
  // every single page view for a feature most visits never touch. Loading
  // is now deferred until a graph container is actually about to be seen
  // (see observeContainers' IntersectionObserver below) or the global graph
  // is opened via its icon/shortcut (see showGlobalGraph) — whichever comes
  // first. Memoized so repeated triggers across a page (local + global
  // graph both wanting it) share one load instead of racing separate ones;
  // reset on failure so a later trigger (e.g. the user reopening the global
  // graph after a network blip) gets to retry rather than staying broken
  // for the rest of the session.
  var libsPromise = null;
  function ensureLibs() {
    if (!libsPromise) {
      libsPromise = Promise.all([
        loadScript("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"),
        loadScript("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.js"),
      ]).catch(function (err) {
        libsPromise = null;
        throw err;
      });
    }
    return libsPromise;
  }

  function showLoadError(container) {
    container.textContent = "Graph could not load. Check your network connection.";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.color = "var(--gray)";
    container.style.fontSize = "0.9rem";
  }

  var localStorageKey = "graph-visited";

  function getVisited() {
    return new Set(JSON.parse(localStorage.getItem(localStorageKey) || "[]"));
  }

  function addToVisited(slug) {
    var visited = getVisited();
    visited.add(slug);
    localStorage.setItem(localStorageKey, JSON.stringify(Array.from(visited)));
  }

  // Resolves CSS color values containing calc()/var() that PixiJS cannot parse.
  // Uses a temp DOM element so the browser's CSS engine evaluates the expression.
  function resolveColor(value, fallback) {
    if (!value) return fallback;
    var el = document.createElement("div");
    el.style.color = value;
    el.style.position = "absolute";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    var resolved = getComputedStyle(el).color;
    el.remove();
    return resolved || fallback;
  }

  var currentRenderGeneration = 0;

  async function renderGraph(graph, fullSlug, renderGeneration) {
    var d3 = window.d3;
    var PIXI = window.PIXI;

    if (!d3 || !PIXI) {
      console.error("[Graph] Libraries not loaded");
      return function () {};
    }

    var slug = simplifySlug(fullSlug);
    if (slug === "") slug = "index";
    var visited = getVisited();
    removeAllChildren(graph);

    if (renderGeneration !== undefined && renderGeneration !== currentRenderGeneration) {
      console.log("[Graph] Stale render, skipping");
      return function () {};
    }

    var config = JSON.parse(graph.dataset["cfg"] || "{}");
    var enableDrag = config.drag;
    var enableZoom = config.zoom;
    var depth = config.depth;
    var scale = config.scale || 1;
    var repelForce = config.repelForce || 0.5;
    var centerForce = config.centerForce || 0.3;
    var linkDistance = config.linkDistance || 30;
    var fontSize = config.fontSize || 0.6;
    var opacityScale = config.opacityScale || 1;
    var removeTags = config.removeTags || [];
    var showTags = config.showTags;
    var focusOnHover = config.focusOnHover;
    var enableRadial = config.enableRadial;

    var data;
    try {
      var dataRaw = await fetchData;
      data = new Map();
      for (var key in dataRaw) {
        data.set(simplifySlug(key), dataRaw[key]);
      }
    } catch (err) {
      console.error("[Graph] Error loading data:", err);
      return function () {};
    }

    var width = graph.offsetWidth;
    var height = Math.max(graph.offsetHeight, 250);

    var links = [];
    var allTags = [];
    var validLinks = new Set(data.keys());

    data.forEach(function (details, source) {
      var outgoing = details.links || [];
      for (var i = 0; i < outgoing.length; i++) {
        var dest = simplifySlug(outgoing[i]);
        if (validLinks.has(dest)) {
          links.push({ source: source, target: dest });
        }
      }

      if (showTags) {
        var tags = details.tags || [];
        for (var i = 0; i < tags.length; i++) {
          var tag = tags[i];
          if (removeTags.indexOf(tag) === -1) {
            var tagSlug = simplifySlug("tags/" + tag);
            if (allTags.indexOf(tagSlug) === -1) {
              allTags.push(tagSlug);
            }
            links.push({ source: source, target: tagSlug });
          }
        }
      }
    });

    var neighbourhood = new Set();
    if (depth >= 0) {
      var queue = [slug];
      var seen = new Set([slug]);
      for (var d = 0; d <= depth && queue.length > 0; d++) {
        var nextQueue = [];
        for (var qi = 0; qi < queue.length; qi++) {
          var cur = queue[qi];
          neighbourhood.add(cur);
          for (var li = 0; li < links.length; li++) {
            var link = links[li];
            if (link.source === cur && !seen.has(link.target)) {
              seen.add(link.target);
              nextQueue.push(link.target);
            }
            if (link.target === cur && !seen.has(link.source)) {
              seen.add(link.source);
              nextQueue.push(link.source);
            }
          }
        }
        queue = nextQueue;
      }
    } else {
      validLinks.forEach(function (id) {
        neighbourhood.add(id);
      });
      for (var i = 0; i < allTags.length; i++) {
        neighbourhood.add(allTags[i]);
      }
    }

    var nodes = [];
    var nodeMap = new Map();
    neighbourhood.forEach(function (url) {
      var isTag = url.startsWith("tags/");
      var text = isTag ? "#" + url.substring(5) : data.get(url)?.title || url;
      var nodeTags = isTag ? [] : data.get(url)?.tags || [];
      var node = {
        id: url,
        text: text,
        tags: nodeTags,
        x: Math.random() * width - width / 2,
        y: Math.random() * height - height / 2,
        vx: 0,
        vy: 0,
      };
      nodes.push(node);
      nodeMap.set(url, node);
    });

    var graphLinks = [];
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (neighbourhood.has(link.source) && neighbourhood.has(link.target)) {
        var sourceNode = nodeMap.get(link.source);
        var targetNode = nodeMap.get(link.target);
        if (sourceNode && targetNode) {
          graphLinks.push({ source: sourceNode, target: targetNode });
        }
      }
    }

    var styles = getComputedStyle(document.documentElement);
    var secondary = resolveColor(styles.getPropertyValue("--secondary").trim(), "#c792ea");
    var tertiary = resolveColor(styles.getPropertyValue("--tertiary").trim(), "#82aaff");
    var gray = resolveColor(styles.getPropertyValue("--gray").trim(), "#6c6c6c");
    var lightgray = resolveColor(styles.getPropertyValue("--lightgray").trim(), "#d4d4d4");
    var dark = resolveColor(styles.getPropertyValue("--dark").trim(), "#1a1a1a");
    var light = resolveColor(styles.getPropertyValue("--light").trim(), "#f5f5f5");
    var bodyFont = styles.getPropertyValue("--bodyFont").trim() || "inherit";

    var app = new PIXI.Application();
    await app.init({
      width: width,
      height: height,
      antialias: true,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      eventMode: "static",
    });

    graph.appendChild(app.canvas);

    var stage = new PIXI.Container();
    app.stage.addChild(stage);

    var simulation = d3
      .forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(-100 * repelForce))
      .force("center", d3.forceCenter().strength(centerForce))
      .force("link", d3.forceLink(graphLinks).distance(linkDistance))
      .force(
        "collide",
        d3
          .forceCollide()
          .radius(function (d) {
            var numLinks = 0;
            for (var i = 0; i < graphLinks.length; i++) {
              if (graphLinks[i].source.id === d.id || graphLinks[i].target.id === d.id) {
                numLinks++;
              }
            }
            return 2 + Math.sqrt(numLinks);
          })
          .iterations(3),
      );

    if (enableRadial) {
      var radius = (Math.min(width, height) / 2) * 0.8;
      simulation.force("radial", d3.forceRadial(radius).strength(0.2));
    }

    var linkContainer = new PIXI.Container();
    var nodesContainer = new PIXI.Container();
    var labelsContainer = new PIXI.Container();
    stage.addChild(linkContainer);
    stage.addChild(nodesContainer);
    stage.addChild(labelsContainer);

    var nodeRenderData = [];
    var linkRenderData = [];
    var hoveredNodeId = null;
    var hoveredNeighbours = new Set();
    var dragStartTime = 0;
    var dragging = false;
    var currentTransform = d3.zoomIdentity;

    function nodeRadius(d) {
      var numLinks = 0;
      for (var i = 0; i < graphLinks.length; i++) {
        if (graphLinks[i].source.id === d.id || graphLinks[i].target.id === d.id) {
          numLinks++;
        }
      }
      return 2 + Math.sqrt(numLinks);
    }

    function nodeColor(d) {
      var isCurrent = d.id === slug;
      if (isCurrent) {
        return secondary;
      } else if (visited.has(d.id) || d.id.startsWith("tags/")) {
        return tertiary;
      } else {
        return gray;
      }
    }

    function updateHoverInfo(newHoveredId) {
      hoveredNodeId = newHoveredId;

      if (newHoveredId === null) {
        hoveredNeighbours = new Set();
        for (var i = 0; i < nodeRenderData.length; i++) {
          nodeRenderData[i].active = false;
        }
        for (var i = 0; i < linkRenderData.length; i++) {
          linkRenderData[i].active = false;
        }
      } else {
        hoveredNeighbours = new Set();

        for (var i = 0; i < linkRenderData.length; i++) {
          var linkData = linkRenderData[i].simulationData;
          if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
            hoveredNeighbours.add(linkData.source.id);
            hoveredNeighbours.add(linkData.target.id);
            linkRenderData[i].active = true;
          } else {
            linkRenderData[i].active = false;
          }
        }

        hoveredNeighbours.add(newHoveredId);

        for (var i = 0; i < nodeRenderData.length; i++) {
          if (hoveredNeighbours.has(nodeRenderData[i].simulationData.id)) {
            nodeRenderData[i].active = true;
          } else {
            nodeRenderData[i].active = false;
          }
        }
      }
    }

    function renderLinks() {
      for (var i = 0; i < linkRenderData.length; i++) {
        var linkData = linkRenderData[i];
        var alpha = 1;
        if (hoveredNodeId !== null) {
          alpha = linkData.active ? 1 : 0.2;
        }
        linkData.alpha = alpha;
        linkData.color = linkData.active ? gray : lightgray;
      }
    }

    function renderLabels() {
      var defaultScale = 1 / scale;
      var activeScale = defaultScale * 1.1;

      for (var i = 0; i < nodeRenderData.length; i++) {
        var nodeData = nodeRenderData[i];
        if (hoveredNodeId === nodeData.simulationData.id) {
          nodeData.label.alpha = 1;
          nodeData.label.scale.set(activeScale);
        } else {
          nodeData.label.scale.set(defaultScale);
        }
      }
    }

    function renderNodes() {
      for (var i = 0; i < nodeRenderData.length; i++) {
        var nodeData = nodeRenderData[i];
        var alpha = 1;
        if (hoveredNodeId !== null && focusOnHover) {
          alpha = nodeData.active ? 1 : 0.2;
        }
        nodeData.gfx.alpha = alpha;
      }
    }

    function renderPixiFromD3() {
      renderNodes();
      renderLinks();
      renderLabels();
    }

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var nodeId = node.id;
      var isTagNode = nodeId.startsWith("tags/");
      var radius = nodeRadius(node);
      var color = nodeColor(node);

      var label = new PIXI.Text({
        text: node.text,
        style: {
          fontSize: fontSize * 15,
          fill: dark,
          fontFamily: bodyFont,
        },
        resolution: window.devicePixelRatio * 4,
      });
      label.anchor.set(0.5, 1.2);
      label.alpha = 0;
      label.scale.set(1 / scale);
      labelsContainer.addChild(label);

      var gfx = new PIXI.Graphics();
      gfx.circle(0, 0, radius);
      gfx.fill({ color: isTagNode ? light : color });
      if (isTagNode) {
        gfx.stroke({ width: 2, color: tertiary });
      }

      gfx.eventMode = "static";
      gfx.cursor = "pointer";
      gfx.label = nodeId;

      (function (n, g, labelRef) {
        var oldLabelOpacity = 0;
        g.on("pointerover", function (e) {
          updateHoverInfo(n.id);
          oldLabelOpacity = labelRef.alpha;
          if (!dragging) {
            renderPixiFromD3();
          }
        });

        g.on("pointerleave", function () {
          updateHoverInfo(null);
          labelRef.alpha = oldLabelOpacity;
          if (!dragging) {
            renderPixiFromD3();
          }
        });
      })(node, gfx, label);

      nodesContainer.addChild(gfx);

      nodeRenderData.push({
        simulationData: node,
        gfx: gfx,
        label: label,
        color: color,
        alpha: 1,
        active: false,
      });
    }

    for (var i = 0; i < graphLinks.length; i++) {
      var link = graphLinks[i];
      var gfx = new PIXI.Graphics();
      gfx.eventMode = "none";
      linkContainer.addChild(gfx);

      linkRenderData.push({
        simulationData: link,
        gfx: gfx,
        color: lightgray,
        alpha: 1,
        active: false,
      });
    }

    if (enableDrag) {
      var dragSubject = function (event) {
        var mouseX = (event.x - currentTransform.x) / currentTransform.k;
        var mouseY = (event.y - currentTransform.y) / currentTransform.k;

        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var dx = mouseX - n.x - width / 2;
          var dy = mouseY - n.y - height / 2;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var rad = nodeRadius(n);
          if (dist < rad + 5) {
            return n;
          }
        }
        return null;
      };

      var dragStarted = function (event) {
        if (!event.active) simulation.alphaTarget(1).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
        var mouseSimX = (event.x - currentTransform.x) / currentTransform.k - width / 2;
        var mouseSimY = (event.y - currentTransform.y) / currentTransform.k - height / 2;
        event.subject.__dragOffset = {
          x: mouseSimX - event.subject.x,
          y: mouseSimY - event.subject.y,
        };
        dragStartTime = Date.now();
        dragging = true;
        hoveredNodeId = event.subject.id;
      };

      var dragDragged = function (event) {
        var mouseSimX = (event.x - currentTransform.x) / currentTransform.k - width / 2;
        var mouseSimY = (event.y - currentTransform.y) / currentTransform.k - height / 2;
        event.subject.fx = mouseSimX - event.subject.__dragOffset.x;
        event.subject.fy = mouseSimY - event.subject.__dragOffset.y;
      };

      var dragEnded = function (event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
        dragging = false;
        updateHoverInfo(null);
        renderPixiFromD3();

        if (Date.now() - dragStartTime < 500) {
          var target = resolveBasePath(event.subject.id);
          window.location.href = target;
        }
      };

      var drag = d3
        .drag()
        .container(app.canvas)
        .subject(dragSubject)
        .on("start", dragStarted)
        .on("drag", dragDragged)
        .on("end", dragEnded);

      d3.select(app.canvas).call(drag);
    } else {
      for (var i = 0; i < nodeRenderData.length; i++) {
        (function (nodeData) {
          nodeData.gfx.on("click", function () {
            var target = resolveBasePath(nodeData.simulationData.id);
            window.location.href = target;
          });
        })(nodeRenderData[i]);
      }
    }

    if (enableZoom) {
      var zoomed = function (event) {
        currentTransform = event.transform;
        stage.scale.set(currentTransform.k, currentTransform.k);
        stage.position.set(currentTransform.x, currentTransform.y);

        var newScale = currentTransform.k * opacityScale;
        var scaleOpacity = Math.max((newScale - 1) / 3.75, 0);

        var activeLabels = [];
        for (var i = 0; i < nodeRenderData.length; i++) {
          if (nodeRenderData[i].active) {
            activeLabels.push(nodeRenderData[i].label);
          }
        }

        for (var i = 0; i < labelsContainer.children.length; i++) {
          var label = labelsContainer.children[i];
          if (activeLabels.indexOf(label) === -1) {
            label.alpha = scaleOpacity;
          }
        }
      };

      var zoom = d3
        .zoom()
        .extent([
          [0, 0],
          [width, height],
        ])
        .scaleExtent([0.25, 4])
        .on("zoom", zoomed);

      d3.select(app.canvas).call(zoom);
    }

    var stopAnimation = false;
    function animate() {
      if (stopAnimation) return;

      for (var i = 0; i < nodeRenderData.length; i++) {
        var n = nodeRenderData[i];
        var x = n.simulationData.x;
        var y = n.simulationData.y;
        if (x != null && y != null) {
          n.gfx.position.set(x + width / 2, y + height / 2);
          if (n.label) {
            n.label.position.set(x + width / 2, y + height / 2);
          }
        }
      }

      for (var i = 0; i < linkRenderData.length; i++) {
        var l = linkRenderData[i];
        var linkData = l.simulationData;
        var sx = linkData.source.x;
        var sy = linkData.source.y;
        var tx = linkData.target.x;
        var ty = linkData.target.y;
        if (sx != null && sy != null && tx != null && ty != null) {
          l.gfx.clear();
          l.gfx.moveTo(sx + width / 2, sy + height / 2);
          l.gfx.lineTo(tx + width / 2, ty + height / 2);
          l.gfx.stroke({ alpha: l.alpha, width: 1, color: l.color });
        }
      }

      requestAnimationFrame(animate);
    }

    simulation.on("tick", function () {});
    simulation.restart();
    renderPixiFromD3();
    animate();

    return function () {
      stopAnimation = true;
      simulation.stop();
      try {
        app.destroy(true);
      } catch (_) {
        // PixiJS may throw if WebGL context was already lost.
      }
    };
  }

  var localCleanups = [];
  var globalCleanups = [];

  function cleanupLocal() {
    for (var i = 0; i < localCleanups.length; i++) {
      localCleanups[i]();
    }
    localCleanups = [];
  }

  function cleanupGlobal() {
    for (var i = 0; i < globalCleanups.length; i++) {
      globalCleanups[i]();
    }
    globalCleanups = [];
  }

  var globalContainers = [];
  var globalIcons = [];
  var documentClickHandler = null;
  var documentKeydownHandler = null;
  var iconClickHandler = null;
  var localContainerObserver = null;

  function hideGlobalGraph() {
    cleanupGlobal();
    for (var i = 0; i < globalContainers.length; i++) {
      globalContainers[i].classList.remove("active");
      var sidebar = globalContainers[i].closest(".sidebar");
      if (sidebar) {
        sidebar.style.zIndex = "";
      }
    }
  }

  function anyGlobalGraphActive() {
    for (var i = 0; i < globalContainers.length; i++) {
      if (globalContainers[i].classList.contains("active")) {
        return true;
      }
    }
    return false;
  }

  // The global (fullscreen) graph already only ever rendered on demand — a
  // user opening it via its icon or Ctrl/Cmd+G — so it needed no visibility
  // gating of its own; it just needs the same deferred-library load as the
  // local one, since that's what used to force d3/pixi.js onto every page
  // regardless of whether this was ever opened.
  function showGlobalGraph() {
    cleanupGlobal();
    var currentSlug = getSlugFromUrl();
    for (var i = 0; i < globalContainers.length; i++) {
      var container = globalContainers[i];
      container.classList.add("active");
      var sidebar = container.closest(".sidebar");
      if (sidebar) {
        sidebar.style.zIndex = "1";
      }

      var graphContainer = container.querySelector(".global-graph-container");
      if (graphContainer) {
        (function (gc) {
          ensureLibs()
            .then(function () {
              return renderGraph(gc, currentSlug, undefined);
            })
            .then(function (cleanup) {
              globalCleanups.push(cleanup);
            })
            .catch(function (err) {
              console.error("[Graph] Global render error:", err);
              showLoadError(gc);
            });
        })(graphContainer);
      }
    }
  }

  function toggleGlobalGraph() {
    if (anyGlobalGraphActive()) {
      hideGlobalGraph();
    } else {
      showGlobalGraph();
    }
  }

  // The local (sidebar/inline) graph preview is on every single page, so
  // unlike the global one it can't just gate on "was it opened" — it's
  // opened by definition. Instead each container gets its own
  // IntersectionObserver: the render (and, the first time anywhere on the
  // page, the d3/pixi.js load behind it) is deferred until that particular
  // container is about to actually be seen. rootMargin gives it a 200px
  // head start so it's ready by the time it's actually scrolled into view
  // rather than flashing an empty box first; a container already on screen
  // when the observer is created (the common case — e.g. the desktop
  // sidebar copy) fires essentially immediately, so visible behavior is
  // unchanged there. What changes is a below-the-fold copy (e.g. the mobile
  // afterBody one, sitting under the whole article) no longer costs
  // anything until scrolled to — most page visits never will.
  function observeContainers(containers, slug, generation) {
    if (localContainerObserver) {
      localContainerObserver.disconnect();
    }
    localContainerObserver = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          var container = entries[i].target;
          localContainerObserver.unobserve(container);
          ensureLibs()
            .then(function () {
              return renderGraph(container, slug, generation);
            })
            .then(function (cleanup) {
              if (generation === currentRenderGeneration) {
                localCleanups.push(cleanup);
              } else {
                cleanup();
              }
            })
            .catch(function (err) {
              console.error("[Graph] Local render error:", err);
              showLoadError(container);
            });
        }
      },
      { rootMargin: "200px" },
    );
    for (var i = 0; i < containers.length; i++) {
      localContainerObserver.observe(containers[i]);
    }
  }

  function renderLocal() {
    cleanupLocal();
    if (localContainerObserver) {
      localContainerObserver.disconnect();
      localContainerObserver = null;
    }
    currentRenderGeneration++;
    var thisGeneration = currentRenderGeneration;
    var slug = getSlugFromUrl();
    addToVisited(slug);

    var localContainers = document.querySelectorAll(".graph-container");
    if (localContainers.length > 0) {
      observeContainers(Array.from(localContainers), slug, thisGeneration);
    }
  }

  function handleNav(e) {
    var slug = e.detail ? e.detail.url : getSlugFromUrl();
    addToVisited(simplifySlug(slug));

    renderLocal();

    globalContainers = Array.from(document.querySelectorAll(".global-graph-outer"));

    if (iconClickHandler) {
      for (var i = 0; i < globalIcons.length; i++) {
        globalIcons[i].removeEventListener("click", iconClickHandler);
      }
    }

    globalIcons = Array.from(document.querySelectorAll(".global-graph-icon"));
    iconClickHandler = function () {
      toggleGlobalGraph();
    };
    for (var i = 0; i < globalIcons.length; i++) {
      globalIcons[i].addEventListener("click", iconClickHandler);
    }

    if (documentClickHandler) {
      document.removeEventListener("click", documentClickHandler);
    }
    documentClickHandler = function (e) {
      if (anyGlobalGraphActive()) {
        var inContainer = e.target.closest(".global-graph-container");
        var inIcon = e.target.closest(".global-graph-icon");
        if (!inContainer && !inIcon) {
          hideGlobalGraph();
        }
      }
    };
    document.addEventListener("click", documentClickHandler);

    if (documentKeydownHandler) {
      document.removeEventListener("keydown", documentKeydownHandler);
    }
    documentKeydownHandler = function (e) {
      if (e.key === "Escape") {
        if (anyGlobalGraphActive()) {
          hideGlobalGraph();
        }
        return;
      }

      if (e.key === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        toggleGlobalGraph();
      }
    };
    document.addEventListener("keydown", documentKeydownHandler);

    if (anyGlobalGraphActive()) {
      showGlobalGraph();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      handleNav({ detail: { url: getSlugFromUrl() } });
    });
  } else {
    handleNav({ detail: { url: getSlugFromUrl() } });
  }
  document.addEventListener("prenav", function () {
    cleanupLocal();
    cleanupGlobal();
    if (localContainerObserver) {
      localContainerObserver.disconnect();
      localContainerObserver = null;
    }
  });
  document.addEventListener("nav", handleNav);
  document.addEventListener("render", handleNav);

  function handleThemeChange() {
    renderLocal();
    if (anyGlobalGraphActive()) {
      showGlobalGraph();
    }
  }
  document.addEventListener("themechange", handleThemeChange);
})();
