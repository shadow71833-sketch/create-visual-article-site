(() => {
  "use strict";

  const viewNames = new Set(["article", "one-page", "comic"]);
  const tabs = [...document.querySelectorAll("[data-target-view]")];
  const panels = [...document.querySelectorAll("[data-view]")];
  const scrollPositions = new Map();
  const toast = document.querySelector("#toast");
  const progress = document.querySelector("#reading-progress-bar");

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 2200);
  }

  function currentView() {
    return panels.find((panel) => !panel.hidden)?.dataset.view ?? "article";
  }

  function activateView(name, {updateHash = true, focus = false} = {}) {
    if (!viewNames.has(name)) name = "article";
    const previous = currentView();
    scrollPositions.set(previous, window.scrollY);
    for (const panel of panels) panel.hidden = panel.dataset.view !== name;
    for (const tab of tabs) {
      const selected = tab.dataset.targetView === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    if (updateHash) history.replaceState(null, "", `#${name}`);
    requestAnimationFrame(() => window.scrollTo({top: scrollPositions.get(name) ?? 0, behavior: "instant"}));
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => activateView(tab.dataset.targetView));
    tab.addEventListener("keydown", (event) => {
      if (!new Set(["ArrowLeft", "ArrowRight", "Home", "End"]).has(event.key)) return;
      event.preventDefault();
      const currentIndex = tabs.indexOf(tab);
      let nextIndex = currentIndex;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      activateView(tabs[nextIndex].dataset.targetView, {focus: true});
    });
  }

  function markdownValue() {
    const node = document.querySelector("#article-markdown");
    if (!node) throw new Error("未找到 Markdown 数据");
    const encoded = JSON.parse(node.content.textContent);
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  document.querySelector("#copy-markdown")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(markdownValue());
      showToast("Markdown 已复制");
    } catch {
      showToast("浏览器未允许复制，请下载 .md 文件");
    }
  });

  document.querySelector("#download-markdown")?.addEventListener("click", () => {
    try {
      const blob = new Blob([markdownValue()], {type: "text/markdown;charset=utf-8"});
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "article.md";
      link.click();
      URL.revokeObjectURL(link.href);
      showToast("Markdown 已下载");
    } catch {
      showToast("Markdown 下载失败");
    }
  });

  function updateProgress() {
    if (!progress) return;
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = maximum > 0 ? Math.min(1, Math.max(0, window.scrollY / maximum)) : 0;
    progress.value = ratio;
  }
  document.addEventListener("scroll", updateProgress, {passive: true});
  window.addEventListener("resize", updateProgress);
  window.addEventListener("hashchange", () => activateView(location.hash.slice(1), {updateHash: false}));
  activateView(location.hash.slice(1), {updateHash: false});
  updateProgress();
})();
