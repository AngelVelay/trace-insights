import { useEffect, useState } from "react";

const STORAGE_KEY = "bbva_bearer_token";

export function useBearerToken() {
  const [bearerToken, setBearerToken] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || "";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, bearerToken);
  }, [bearerToken]);

  const clearBearerToken = () => {
    setBearerToken("");
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    bearerToken,
    setBearerToken,
    clearBearerToken,
  };
}