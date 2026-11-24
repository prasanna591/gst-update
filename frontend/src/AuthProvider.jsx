import { useEffect, useState } from "react";
import { AuthContext } from "./authContext";
import api from "./api";

const KEY = "gst_token";

function tokenExpired(token) {
  try {
    let part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    part += "=".repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(part));
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function setAuthHeader(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(() => Boolean(localStorage.getItem(KEY)));

  function logout() {
    localStorage.removeItem(KEY);
    setAuthHeader(null);
    setUser(null);
  }

  // On page load: restore the session if a saved token is still valid
  useEffect(() => {
    const token = localStorage.getItem(KEY);
    if (!token) return;
    setAuthHeader(token);
    api
      .get("/api/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => logout())
      .finally(() => setChecking(false));
  }, []);

  // If the token expires, send the person back to the login page
  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      (err) => {
        const url = err.config?.url || "";
        const detail = err.response?.data?.detail;
        if (err.response?.status === 401 && !url.includes("/api/auth/login")) {
          const token = localStorage.getItem(KEY);
          if (url.includes("/api/auth/me") || !token || tokenExpired(token)) {
            logout();
          }
        }
        if (
          err.response?.status === 403 &&
          typeof detail === "string" &&
          detail.includes("Staff access is currently disabled")
        ) {
          logout();
        }
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  async function login(email, password) {
    const res = await api.post("/api/auth/login", { email, password });
    loginWithToken(res.data.access_token, res.data.user);
  }

  function loginWithToken(token, nextUser) {
    localStorage.setItem(KEY, token);
    setAuthHeader(token);
    setUser(nextUser);
  }

  return (
    <AuthContext.Provider value={{ user, checking, login, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}