const base = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

if (!base) {
  console.error(
    "VITE_API_URL is not set: the app has no backend to call. See frontend/.env.example.",
  );
}

export const API_URL = base;

export const apiUrl = (path: string) => `${API_URL}${path}`;
