import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getGuestToken } from "./guestIdentity";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function getGuestHeaders(): Record<string, string> {
  try {
    const token = getGuestToken();
    return token ? { "x-guest-id": token } : {};
  } catch {
    return {};
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseHeaders: Record<string, string> = { ...getGuestHeaders() };
  if (data) baseHeaders["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers: baseHeaders,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Only use string segments of the query key to build the URL
    // This prevents [object Object] from appearing in URLs when query keys contain objects
    const urlSegments = queryKey.filter((segment): segment is string => typeof segment === 'string');
    const url = urlSegments.join("/");
    
    const res = await fetch(url, {
      credentials: "include",
      headers: getGuestHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false, // Disabled globally; enable per-query for data that needs freshness on focus
      staleTime: 60000, // 1 minute default - individual queries can override
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
