import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") window.addEventListener("popstate", notify);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function navigate(to: string, { replace = false, scroll = true } = {}) {
  if (to === location.pathname + location.search + location.hash) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  notify();
  if (scroll && !to.includes("#")) window.scrollTo(0, 0);
}

export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname);

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return new URLSearchParams(search);
}

export function setSearchParams(params: Record<string, string | null>) {
  const next = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(params)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const query = next.toString();
  navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true, scroll: false });
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(b[i]!);
    else if (p !== b[i]) return null;
  }
  return params;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, ...props }: LinkProps) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={handle} {...props} />;
}
