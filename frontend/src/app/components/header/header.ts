import { Component, computed, inject } from '@angular/core';
import { DropdownComponent, DropdownItemComponent, DropdownTriggerDirective } from '@m1z23r/ngx-ui';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [DropdownComponent, DropdownItemComponent, DropdownTriggerDirective],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class HeaderComponent {
  private auth = inject(AuthService);
  user = this.auth.user;
  initial = computed(() => (this.user()?.name ?? '?').trim().charAt(0).toUpperCase());

  logout() {
    this.auth.logout();
  }
}
