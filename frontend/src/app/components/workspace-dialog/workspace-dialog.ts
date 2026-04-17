import { Component, inject, signal } from '@angular/core';
import {
  AlertComponent,
  ButtonComponent,
  DIALOG_REF,
  DialogRef,
  InputComponent,
  ModalComponent,
} from '@m1z23r/ngx-ui';
import { WorkspaceService } from '../../core/workspace/workspace.service';

@Component({
  selector: 'app-workspace-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, InputComponent, AlertComponent],
  templateUrl: './workspace-dialog.html',
  styleUrl: './workspace-dialog.css',
})
export class WorkspaceDialog {
  private dialogRef = inject(DIALOG_REF) as DialogRef<void>;
  private svc = inject(WorkspaceService);

  readonly name = signal('');
  readonly code = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  async create(): Promise<void> {
    const n = this.name().trim();
    if (!n || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const ws = await this.svc.create(n);
      this.svc.setActive(ws.id);
      this.dialogRef.close();
    } catch {
      this.error.set('Could not create workspace');
    } finally {
      this.busy.set(false);
    }
  }

  async join(): Promise<void> {
    const c = this.code().trim();
    if (!c || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const ws = await this.svc.join(c);
      this.svc.setActive(ws.id);
      this.dialogRef.close();
    } catch {
      this.error.set('Invalid or disabled code');
    } finally {
      this.busy.set(false);
    }
  }

  dismiss(): void {
    this.dialogRef.close();
  }
}
