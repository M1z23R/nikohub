import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { environment } from '../../../environments/environment';

export const http = axios.create({
  baseURL: environment.apiBase,
  withCredentials: true,
});

let accessToken: string | null = null;
let refreshHandler: (() => Promise<void>) | null = null;
let logoutHandler: (() => Promise<void>) | null = null;
let refreshPromise: Promise<void> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAuthHandlers(handlers: {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}): void {
  refreshHandler = handlers.refresh;
  logoutHandler = handlers.logout;
}

http.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';
    const isAuthEndpoint = url.endsWith('/auth/refresh') || url.endsWith('/auth/logout');

    if (status !== 401 || !config || config._retried || isAuthEndpoint || !refreshHandler) {
      throw error;
    }

    config._retried = true;

    if (!refreshPromise) {
      refreshPromise = refreshHandler().finally(() => {
        refreshPromise = null;
      });
    }

    try {
      await refreshPromise;
    } catch (e) {
      if (logoutHandler) await logoutHandler();
      throw e;
    }

    if (accessToken) {
      config.headers.set('Authorization', `Bearer ${accessToken}`);
    }
    return http(config);
  },
);
