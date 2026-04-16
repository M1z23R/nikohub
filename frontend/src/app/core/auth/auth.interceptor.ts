import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBase)) return next(req);
  const auth = inject(AuthService);
  const withCreds = req.clone({ withCredentials: true });
  const token = auth.accessToken();
  const authed = token ? withCreds.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : withCreds;

  return next(authed).pipe(
    catchError((err) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      if (req.url.endsWith('/auth/refresh') || req.url.endsWith('/auth/logout')) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap(() => {
          const retryToken = auth.accessToken();
          const retryReq = retryToken
            ? withCreds.clone({ setHeaders: { Authorization: `Bearer ${retryToken}` } })
            : withCreds;
          return next(retryReq);
        }),
        catchError((e) => {
          auth.logout();
          return throwError(() => e);
        }),
      );
    }),
  );
};
