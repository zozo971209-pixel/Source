(() => {
  const SCROLL_STEP = 260;

  const createButton = (label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.width = "36px";
    btn.style.height = "36px";
    btn.style.borderRadius = "999px";
    btn.style.border = "1px solid rgba(201,168,108,.35)";
    btn.style.background = "rgba(0,0,0,.65)";
    btn.style.color = "rgba(201,168,108,.95)";
    btn.style.fontSize = "14px";
    btn.style.cursor = "pointer";
    btn.style.display = "inline-flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    return btn;
  };

  const ensureScrollControls = (dialogContent) => {
    if (!dialogContent || dialogContent.__scrollControlsMounted) return;

    const scrollTarget =
      dialogContent.querySelector(".overflow-y-auto") ||
      dialogContent.querySelector("[style*=\"overflow-y\"]") ||
      dialogContent;

    const wrap = document.createElement("div");
    wrap.style.position = "absolute";
    wrap.style.right = "10px";
    wrap.style.top = "70px";
    wrap.style.zIndex = "20";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";

    const up = createButton("▲");
    const down = createButton("▼");

    up.addEventListener("click", (e) => {
      e.preventDefault();
      scrollTarget.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
    });
    down.addEventListener("click", (e) => {
      e.preventDefault();
      scrollTarget.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
    });

    wrap.appendChild(up);
    wrap.appendChild(down);

    const computed = window.getComputedStyle(dialogContent);
    if (computed.position === "static") dialogContent.style.position = "relative";
    dialogContent.appendChild(wrap);
    dialogContent.__scrollControlsMounted = true;
  };

  const scan = () => {
    document
      .querySelectorAll('[data-slot="dialog-content"], .max-w-lg, .max-w-md')
      .forEach((el) => ensureScrollControls(el));
  };

  const start = () => {
    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
