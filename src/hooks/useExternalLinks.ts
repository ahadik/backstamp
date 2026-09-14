import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Decide whether an anchor click should leave the app. Exported for tests.
 * Returns the URL to hand to the OS, or null to let the webview handle it.
 */
export function externalHrefFor(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
  // In-app navigation (Vite dev server / bundled origin) stays in the webview.
  if (url.protocol !== "mailto:" && url.origin === window.location.origin) return null;
  return url.href;
}

/**
 * Route every external link in the webview to the user's default browser.
 *
 * Anchors we don't render ourselves (e.g. Mapbox's attribution and logo
 * controls) would otherwise navigate the Tauri window away from the app. A
 * single capture-phase listener on the document catches them all, including
 * ones injected after mount.
 */
export function useExternalLinks() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = externalHrefFor(anchor);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      openUrl(href).catch((err) => console.error("Failed to open link:", err));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
