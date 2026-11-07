// Copy buttons, and the table of contents follows the reading position.
for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    const text = document.getElementById(b.dataset.copy)?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text.replace(/^\$ /gm, ""));
      b.textContent = "Copied";
      b.dataset.done = "";
      setTimeout(() => { b.textContent = "Copy"; delete b.dataset.done; }, 1600);
    } catch {
      b.textContent = "Select and copy";
    }
  });
}

const links = [...document.querySelectorAll(".toc a[href^='#']")];
if (links.length) {
  // The section being read: the last one whose top has passed under the header.
  const targets = links.map((a) => document.getElementById(a.getAttribute("href").slice(1)));
  let ticking = false;
  const mark = () => {
    ticking = false;
    let at = 0;
    targets.forEach((el, i) => { if (el && el.getBoundingClientRect().top < 160) at = i; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) at = targets.length - 1;
    links.forEach((a, i) => a.classList.toggle("here", i === at));
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(mark); } }, { passive: true });
  mark();
}
