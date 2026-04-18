import { QueryClient } from "@tanstack/react-query";

// §6.6.13: "stale time 5 min for most reads".
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
