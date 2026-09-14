import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExternalLinks, externalHrefFor } from "./useExternalLinks";

const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

function makeAnchor(href: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  return a;
}

describe("externalHrefFor", () => {
  it("returns absolute http(s) and mailto hrefs", () => {
    expect(externalHrefFor(makeAnchor("https://www.mapbox.com/about/maps/"))).toBe(
      "https://www.mapbox.com/about/maps/",
    );
    expect(externalHrefFor(makeAnchor("http://example.com"))).toBe("http://example.com/");
    expect(externalHrefFor(makeAnchor("mailto:hi@example.com"))).toBe("mailto:hi@example.com");
  });

  it("ignores hash, relative, same-origin, and non-web hrefs", () => {
    expect(externalHrefFor(makeAnchor("#section"))).toBeNull();
    expect(externalHrefFor(makeAnchor("/settings"))).toBeNull();
    expect(externalHrefFor(makeAnchor(`${window.location.origin}/settings`))).toBeNull();
    expect(externalHrefFor(makeAnchor("javascript:void(0)"))).toBeNull();
    expect(externalHrefFor(document.createElement("a"))).toBeNull();
  });
});

describe("useExternalLinks", () => {
  beforeEach(() => {
    openUrl.mockClear();
    document.body.innerHTML = "";
  });

  it("opens external links via the OS and prevents in-app navigation", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    // Mimic Mapbox's attribution control: injected after mount, nested content.
    const a = makeAnchor("https://www.openstreetmap.org/about/");
    a.innerHTML = "<span>© OpenStreetMap</span>";
    document.body.appendChild(a);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.querySelector("span")!.dispatchEvent(event);

    expect(openUrl).toHaveBeenCalledWith("https://www.openstreetmap.org/about/");
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it("leaves internal links and non-anchor clicks alone", () => {
    renderHook(() => useExternalLinks());
    const a = makeAnchor("#top");
    document.body.appendChild(a);
    const div = document.createElement("div");
    document.body.appendChild(div);

    const anchorEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(anchorEvent);
    div.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(openUrl).not.toHaveBeenCalled();
    expect(anchorEvent.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    unmount();
    const a = makeAnchor("https://example.com");
    document.body.appendChild(a);
    // Cancel at the bubble phase so jsdom doesn't try to navigate; the hook's
    // capture listener would have run first if it were still attached.
    let reachedBubblePhase = false;
    a.addEventListener("click", (e) => {
      reachedBubblePhase = true;
      e.preventDefault();
    });
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(reachedBubblePhase).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();
  });
});
