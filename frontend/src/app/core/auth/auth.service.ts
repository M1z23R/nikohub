import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { http, setAccessToken, setAuthHandlers } from '../api/http';

export interface IUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  created_at: string;
}

interface IRefreshResponse {
  accessToken: string;
  user: IUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);

  readonly accessToken = signal<string | null>(null);
  readonly user = signal<IUser | null>(null);
  readonly ready = signal(false);

  constructor() {
    setAuthHandlers({
      refresh: () => this.refresh(),
      logout: () => this.logout(),
    });
  }

  async init(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      this.setToken(null);
      this.user.set(null);
    } finally {
      this.ready.set(true);
    }
  }

  async refresh(): Promise<void> {
    const { data } = await http.post<IRefreshResponse>('/auth/refresh', {});
    this.setToken(data.accessToken);
    this.user.set(data.user);
  }

  loginWithGoogle(): void {
    window.location.href = `${environment.apiBase}/auth/google/consent-url`;
  }

  async logout(): Promise<void> {
    try {
      await http.post('/auth/logout', {});
    } catch {}
    this.setToken(null);
    this.user.set(null);
    this.router.navigateByUrl('/login');
  }

  private setToken(token: string | null): void {
    this.accessToken.set(token);
    setAccessToken(token);
  }
}
