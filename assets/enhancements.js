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

  const isVisible = (el) => {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const pickScrollTarget = (dialogContent) => {
    const candidates = [
      ...dialogContent.querySelectorAll(".overflow-y-auto"),
      ...dialogContent.querySelectorAll('[style*="overflow-y"]'),
    ];
    for (const el of candidates) {
      const cs = window.getComputedStyle(el);
      if (
        (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 2
      ) {
        return el;
      }
    }
    return dialogContent;
  };

  const ensureControls = () => {
    let wrap = document.getElementById("dialog-scroll-controls");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "dialog-scroll-controls";
      wrap.style.position = "fixed";
      wrap.style.right = "16px";
      wrap.style.top = "50%";
      wrap.style.transform = "translateY(-50%)";
      wrap.style.zIndex = "9999";
      wrap.style.display = "none";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "10px";

      const up = createButton("▲");
      const down = createButton("▼");

      wrap.appendChild(up);
      wrap.appendChild(down);
      document.body.appendChild(wrap);

      wrap.__up = up;
      wrap.__down = down;
    }
    return wrap;
  };

  const update = () => {
    const wrap = ensureControls();
    const dialogs = Array.from(
      document.querySelectorAll('[data-slot="dialog-content"]')
    ).filter(isVisible);
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) {
      wrap.style.display = "none";
      wrap.__target = null;
      return;
    }
    const target = pickScrollTarget(dialog);
    if (!target || target.scrollHeight <= target.clientHeight + 2) {
      wrap.style.display = "none";
      wrap.__target = null;
      return;
    }
    if (wrap.__target !== target) {
      wrap.__target = target;
      wrap.__up.onclick = (e) => {
        e.preventDefault();
        target.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
      };
      wrap.__down.onclick = (e) => {
        e.preventDefault();
        target.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
      };
    }
    wrap.style.display = "flex";
  };

  const start = () => {
    update();
    const mo = new MutationObserver(() => update());
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", update);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
