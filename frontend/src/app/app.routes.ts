import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage) },
  { path: '', canActivate: [authGuard], loadComponent: () => import('./pages/canvas/canvas').then((m) => m.CanvasPage) },
  { path: '**', redirectTo: '' },
];
