import { ApplicationConfig, provideZonelessChangeDetection, inject, provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      return auth.init();
    }),
  ],
};
