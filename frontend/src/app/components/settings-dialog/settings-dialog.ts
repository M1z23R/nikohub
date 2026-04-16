import { Component, ElementRef, ViewChild, computed, inject } from '@angular/core';
import { ButtonComponent, DIALOG_REF, DialogRef, ModalComponent } from '@m1z23r/ngx-ui';
import {
  CARD_TYPE_COLOR_DEFAULTS,
  CardTypeColorKey,
  CardTypeColorsService,
} from '../../core/api/card-type-colors.service';

interface ITypeRow {
  key: CardTypeColorKey;
  label: string;
}

const PRESETS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#fed7aa'];

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.css',
})
export class SettingsDialogComponent {
  private dialogRef = inject(DIALOG_REF) as DialogRef<void>;
  private colorsSvc = inject(CardTypeColorsService);

  readonly presets = PRESETS;
  readonly colors = this.colorsSvc.colors;
  readonly rows: ITypeRow[] = [
    { key: 'note', label: 'Note' },
    { key: 'secret', label: 'Secret note' },
    { key: 'image', label: 'Image' },
    { key: 'totp', label: 'TOTP' },
    { key: 'password', label: 'Password' },
  ];

  readonly currentColor = computed(() => (key: CardTypeColorKey) => this.colors()[key]);

  @ViewChild('cp') cp?: ElementRef<HTMLInputElement>;
  private pickerKey: CardTypeColorKey | null = null;

  async pick(key: CardTypeColorKey, color: string) {
    if (this.colors()[key] === color) return;
    try {
      await this.colorsSvc.setColor(key, color);
    } catch (e) {
      console.error('color update failed', e);
    }
  }

  openPicker(key: CardTypeColorKey) {
    this.pickerKey = key;
    const el = this.cp?.nativeElement;
    if (!el) return;
    el.value = this.colors()[key] ?? '#ffffff';
    el.click();
  }

  async onCustomColor(ev: Event) {
    const color = (ev.target as HTMLInputElement).value;
    const key = this.pickerKey;
    this.pickerKey = null;
    if (!key) return;
    await this.pick(key, color);
  }

  async resetDefaults() {
    const current = this.colors();
    const tasks: Promise<void>[] = [];
    for (const row of this.rows) {
      const def = CARD_TYPE_COLOR_DEFAULTS[row.key];
      if (current[row.key] !== def) tasks.push(this.colorsSvc.setColor(row.key, def));
    }
    try {
      await Promise.all(tasks);
    } catch (e) {
      console.error('reset failed', e);
    }
  }

  close() {
    this.dialogRef.close();
  }
}
