import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  created_at: string;
}

interface RefreshResponse {
  accessToken: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly accessToken = signal<string | null>(null);
  readonly user = signal<User | null>(null);
  readonly ready = signal(false);

  async init(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      this.accessToken.set(null);
      this.user.set(null);
    } finally {
      this.ready.set(true);
    }
  }

  async refresh(): Promise<void> {
    const r = await firstValueFrom(
      this.http.post<RefreshResponse>(`${environment.apiBase}/auth/refresh`, {}, { withCredentials: true }),
    );
    this.accessToken.set(r.accessToken);
    this.user.set(r.user);
  }

  loginWithGoogle(): void {
    window.location.href = `${environment.apiBase}/auth/google/consent-url`;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiBase}/auth/logout`, {}, { withCredentials: true }),
      );
    } catch {}
    this.accessToken.set(null);
    this.user.set(null);
    this.router.navigateByUrl('/login');
  }
}
