
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:8077" : ""),
});

export async function apiErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  const response = error?.response;
  if (!response) return error?.message || fallback;

  let detail = response.data?.detail;

  if (detail && typeof detail.text === "function") {
    try {
      const raw = await detail.text();
      try {
        detail = JSON.parse(raw).detail ?? raw;
      } catch {
        detail = raw;
      }
    } catch {
      detail = null;
    }
  }

  if (Array.isArray(detail)) {
    detail = detail.map((item) => item?.msg || item?.message || String(item)).join("; ");
  } else if (detail && typeof detail === "object") {
    detail = JSON.stringify(detail);
  }

  if (typeof detail === "string" && detail.trim()) return detail.trim();

  const messages = {
    400: "The request could not be completed. Check the information and try again.",
    401: "Your session has expired. Please sign in again.",
    403: "You do not have permission to perform this action.",
    404: "The requested item or its stored file was not found.",
    413: "The file is too large. The limit is 10 MB.",
    422: "Some information is invalid. Check the form and try again.",
    500: "The local service could not complete the request. Please try again.",
  };
  return messages[response.status] || fallback;
}

export default api;
