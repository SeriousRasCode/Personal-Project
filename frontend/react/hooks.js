import { useCallback, useEffect, useState } from "react";
import { request } from "../api.js";

export function useResource(endpoint) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const reload = useCallback(() => {
    setState(current => ({ ...current, loading: true, error: null }));
    return request(endpoint)
      .then(data => {
        setState({ data, loading: false, error: null });
        return data;
      })
      .catch(error => {
        setState({ data: null, loading: false, error });
        throw error;
      });
  }, [endpoint]);

  useEffect(() => { reload().catch(() => undefined); }, [reload]);
  return { ...state, rows: state.data?.items || [], reload };
}

export function useMutation() {
  const [state, setState] = useState({ loading: false, error: null });
  const execute = useCallback(async (path, options = {}) => {
    setState({ loading: true, error: null });
    try {
      const data = await request(path, options);
      setState({ loading: false, error: null });
      return data;
    } catch (error) {
      setState({ loading: false, error });
      throw error;
    }
  }, []);
  return { ...state, execute };
}
