import { Component, computed, inject } from '@angular/core';
import {
  DialogService,
  DropdownComponent,
  DropdownDividerComponent,
  DropdownItemComponent,
  DropdownTriggerDirective,
} from '@m1z23r/ngx-ui';
import { AuthService } from '../../core/auth/auth.service';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [DropdownComponent, DropdownItemComponent, DropdownDividerComponent, DropdownTriggerDirective],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class HeaderComponent {
  private auth = inject(AuthService);
  private dialog = inject(DialogService);
  user = this.auth.user;
  initial = computed(() => (this.user()?.name ?? '?').trim().charAt(0).toUpperCase());

  openSettings() {
    this.dialog.open(SettingsDialogComponent, { size: 'sm', closeOnBackdropClick: true });
  }

  logout() {
    this.auth.logout();
  }
}
