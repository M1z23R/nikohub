import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent } from '@m1z23r/ngx-ui';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ButtonComponent],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  constructor() {
    effect(() => {
      if (this.auth.user()) this.router.navigateByUrl('/');
    });
  }

  signIn() {
    this.auth.loginWithGoogle();
  }
}
