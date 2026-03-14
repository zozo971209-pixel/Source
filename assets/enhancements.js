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
    let best = null;
    let bestDelta = 0;

    const consider = (el) => {
      if (!el) return;
      const cs = window.getComputedStyle(el);
      if (cs.overflowY !== "auto" && cs.overflowY !== "scroll") return;
      const delta = el.scrollHeight - el.clientHeight;
      if (delta > bestDelta + 2) {
        best = el;
        bestDelta = delta;
      }
    };

    consider(dialogContent);

    dialogContent
      .querySelectorAll(".overflow-y-auto, .overflow-auto, [style*=\"overflow\"], *")
      .forEach((el) => consider(el));

    return best;
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
    const candidates = new Set();
    document
      .querySelectorAll('[data-slot="dialog-content"], [role="dialog"]')
      .forEach((el) => candidates.add(el));
    document
      .querySelectorAll('[class*="max-h-"][class*="overflow-hidden"]')
      .forEach((el) => candidates.add(el));
    document
      .querySelectorAll('[class*="max-h-"][class*="overflow-y-auto"]')
      .forEach((el) => candidates.add(el));
    document
      .querySelectorAll('[class*="max-h-"][class*="overflow-auto"]')
      .forEach((el) => candidates.add(el));

    const dialogs = Array.from(candidates).filter(isVisible);
    const dialog = dialogs.reduce((best, el) => {
      const zb = best ? parseInt(getComputedStyle(best).zIndex || "0", 10) : -1;
      const ze = parseInt(getComputedStyle(el).zIndex || "0", 10);
      if (!best) return el;
      if (Number.isFinite(ze) && Number.isFinite(zb) && ze !== zb) return ze > zb ? el : best;
      return el;
    }, null);
    if (!dialog) {
      wrap.style.display = "none";
      wrap.__target = null;
      return;
    }
    const target = pickScrollTarget(dialog);
    const pageTarget = document.scrollingElement || document.documentElement;
    const pageScrollable = pageTarget.scrollHeight > pageTarget.clientHeight + 2;

    const finalTarget =
      target && target.scrollHeight > target.clientHeight + 2 ? target : pageScrollable ? pageTarget : null;

    if (!finalTarget) {
      wrap.style.display = "none";
      wrap.__target = null;
      if (!wrap.__retry) {
        wrap.__retry = setTimeout(() => {
          wrap.__retry = null;
          update();
        }, 120);
      }
      return;
    }
    if (wrap.__target !== finalTarget) {
      wrap.__target = finalTarget;
      wrap.__up.onclick = (e) => {
        e.preventDefault();
        finalTarget.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
      };
      wrap.__down.onclick = (e) => {
        e.preventDefault();
        finalTarget.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
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
