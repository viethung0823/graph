import type { VNode, JSX } from "preact";

type GlobalConfiguration = {
  pageTitle: string;
  pageTitleSuffix?: string;
  enableSPA: boolean;
  enablePopovers: boolean;
  analytics: any;
  ignorePatterns: string[];
  defaultDateType: string;
  baseUrl?: string;
  theme: any;
  locale: string;
  [key: string]: any;
};

type QuartzConfig = {
  configuration: GlobalConfiguration;
  plugins: any;
  externalPlugins?: any[];
};

type QuartzPluginData = {
  slug: string;
  title: string;
  filePath: string;
  [key: string]: any;
};

type BuildCtx = {
  cfg: QuartzConfig;
  allFiles: QuartzPluginData[];
  [key: string]: any;
};

type StaticResources = {
  css: Array<{ content: string }>;
  js: Array<{ src?: string; content?: string; loadTime: string; moduleType?: string }>;
};

export type QuartzComponentProps = {
  ctx: BuildCtx;
  externalResources: StaticResources;
  fileData: QuartzPluginData;
  cfg: GlobalConfiguration;
  children: any[];
  tree: any;
  allFiles: QuartzPluginData[];
  displayClass?: "mobile-only" | "desktop-only";
} & JSX.IntrinsicAttributes & {
    [key: string]: any;
  };

export type QuartzComponent = ((props: QuartzComponentProps) => VNode) & {
  css?: string | undefined;
  beforeDOMLoaded?: string | undefined;
  afterDOMLoaded?: string | undefined;
};

export type QuartzComponentConstructor<Options extends object | undefined = undefined> = (
  opts: Options,
) => QuartzComponent;

export interface D3Config {
  drag: boolean;
  zoom: boolean;
  depth: number;
  scale: number;
  repelForce: number;
  centerForce: number;
  linkDistance: number;
  fontSize: number;
  opacityScale: number;
  removeTags: string[];
  showTags: boolean;
  focusOnHover?: boolean;
  enableRadial?: boolean;
}

interface GraphOptions {
  localGraph: Partial<D3Config> | undefined;
  globalGraph: Partial<D3Config> | undefined;
}

const defaultOptions: GraphOptions = {
  localGraph: {
    drag: true,
    zoom: true,
    depth: 1,
    scale: 1.1,
    repelForce: 0.5,
    centerForce: 0.3,
    linkDistance: 30,
    fontSize: 0.6,
    opacityScale: 1,
    showTags: true,
    removeTags: [],
    focusOnHover: false,
    enableRadial: false,
  },
  globalGraph: {
    drag: true,
    zoom: true,
    depth: -1,
    scale: 0.9,
    repelForce: 0.5,
    centerForce: 0.2,
    linkDistance: 30,
    fontSize: 0.6,
    opacityScale: 1,
    showTags: true,
    removeTags: [],
    focusOnHover: true,
    enableRadial: true,
  },
};

