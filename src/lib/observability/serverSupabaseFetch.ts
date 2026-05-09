export const createInstrumentedServerSupabaseFetch = (_source: string): typeof fetch => {
  throw new Error(
    "createInstrumentedServerSupabaseFetch is server-only. Import '@/lib/observability/serverSupabaseFetch.server' from server runtimes.",
  );
};
