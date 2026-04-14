import { useEffect, useState } from "react";

const STORAGE_KEY = "bbva_session_cookie";

export function useSessionCookie() {
  const [sessionCookie, setSessionCookie] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || "";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, sessionCookie);
  }, [sessionCookie]);

  const clearSessionCookie = () => {
    setSessionCookie("");
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    sessionCookie,
    setSessionCookie,
    clearSessionCookie,
  };
}