function classNames(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

const graphStyles = `
.graph {
  & > h3 {
    font-size: 1rem;
    margin: 0;
  }

  & > .graph-outer {
    border-radius: 5px;
    border: 1px solid var(--lightgray);
    box-sizing: border-box;
    height: 250px;
    margin: 0.5em 0;
    position: relative;
    overflow: hidden;

    & > .global-graph-icon {
      cursor: pointer;
      background: none;
      border: none;
      color: var(--dark);
      opacity: 0.5;
      width: 24px;
      height: 24px;
      position: absolute;
      padding: 0.2rem;
      margin: 0.3rem;
      top: 0;
      right: 0;
      border-radius: 4px;
      background-color: transparent;
      transition: background-color 0.5s ease;
      z-index: 10;
      &:hover {
        background-color: var(--lightgray);
      }
    }
  }

  & > .global-graph-outer {
    position: fixed;
    z-index: 100000;
    left: 0;
    top: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: none;
    overflow: hidden;

    &.active {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    & > .global-graph-container {
      border: 1px solid var(--lightgray);
      background-color: var(--light);
      border-radius: 5px;
      box-sizing: border-box;
      position: relative;
      height: 80vh;
      width: 80vw;
      z-index: 100001;

      @media all and not (min-width: 1200px) {
        width: 90%;
      }
    }
  }
}
`;

const graphScript = `
(function() {
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  Promise.all([
    loadScript("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js")
  ]).then(function() {
    initGraph();
  }).catch(function(err) {
    console.error("[Graph] Failed to load libraries:", err);
  });

  function initGraph() {
    var d3 = window.d3;
    var PIXI = window.PIXI;
    
    if (!d3 || !PIXI) {
      console.error("[Graph] Libraries not loaded");
      return;
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

    function removeAllChildren(element) {
      while (element.firstChild) {
        element.removeChild(element.firstChild);
      }
    }

    function getFullSlug() {
      var url = window.location.pathname;
      var rawSlug = url;
      if (rawSlug.endsWith("/")) rawSlug = rawSlug.slice(0, -1);
      if (rawSlug.startsWith("/")) rawSlug = rawSlug.slice(1);
      return rawSlug;
    }

    function simplifySlug(slug) {
      if (slug.endsWith("/index")) return slug.slice(0, -6);
      return slug;
    }

    function resolvePath(to) {
      if (to.startsWith("/")) return to;
      return "/" + to;
    }

    async function renderGraph(graph, fullSlug) {
      var slug = simplifySlug(fullSlug);
      var visited = getVisited();
      removeAllChildren(graph);

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
        var response = await fetch("/static/contentIndex.json");
        var dataRaw = await response.json();
        data = new Map();
        for (var key in dataRaw) {
          data.set(simplifySlug(key), dataRaw[key]);
        }
      } catch (err) {
        console.error("[Graph] Error loading data:", err);
        return function() {};
      }

      var width = graph.offsetWidth;
      var height = Math.max(graph.offsetHeight, 250);

      var links = [];
      var allTags = [];
      var validLinks = new Set(data.keys());

      data.forEach(function(details, source) {
        var outgoing = details.links || [];
        for (var i = 0; i < outgoing.length; i++) {
          var dest = outgoing[i];
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
        validLinks.forEach(function(id) { neighbourhood.add(id); });
        for (var i = 0; i < allTags.length; i++) {
          neighbourhood.add(allTags[i]);
        }
      }

      var nodes = [];
      var nodeMap = new Map();
      neighbourhood.forEach(function(url) {
        var isTag = url.startsWith("tags/");
        var text = isTag ? "#" + url.substring(5) : (data.get(url)?.title || url);
        var nodeTags = isTag ? [] : (data.get(url)?.tags || []);
        var node = {
          id: url,
          text: text,
          tags: nodeTags,
          x: Math.random() * width - width / 2,
          y: Math.random() * height - height / 2,
          vx: 0,
          vy: 0
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
      var secondary = styles.getPropertyValue("--secondary").trim() || "#c792ea";
      var tertiary = styles.getPropertyValue("--tertiary").trim() || "#82aaff";
      var gray = styles.getPropertyValue("--gray").trim() || "#6c6c6c";
      var lightgray = styles.getPropertyValue("--lightgray").trim() || "#d4d4d4";
      var dark = styles.getPropertyValue("--dark").trim() || "#1a1a1a";
      var light = styles.getPropertyValue("--light").trim() || "#f5f5f5";
      var bodyFont = styles.getPropertyValue("--bodyFont").trim() || "inherit";

      var app = new PIXI.Application();
      await app.init({
        width: width,
        height: height,
        antialias: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        eventMode: "static"
      });
      
      graph.appendChild(app.canvas);

      var stage = new PIXI.Container();
      app.stage.addChild(stage);

      var simulation = d3.forceSimulation(nodes)
        .force("charge", d3.forceManyBody().strength(-100 * repelForce))
        .force("center", d3.forceCenter().strength(centerForce))
        .force("link", d3.forceLink(graphLinks).distance(linkDistance))
        .force("collide", d3.forceCollide().radius(function(d) {
          var numLinks = 0;
          for (var i = 0; i < graphLinks.length; i++) {
            if (graphLinks[i].source.id === d.id || graphLinks[i].target.id === d.id) {
              numLinks++;
            }
          }
          return 2 + Math.sqrt(numLinks);
        }).iterations(3));

      if (enableRadial) {
        var radius = Math.min(width, height) / 2 * 0.8;
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
            nodeRenderData[i].gfx.alpha = 1;
            nodeRenderData[i].label.alpha = 0;
          }
          for (var i = 0; i < linkRenderData.length; i++) {
            linkRenderData[i].active = false;
            linkRenderData[i].gfx.alpha = 1;
          }
        } else {
          hoveredNeighbours = new Set();
          hoveredNeighbours.add(newHoveredId);
          
          for (var i = 0; i < linkRenderData.length; i++) {
            var linkData = linkRenderData[i].simulationData;
            if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
              hoveredNeighbours.add(linkData.source.id);
              hoveredNeighbours.add(linkData.target.id);
              linkRenderData[i].active = true;
              linkRenderData[i].gfx.alpha = 1;
            } else {
              linkRenderData[i].active = false;
              linkRenderData[i].gfx.alpha = 0.2;
            }
          }

          for (var i = 0; i < nodeRenderData.length; i++) {
            if (hoveredNeighbours.has(nodeRenderData[i].simulationData.id)) {
              nodeRenderData[i].active = true;
              nodeRenderData[i].gfx.alpha = 1;
              nodeRenderData[i].label.alpha = 1;
            } else {
              nodeRenderData[i].active = false;
              if (focusOnHover) {
                nodeRenderData[i].gfx.alpha = 0.2;
                nodeRenderData[i].label.alpha = 0;
              }
            }
          }
        }
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
            fontFamily: bodyFont
          },
          resolution: window.devicePixelRatio * 4
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
        
        (function(n, g) {
          g.on("pointerover", function(e) {
            updateHoverInfo(n.id);
          });
          
          g.on("pointerleave", function() {
            updateHoverInfo(null);
          });
        })(node, gfx);
        
        nodesContainer.addChild(gfx);

        nodeRenderData.push({
          simulationData: node,
          gfx: gfx,
          label: label,
          color: color,
          alpha: 1,
          active: false
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
          active: false
        });
      }

      if (enableDrag) {
        var dragSubject = function(event) {
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

        var dragStarted = function(event) {
          if (!event.active) simulation.alphaTarget(1).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
          var mouseSimX = (event.x - currentTransform.x) / currentTransform.k - width / 2;
          var mouseSimY = (event.y - currentTransform.y) / currentTransform.k - height / 2;
          event.subject.__dragOffset = {
            x: mouseSimX - event.subject.x,
            y: mouseSimY - event.subject.y
          };
          dragStartTime = Date.now();
          dragging = true;
          hoveredNodeId = event.subject.id;
        };

        var dragDragged = function(event) {
          var mouseSimX = (event.x - currentTransform.x) / currentTransform.k - width / 2;
          var mouseSimY = (event.y - currentTransform.y) / currentTransform.k - height / 2;
          event.subject.fx = mouseSimX - event.subject.__dragOffset.x;
          event.subject.fy = mouseSimY - event.subject.__dragOffset.y;
        };

        var dragEnded = function(event) {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
          dragging = false;
          hoveredNodeId = null;

          if (Date.now() - dragStartTime < 500) {
            var target = resolvePath(event.subject.id);
            window.location.href = target;
          }
        };

        var drag = d3.drag()
          .container(app.canvas)
          .subject(dragSubject)
          .on("start", dragStarted)
          .on("drag", dragDragged)
          .on("end", dragEnded);

        d3.select(app.canvas).call(drag);
      } else {
        for (var i = 0; i < nodeRenderData.length; i++) {
          (function(nodeData) {
            nodeData.gfx.on("click", function() {
              var target = resolvePath(nodeData.simulationData.id);
              window.location.href = target;
            });
          })(nodeRenderData[i]);
        }
      }

      if (enableZoom) {
        var zoomed = function(event) {
          currentTransform = event.transform;
          stage.scale.set(currentTransform.k, currentTransform.k);
          stage.position.set(currentTransform.x, currentTransform.y);

          var newScale = currentTransform.k * opacityScale;
          var scaleOpacity = Math.max((newScale - 1) / 3.75, 0);
          
          for (var i = 0; i < labelsContainer.children.length; i++) {
            var label = labelsContainer.children[i];
            var isActive = false;
            for (var j = 0; j < nodeRenderData.length; j++) {
              if (nodeRenderData[j].active && nodeRenderData[j].label === label) {
                isActive = true;
                break;
              }
            }
            if (!isActive) {
              label.alpha = scaleOpacity;
            }
          }
        };

        var zoom = d3.zoom()
          .extent([[0, 0], [width, height]])
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

      simulation.on("tick", function() {});
      simulation.restart();
      animate();

      return function() {
        stopAnimation = true;
        simulation.stop();
        app.destroy(true);
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

    function renderLocal() {
      cleanupLocal();
      var slug = getFullSlug();
      addToVisited(slug);
      
      var localContainers = document.querySelectorAll(".graph-container");
      for (var i = 0; i < localContainers.length; i++) {
        (function(container) {
          renderGraph(container, slug).then(function(cleanup) {
            localCleanups.push(cleanup);
          }).catch(function(err) {
            console.error("[Graph] Local render error:", err);
          });
        })(localContainers[i]);
      }
    }

    function handleNav(e) {
      var slug = e.detail ? e.detail.url : getFullSlug();
      addToVisited(simplifySlug(slug));
      
      renderLocal();

      globalContainers = Array.from(document.querySelectorAll(".global-graph-outer"));
      
      function showGlobal() {
        cleanupGlobal();
        var currentSlug = getFullSlug();
        for (var i = 0; i < globalContainers.length; i++) {
          var container = globalContainers[i];
          container.classList.add("active");
          var sidebar = container.closest(".sidebar");
          if (sidebar) {
            sidebar.style.zIndex = "1";
          }
          
          var graphContainer = container.querySelector(".global-graph-container");
          if (graphContainer) {
            (function(gc) {
              renderGraph(gc, currentSlug).then(function(cleanup) {
                globalCleanups.push(cleanup);
              }).catch(function(err) {
                console.error("[Graph] Global render error:", err);
              });
            })(graphContainer);
          }
        }
      }

      var icons = document.querySelectorAll(".global-graph-icon");
      for (var i = 0; i < icons.length; i++) {
        icons[i].addEventListener("click", function() {
          var isActive = false;
          for (var j = 0; j < globalContainers.length; j++) {
            if (globalContainers[j].classList.contains("active")) {
              isActive = true;
              break;
            }
          }
          if (isActive) {
            hideGlobalGraph();
          } else {
            showGlobal();
          }
        });
      }

      document.addEventListener("click", function(e) {
        var isActive = false;
        for (var i = 0; i < globalContainers.length; i++) {
          if (globalContainers[i].classList.contains("active")) {
            isActive = true;
            break;
          }
        }
        if (isActive) {
          var inContainer = e.target.closest(".global-graph-container");
          var inIcon = e.target.closest(".global-graph-icon");
          if (!inContainer && !inIcon) {
            hideGlobalGraph();
          }
        }
      });

      document.addEventListener("keydown", function(e) {
        if (e.key === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault();
          var isActive = false;
          for (var i = 0; i < globalContainers.length; i++) {
            if (globalContainers[i].classList.contains("active")) {
              isActive = true;
              break;
            }
          }
          if (isActive) {
            hideGlobalGraph();
          } else {
            showGlobal();
          }
        }
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function() {
        handleNav({ detail: { url: getFullSlug() } });
      });
    } else {
      handleNav({ detail: { url: getFullSlug() } });
    }
    document.addEventListener("nav", handleNav);
  }
})();
`;

export const Graph: QuartzComponentConstructor<Partial<GraphOptions>> = (userOpts) => {
  const GraphComponent: QuartzComponent = ({ displayClass, cfg }: QuartzComponentProps) => {
    const localGraph = { ...defaultOptions.localGraph, ...userOpts?.localGraph };
    const globalGraph = { ...defaultOptions.globalGraph, ...userOpts?.globalGraph };

    const locale = cfg?.locale || "en-US";

    const translations: Record<string, { title: string }> = {
      "ar-SA": { title: "التمثيل التفاعلي" },
      "ca-ES": { title: "Vista Gràfica" },
      "cs-CZ": { title: "Graf" },
      "de-DE": { title: "Graphansicht" },
      "en-GB": { title: "Graph View" },
      "en-US": { title: "Graph View" },
      "es-ES": { title: "Vista Gráfica" },
      "fa-IR": { title: "نمای گراف" },
      "fi-FI": { title: "Verkkonäkymä" },
      "fr-FR": { title: "Vue Graphique" },
      "he-IL": { title: "מבט גרף" },
      "hu-HU": { title: "Grafikonnézet" },
      "id-ID": { title: "Tampilan Grafik" },
      "it-IT": { title: "Vista grafico" },
      "ja-JP": { title: "グラフビュー" },
      "kk-KZ": { title: "Граф көрінісі" },
      "ko-KR": { title: "그래프 뷰" },
      "lt-LT": { title: "Grafiko Vaizdas" },
      "nb-NO": { title: "Graf-visning" },
      "nl-NL": { title: "Grafiekweergave" },
      "pl-PL": { title: "Graf" },
      "pt-BR": { title: "Visão de gráfico" },
      "ro-RO": { title: "Graf" },
      "ru-RU": { title: "Вид графа" },
      "th-TH": { title: "มุมมองกราฟ" },
      "tr-TR": { title: "Grafik Görünümü" },
      "uk-UA": { title: "Вигляд графа" },
      "vi-VN": { title: "Sơ đồ" },
      "zh-CN": { title: "关系图谱" },
      "zh-TW": { title: "關係圖譜" },
    };

    const title = translations[locale]?.title ?? "Graph View";

    return (
      <div class={classNames(displayClass, "graph")}>
        <h3>{title}</h3>
        <div class="graph-outer">
          <div class="graph-container" data-cfg={JSON.stringify(localGraph)}></div>
          <button class="global-graph-icon" aria-label="Global Graph">
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              xmlnsXlink="http://www.w3.org/1999/xlink"
              x="0px"
              y="0px"
              viewBox="0 0 55 55"
              fill="currentColor"
              xmlSpace="preserve"
            >
              <path
                d="M49,0c-3.309,0-6,2.691-6,6c0,1.035,0.263,2.009,0.726,2.86l-9.829,9.829C32.542,17.634,30.846,17,29,17
                s-3.542,0.634-4.898,1.688l-7.669-7.669C16.785,10.424,17,9.74,17,9c0-2.206-1.794-4-4-4S9,6.794,9,9s1.794,4,4,4
                c0.74,0,1.424-0.215,2.019-0.567l7.669,7.669C21.634,21.458,21,23.154,21,25s0.634,3.542,1.688,4.897L10.024,42.562
                C8.958,41.595,7.549,41,6,41c-3.309,0-6,2.691-6,6s2.691,6,6,6s6-2.691,6-6c0-1.035-0.263-2.009-0.726-2.86l12.829-12.829
                c1.106,0.86,2.44,1.436,3.898,1.619v10.16c-2.833,0.478-5,2.942-5,5.91c0,3.309,2.691,6,6,6s6-2.691,6-6c0-2.967-2.167-5.431-5-5.91
                v-10.16c1.458-0.183,2.792-0.759,3.898-1.619l7.669,7.669C41.215,39.576,41,40.26,41,41c0,2.206,1.794,4,4,4s4-1.794,4-4
                s-1.794-4-4-4c-0.74,0-1.424,0.215-2.019,0.567l-7.669-7.669C36.366,28.542,37,26.846,37,25s-0.634-3.542-1.688-4.897l9.665-9.665
                C46.042,11.405,47.451,12,49,12c3.309,0,6-2.691,6-6S52.309,0,49,0z M11,9c0-1.103,0.897-2,2-2s2,0.897,2,2s-0.897,2-2,2
                S11,10.103,11,9z M6,51c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S8.206,51,6,51z M33,49c0,2.206-1.794,4-4,4s-4-1.794-4-4
                s1.794-4,4-4S33,46.794,33,49z M29,31c-3.309,0-6-2.691-6-6s2.691-6,6-6s6,2.691,6,6S32.309,31,29,31z M47,41c0,1.103-0.897,2-2,2
                s-2-0.897-2-2s0.897-2,2-2S47,39.897,47,41z M49,10c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S51.206,10,49,10z"
              />
            </svg>
          </button>
        </div>
        <div class="global-graph-outer">
          <div class="global-graph-container" data-cfg={JSON.stringify(globalGraph)}></div>
        </div>
      </div>
    );
  };

  GraphComponent.css = graphStyles;
  GraphComponent.afterDOMLoaded = graphScript;

  return GraphComponent;
};

export type { GraphOptions };
