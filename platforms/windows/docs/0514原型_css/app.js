(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("embed") === "1") {
    document.body.classList.add("embed");
  }

  const nav = document.querySelector("[data-nav]");
  if (!nav) return;

  const here = (location.pathname.split("/").pop() || "").toLowerCase();
  nav.querySelectorAll("a.nav-item").forEach(a => {
    const file = (a.getAttribute("href") || "").toLowerCase();
    a.setAttribute("aria-current", file === here ? "page" : "false");
  });

  const title = document.querySelector("[data-page-title]");
  const crumb = document.querySelector("[data-crumb]");
  if (title) title.textContent = title.textContent || document.title || here;
  if (crumb) crumb.textContent = "0514原型（CSS实现版）";

  const copyBtn = document.querySelector("[data-copy-link]");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const url = location.href;
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = "已复制";
        setTimeout(() => (copyBtn.textContent = "复制链接"), 900);
      } catch {
        prompt("复制这个链接：", url);
      }
    });
  }
})();
